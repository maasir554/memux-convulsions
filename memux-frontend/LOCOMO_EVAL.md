# MEMUX LoCoMo evaluation

This harness evaluates MEMUX's retrieval-and-answer memory path on a fixed,
versioned subset of the official LoCoMo-10 conversational-memory benchmark.
The current retrieval/answer method is versioned as `memux-rag-v2` in saved
results so it can be compared cleanly with earlier runs.

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

Interrupted or quota-limited runs can resume from a saved result. Successful
questions are retained and only missing/failed questions run again:

```bash
LOCOMO_RESUME=eval-results/locomo-<timestamp>.json npm run eval:locomo
```

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
session summary/observations. A BM25-family MiniSearch index uses the original
question plus deterministic entity/content query expansions to retrieve 12
candidate sessions. Reciprocal-rank fusion then selects 20 high-relevance raw
dialogue turns. The eight highest-ranked full sessions are always retained;
additional candidate sessions are included while the raw-session context stays
under a conservative 42,000-character budget. This prevents unusually long
conversations from exceeding the provider's single-request token quota. The
agent's configured Gemma model receives only this retrieved memory, never the
gold answer or gold evidence.

The answer prompt explicitly handles multi-item coverage, event-specific
temporal reasoning, and grounded open-domain inference. If the first answer
abstains despite retrieved highlights, one evidence-focused retry is allowed.

Answer quality uses the official LoCoMo QA metric:

1. Lowercase; remove commas, punctuation, and the articles/conjunction
   `a`, `an`, `the`, `and`.
2. Porter-stem tokens.
3. Compute token precision/recall F1.
4. Multi-hop/category-1 comma-separated answers receive partial credit per
   gold sub-answer. Open-domain/category-3 answers use the first gold answer
   before `;`, matching the official evaluator.

The dashboard and CLI also show gold-evidence recall: the fraction of annotated
evidence dialogue turns present in the adaptively included sessions. It is a
diagnostic metric and is not folded into answer F1.

## Measured ablation

Both rows use the same fixed 150 questions and `gemma-4-31b-it`:

| Method | Answer F1 | Evidence recall | Multi-hop F1 |
| --- | ---: | ---: | ---: |
| v1: BM25, 8 sessions | 59.32% | 85.92% | 38.97% |
| `memux-rag-v2` | **61.23%** | **92.71%** | **47.42%** |

The v2 run completed with zero failed or empty model responses. Open-domain F1
regressed from 29.84% to 15.09%, so the aggregate gain comes from retrieval-heavy
multi-hop and single-hop questions rather than uniform improvement. The
evidence-focused abstention retry fired 17 times but did not recover a scored
answer in this run; it is retained in the result metadata for further ablation.
