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

## 2. The plan

**Owner's target, 2026-11-04: $0.90/day per user.** All figures are estimates until the bill confirms them.

**Correction.** `retrieval_plan`, `chat_compose` and most of `response_evaluation` ran only in the nightly build's window (146 of 147 planner calls at 02:00–03:59 UTC) and stopped with it on 3 Nov. So OPT-007 did not produce the ~$0.40/day first credited to it: stopping the nightly build did.

| # | Change | Est. saving/day | Status |
|---|---|---|---|
| 1 | Prices as billed; billing labels on every Vertex call (OPT-005) | $0, gives measurements | live (D-153) |
| 2 | Scoring: per-email ceiling, now 24 h while under 3 days old, 7 days after (OPT-006) | ~$1.50 | live (D-153), tightened in D-154 |
| 3 | Planner index (OPT-007); nightly build stopped | ~$0.60 | live |
| 4 | WhatsApp-down message written once per window (OPT-008) | ~$0.09, ~$1 on an outage day | D-154 |
| 5 | Mind State once a day (OPT-009) | ~$0.06 | D-154 |
| 6 | One triage reasoning per email (OPT-010) | ~$0.40 | D-154 |
| 7 | Suzi's server: caching, long calls, Flash for routine turns | ~$1.30 | waits on the owner: the code holds another session's uncommitted CN-009 work |

**Rejected: triage on Flash.** Tested on 30 real emails with the same prompts: action agreement Flash/Pro 17/30 against Pro/Pro 23/30, archetype 18 vs 26, noise 23 vs 28, critical 26 vs 29. Flash missed 7 of Pro's noise calls. The per-email hold saves about the same without changing the model.

Expected: Nexeo ~$0.50/day, Suzi ~$0.40/day once row 7 is done, ~$0.90 in total.

## 3. Measurements

Written per deploy in `brain_evaluation_chart.md` (D-153 onward). What to compare, per day, from `llm_spend_unified` and from the GCP bill by label:

- `criticality_fuse` calls/day: 2,139 before. After D-153 (14:01 PKT): first pass 118 calls, then 1 call in the next 10 minutes; the 6-h steady state is still to be read.
- `retrieval_plan` input tokens per call: 80,270 before; the planner prompt is now 41,634 chars (~10k tokens).
- Cost per Suzi conversation and the input:output ratio: measurable once the labels show in the bill (`app=nexeo` vs Suzi's own label).
