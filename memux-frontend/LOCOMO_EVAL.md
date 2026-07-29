# MEMUX LoCoMo evaluation

This harness evaluates MEMUX's retrieval-and-answer memory path on a fixed,
versioned subset of the official LoCoMo-10 conversational-memory benchmark.

## Run it

Start the app:

```bash
npm run dev
```

Open `http://localhost:3000/evals` for the live dashboard, or run the same
streaming evaluation from another terminal:

```bash
npm run eval:locomo
```

The CLI writes the complete per-question output to `eval-results/`. Override
the server or worker count with `MEMUX_URL` and `LOCOMO_CONCURRENCY`.

## Fixed subset

- Dataset: official `snap-research/locomo` `data/locomo10.json`
- Vendored SHA-256: `79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4`
- Seed: `memux-locomo-v1`
- 150 questions: 15 from each of the 10 conversations
- Category allocation: 28 multi-hop, 31 temporal, 9 open-domain, 82 single-hop
- Category 5 (adversarial/unanswerable) is excluded from the headline score,
  matching the common 1,540-question LoCoMo reporting convention.

Within each conversation/category cell, questions are ordered by a stable FNV-1a
hash of the seed, conversation ID, and original QA index. The checked-in dataset,
seed, and allocation therefore always produce the same 150 questions.

## Method

Each conversation is converted into session memory records. The searchable
record contains the session timestamp, raw dialogue, and the release's generated
session summary/observations. A BM25-family MiniSearch index retrieves the top
eight sessions for each question. The agent's configured Gemma model receives
only those raw retrieved sessions, never the gold answer or gold evidence.

Answer quality uses the official LoCoMo QA metric:

1. Lowercase; remove commas, punctuation, and the articles/conjunction
   `a`, `an`, `the`, `and`.
2. Porter-stem tokens.
3. Compute token precision/recall F1.
4. Multi-hop/category-1 comma-separated answers receive partial credit per
   gold sub-answer. Open-domain/category-3 answers use the first gold answer
   before `;`, matching the official evaluator.

The dashboard and CLI also show gold-evidence recall: the fraction of annotated
evidence dialogue turns present in the eight retrieved sessions. It is a
diagnostic metric and is not folded into answer F1.
