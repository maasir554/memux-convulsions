"use client";

import { useMemo, useRef, useState } from "react";
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  CircleStop,
  FlaskConical,
  Play,
  RotateCcw,
  Search,
  Timer,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  LocomoEvent,
  LocomoItemResult,
  LocomoSummary,
} from "@/lib/evals/locomo";

const EMPTY_SUMMARY: LocomoSummary = {
  completed: 0,
  total: 150,
  score: 0,
  evidenceRecall: 0,
  elapsedMs: 0,
  byCategory: {},
};

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function duration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export default function EvalsPage() {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [summary, setSummary] = useState<LocomoSummary>(EMPTY_SUMMARY);
  const [results, setResults] = useState<LocomoItemResult[]>([]);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const progress = summary.total ? summary.completed / summary.total : 0;
  const latest = useMemo(() => results.slice(-6).reverse(), [results]);

  async function start() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("running");
    setSummary(EMPTY_SUMMARY);
    setResults([]);
    setError("");

    try {
      const response = await fetch("/api/evals/locomo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concurrency: 4 }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(`Evaluation API returned ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const line = block.split("\n").find((part) => part.startsWith("data: "));
          if (line) applyEvent(JSON.parse(line.slice(6)) as LocomoEvent);
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch (caught) {
      if (controller.signal.aborted) {
        setStatus("idle");
        return;
      }
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("error");
    }
  }

  function applyEvent(event: LocomoEvent) {
    if (event.type === "item") {
      setSummary(event.summary);
      setResults((current) => [...current, event.result]);
    } else if (event.type === "complete") {
      setSummary(event.summary);
      setResults(event.results);
      setStatus("done");
    } else if (event.type === "error") {
      setError(event.message);
      setStatus("error");
    }
  }

  function stop() {
    abortRef.current?.abort();
    setStatus("idle");
  }

  return (
    <main className="min-h-0 flex-1 overflow-auto bg-[#08090c] text-zinc-100">
      <div className="mx-auto max-w-7xl px-6 py-8 lg:px-10">
        <header className="flex flex-col gap-5 border-b border-white/10 pb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-medium tracking-[0.18em] text-fuchsia-300 uppercase">
              <FlaskConical className="size-4" />
              Agent memory laboratory
            </div>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">LoCoMo · fixed 150</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
              A reproducible long-conversation memory test across 10 lives, four reasoning
              categories, and months of dialogue. Watch retrieval and answer quality resolve live.
            </p>
          </div>
          {status === "running" ? (
            <Button
              variant="outline"
              onClick={stop}
              className="border-red-400/30 bg-red-400/5 text-red-200 hover:bg-red-400/10"
            >
              <CircleStop className="size-4" /> Stop run
            </Button>
          ) : (
            <Button onClick={start} className="bg-fuchsia-300 text-zinc-950 hover:bg-fuchsia-200">
              {status === "done" ? <RotateCcw className="size-4" /> : <Play className="size-4" />}
              {status === "done" ? "Run again" : "Run evaluation"}
            </Button>
          )}
        </header>

        <section className="mt-7 grid gap-4 md:grid-cols-4">
          <Metric
            icon={<BrainCircuit className="size-4" />}
            label="Answer F1"
            value={summary.completed ? pct(summary.score) : "—"}
            accent="text-fuchsia-300"
          />
          <Metric
            icon={<Search className="size-4" />}
            label="Evidence recall"
            value={summary.completed ? pct(summary.evidenceRecall) : "—"}
            accent="text-cyan-300"
          />
          <Metric
            icon={<Activity className="size-4" />}
            label="Questions"
            value={`${summary.completed} / ${summary.total}`}
            accent="text-amber-200"
          />
          <Metric
            icon={<Timer className="size-4" />}
            label="Elapsed"
            value={summary.elapsedMs ? duration(summary.elapsedMs) : "—"}
            accent="text-emerald-300"
          />
        </section>

        <section className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
          <div className="flex items-center justify-between px-5 py-4 text-xs text-zinc-400">
            <span>{status === "running" ? "Evaluation in progress" : status === "done" ? "Run complete" : "Ready"}</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
          <div className="h-1 bg-white/5">
            <div
              className="h-full bg-gradient-to-r from-fuchsia-400 via-orange-300 to-amber-200 transition-[width] duration-500"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </section>

        {error && (
          <div className="mt-4 rounded-xl border border-red-400/30 bg-red-400/5 p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[0.82fr_1.18fr]">
          <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
            <h2 className="text-sm font-medium">Score by memory task</h2>
            <p className="mt-1 text-xs text-zinc-500">Official normalized token F1</p>
            <div className="mt-6 space-y-5">
              {Object.values(summary.byCategory).length ? (
                Object.values(summary.byCategory).map((category) => (
                  <div key={category.category}>
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="text-zinc-300">
                        {category.label} <span className="text-zinc-600">· {category.count}</span>
                      </span>
                      <span className="font-mono text-zinc-200">{pct(category.score)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-fuchsia-300/80 transition-[width] duration-500"
                        style={{ width: `${category.score * 100}%` }}
                      />
                    </div>
                    <div className="mt-1 text-right text-[10px] text-cyan-300/70">
                      {pct(category.evidenceRecall)} evidence found
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex h-52 items-center justify-center text-sm text-zinc-600">
                  Scores appear as questions complete
                </div>
              )}
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <h2 className="text-sm font-medium">Live question stream</h2>
                <p className="mt-1 text-xs text-zinc-500">Newest result first</p>
              </div>
              {status === "running" && (
                <span className="flex items-center gap-2 text-xs text-emerald-300">
                  <span className="size-1.5 animate-pulse rounded-full bg-emerald-300" />
                  4 workers
                </span>
              )}
            </div>
            <div className="divide-y divide-white/[0.07]">
              {latest.length ? (
                latest.map((result) => (
                  <article key={result.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto]">
                    <div className="min-w-0">
                      <div className="mb-1.5 flex items-center gap-2 text-[10px] tracking-wide text-zinc-500 uppercase">
                        <span>{result.sampleId}</span>
                        <span>·</span>
                        <span>{result.category === 1 ? "multi-hop" : result.category === 2 ? "temporal" : result.category === 3 ? "open-domain" : "single-hop"}</span>
                      </div>
                      <p className="truncate text-sm text-zinc-200">{result.question}</p>
                      <p className="mt-1 truncate text-xs text-zinc-500">
                        <span className="text-zinc-600">Agent</span> {result.prediction || result.error}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 sm:justify-end">
                      <span className="text-[10px] text-zinc-600">{(result.latencyMs / 1000).toFixed(1)}s</span>
                      <span
                        className={`min-w-14 rounded-full px-2 py-1 text-center font-mono text-xs ${
                          result.f1 >= 0.8
                            ? "bg-emerald-400/10 text-emerald-300"
                            : result.f1 >= 0.4
                              ? "bg-amber-300/10 text-amber-200"
                              : "bg-red-400/10 text-red-300"
                        }`}
                      >
                        {pct(result.f1)}
                      </span>
                    </div>
                  </article>
                ))
              ) : (
                <div className="flex h-80 flex-col items-center justify-center gap-3 text-zinc-600">
                  <CheckCircle2 className="size-7" />
                  <span className="text-sm">No questions evaluated yet</span>
                </div>
              )}
            </div>
          </section>
        </div>

        <footer className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[10px] tracking-wide text-zinc-600 uppercase">
          <span>Seed · memux-locomo-v1</span>
          <span>Retriever · 12 candidates + adaptive context reranking</span>
          <span>Dataset · official LoCoMo-10</span>
          <span>Adversarial questions excluded</span>
        </footer>
      </div>
    </main>
  );
}

function Metric({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
      <div className={`flex items-center gap-2 text-xs ${accent}`}>
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-4 font-mono text-2xl font-medium tracking-tight">{value}</div>
    </div>
  );
}
