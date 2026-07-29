#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const baseUrl = process.env.MEMUX_URL || "http://localhost:3000";
const concurrency = Number(process.env.LOCOMO_CONCURRENCY || 4);
const response = await fetch(`${baseUrl}/api/evals/locomo`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ concurrency }),
});

if (!response.ok || !response.body) {
  console.error(`LoCoMo API returned ${response.status}. Is MEMUX running at ${baseUrl}?`);
  process.exit(1);
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let complete;

function progress(event) {
  if (event.type === "start") {
    console.log(
      `LoCoMo fixed-${event.total} · ${event.model} · ${concurrency} workers\n` +
        `seed=${event.seed} dataset=${event.datasetSha256.slice(0, 12)}…`,
    );
  } else if (event.type === "item") {
    const { summary, result } = event;
    const width = 28;
    const filled = Math.round((summary.completed / summary.total) * width);
    const bar = "█".repeat(filled) + "░".repeat(width - filled);
    process.stdout.write(
      `\r${bar} ${String(summary.completed).padStart(3)}/${summary.total}  ` +
        `F1 ${(summary.score * 100).toFixed(1)}%  recall ${(summary.evidenceRecall * 100).toFixed(1)}%  ` +
        `last ${result.sampleId}/${result.id.split(":").at(-1)}`,
    );
  } else if (event.type === "complete") {
    complete = event;
  } else if (event.type === "error") {
    throw new Error(event.message);
  }
}

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
  let boundary = buffer.indexOf("\n\n");
  while (boundary >= 0) {
    const block = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    const line = block.split("\n").find((part) => part.startsWith("data: "));
    if (line) progress(JSON.parse(line.slice(6)));
    boundary = buffer.indexOf("\n\n");
  }
}

if (!complete) {
  console.error("\nEvaluation ended without a completion event.");
  process.exit(1);
}

const timestamp = new Date().toISOString().replaceAll(":", "-");
await mkdir("eval-results", { recursive: true });
const output = `eval-results/locomo-${timestamp}.json`;
await writeFile(output, JSON.stringify(complete, null, 2));

console.log("\n");
for (const category of Object.values(complete.summary.byCategory)) {
  console.log(
    `${category.label.padEnd(12)} ${(category.score * 100).toFixed(1).padStart(6)}%  ` +
      `evidence ${(category.evidenceRecall * 100).toFixed(1).padStart(6)}%  n=${category.count}`,
  );
}
console.log(
  `\nOverall F1: ${(complete.summary.score * 100).toFixed(2)}%\n` +
    `Evidence recall: ${(complete.summary.evidenceRecall * 100).toFixed(2)}%\n` +
    `Results: ${output}`,
);
