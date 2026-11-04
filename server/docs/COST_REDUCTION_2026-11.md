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

**New cap from the owner, 2026-11-04: $20 per month per user across Nexeo and Suzi (~$0.66/day). Proposed to Suzi, not yet agreed; see `NEXEO_SUZI_AGREEMENT.md`.** Previous agreed target: $0.90/day per user. All figures are estimates until the bill confirms them.

**Correction.** `retrieval_plan`, `chat_compose` and most of `response_evaluation` ran only in the nightly build's window (146 of 147 planner calls at 02:00–03:59 UTC) and stopped with it on 3 Nov. So OPT-007 did not produce the ~$0.40/day first credited to it: stopping the nightly build did.

| # | Change | Est. saving/day | Status |
|---|---|---|---|
| 1 | Prices as billed; billing labels on every Vertex call (OPT-005) | $0, gives measurements | live (D-153) |
| 2 | Scoring: per-email ceiling, now 24 h while under 3 days old, 7 days after (OPT-006) | ~$1.50 | live (D-153), tightened in D-154 |
| 3 | Planner index (OPT-007); nightly build stopped | ~$0.60 | live |
| 4 | WhatsApp-down message written once per window (OPT-008) | ~$0.09, ~$1 on an outage day | D-154 |
| 5 | Mind State once a day (OPT-009) | ~$0.06 | D-154 |
| 6 | One triage reasoning per email (OPT-010) | ~$0.40 | D-154 |
| 7 | Suzi's server: labels, token logging, per-turn lines out of the system prompt, long results capped (OPT-011) | not yet known | live (D-155). Flash NOT switched: not needed so far |

**Rejected: triage on Flash.** Tested on 30 real emails with the same prompts: action agreement Flash/Pro 17/30 against Pro/Pro 23/30, archetype 18 vs 26, noise 23 vs 28, critical 26 vs 29. Flash missed 7 of Pro's noise calls. The per-email hold saves about the same without changing the model.

**Correction, D-155: Suzi is probably not the $1.70/day first assumed.** Real token counts are 3,000–4,300 per round, about $0.02 per brief turn, so roughly $0.40/day at 21 turns a day (the real Mac declares more tools, so this may be low). The ~8.7M Pro tokens missing from the ledger fit `reasoningCompose.ts:307`, which calls Pro directly and records nothing, under the nightly build's ~146 test questions at 60–100k tokens each. That build stopped on 3 Nov. Unproven until the bill by label.

**Current estimate: Nexeo ~$0.50/day + Suzi ~$0.40/day = ~$0.90/day, with no change to Suzi's model.** Still to do: record compose spend in the ledger.

**Added 11-04: the Mac app also bills to project nexeo-tmc** (~$0.25/day beyond the free tier, Suzi's figure), so the honest total is **~$1.15/day**, not ~$0.90. The $0.94 of image generation was the 3dAI character builder. Further cuts wait on the Nexeo–Suzi agreement.

**Owner's rule, 2026-11-04: "reducing cost doesn't mean to compromise the quality".** A saving ships only if a test shows it is no worse than today.

Quality risk already live, to review: OPT-006 holds a score's model part for 24 h (7 days once the email is older than 3 days), and OPT-010 holds a triage decision for 7 days (refreshed when the user acts). Both can lag new information, such as a new deadline or open item from that sender. Proposed fix, not built: refresh early when a signal actually changes, not by the clock.

## 3. Measurements

Written per deploy in `brain_evaluation_chart.md` (D-153 onward). What to compare, per day, from `llm_spend_unified` and from the GCP bill by label:

- `criticality_fuse` calls/day: 2,139 before. After D-153 (14:01 PKT): first pass 118 calls, then 1 call in the next 10 minutes; the 6-h steady state is still to be read.
- `retrieval_plan` input tokens per call: 80,270 before; the planner prompt is now 41,634 chars (~10k tokens).
- Cost per Suzi conversation and the input:output ratio: measurable once the labels show in the bill (`app=nexeo` vs Suzi's own label).
