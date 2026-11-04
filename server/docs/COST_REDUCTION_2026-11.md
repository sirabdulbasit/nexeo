# Cost reduction, November 2026

**Owner's target (2026-11-04): Nexeo under $1 a day for one user.**
Baseline: GCP project `nexeo-tmc`, Vertex AI, 28 Oct–4 Nov 2026 (8 days), **$43.30 = $5.41/day**, no credits.

## 1. Where the $43.30 went

Billed SKUs (from the owner's breakdown):

| SKU | Tokens | Cost |
|---|---|---|
| Gemini 2.5 Pro input | 8.37M | $10.46 |
| Gemini 2.5 Flash input | 32.52M | $9.76 |
| Gemini 2.5 Flash output | 3.77M | $9.44 |
| Gemini 2.5 Pro input, long context (>200k) | 1.62M | $4.06 |
| Gemini 2.5 Pro output | 0.40M | $4.01 |
| Gemini 2.5 Pro thinking output | 0.29M | $2.87 |
| Gemini 3.1 Flash Image output | 15.7k | $0.94 |
| Gemini 2.5 Pro cached input | 3.56M | $0.45 |
| other | | $0.69 |

Input:output ≈ 9.8:1. Pro 51% of cost on 10M tokens; Flash 45% on 34M.

What Nexeo's own ledger (`llm_spend`) says for the same days, **re-priced at billed rates**:

| Job | Calls | Cost | Note |
|---|---|---|---|
| `criticality_fuse` (Flash) | 17,112 | ~$15 | ~250 emails; the 90-s critical-bundle sweep rescored drifted prompts |
| `retrieval_plan` (Flash) | 147 | ~$3.5 | ~80k input tokens per call: the whole wiki index |
| `triage` (Pro) | 681 | ~$5 | 2.8 calls per email on Pro |
| other Nexeo jobs | | ~$6 | many small jobs, some on Pro |
| **Pro calls not in the ledger** | | **~$13.5** | probably Suzi's server (161 turns, ~$0.08 each). Unverified |

Why the ledger looked wrong before: `llmSpendService.ts` priced Flash at $0.075/$0.30 (billed $0.30/$2.50) and Pro output at $5 (billed $10). Flash input tokens match the bill (32.6M recorded vs 32.5M billed), so the ledger's counts are right; its prices were not.

**Gemini 3.1 Flash Image ($0.94):** no reference in Nexeo's or Suzi's server's source. Nexeo's image reader uses `gemini-2.5-flash`. Someone with GCP access should check the audit logs for the caller.

## 2. The plan (owner approved the order, 2026-11-04: "decision 1")

| # | Change | Est. saving/day | Status |
|---|---|---|---|
| 1 | Prices as billed; billing labels `app` / `tenant` / `feature` on every Vertex call (OPT-005) | $0, gives real measurements | built 11-04 |
| 2 | `criticality_fuse`: a per-event ceiling, 6 h while recent, 72 h after 3 days (OPT-006) | ~$1.50 | built 11-04 |
| 3 | `retrieval_plan`: the planner index lists only what the planner uses (OPT-007) | ~$0.40 | built 11-04 |
| 4 | Triage on Flash, after a quality test on real emails | ~$0.45 | not started |
| 5 | Other small Pro jobs to Flash | ~$0.35 | not started |
| 6 | Suzi's server: caching, long-context fix, Flash for routine turns | ~$1.30 | waits on the owner's decision 2 (the file holds another session's uncommitted work) |

Expected after 1–6: about $1.40/day. Under $1 needs more from Suzi's side or lighter Suzi use. Suzi's cost rises with use.

Then: a daily spend ceiling for background jobs (not for replies to the user).

## 3. Measurements

Written per deploy in `brain_evaluation_chart.md` (D-153 onward). What to compare, per day, from `llm_spend_unified` and from the GCP bill by label:

- `criticality_fuse` calls/day: 2,139 before.
- `retrieval_plan` input tokens per call: 80,270 before.
- Cost per Suzi conversation and the input:output ratio: measurable once the labels show in the bill (`app=nexeo` vs Suzi's own label).
