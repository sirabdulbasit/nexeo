# server/docs: what each document is for

Pruned 2026-11-25 (owner: "prune it and remove old/not required or merge"). Removed files stay in git history.

## Rules for this folder

- **One topic, one living document.** Update the owning document instead of adding a new one.
- **No session handoffs, dated snapshots or one-off reports here.** Session state goes in the owning document's state section; a dated finding goes into the change log or the owning document.
- **Before adding a file, add it to this index**, with its owner and what it governs. A document no longer listed here, or no longer read, is retired (`git rm`); its history stays in git.

## Governing documents (named in CLAUDE.md / AGENTS.md)

| Document | What it holds |
|---|---|
| `brain_change_log.md` | DEF rows: defect, root cause, fix, deploy, verification |
| `brain_chat_log.md` | CL rows: every chat log the owner sends |
| `brain_evaluation_chart.md` | One row per deploy: predicted vs observed, verdict |
| `brain_chat_archive.md` | `## Chat N` regression entries (paired with `tests/brainScenarios.ts`) |
| `Wiki-Knowledge.md` | The Wiki: rulings, design, what is live |
| `Rules.md` | My Rules and every rule store |
| `INTEGRATIONS_DESIGN.md` | Integrations wizard and engine |
| `Computer_Operator.md` | The computer operator |
| `Functional_Charter.md`, `Costing_Charter.md` | Nexeo ⇄ Suzi charters (change only with both sides' AGREE) |
| `SuziUpgrade_Charter.md` | Suzi upgrade charter (same rule) |
| `NEXEO_SUZI_AGREEMENT.md` | Round-by-round agreement history with Suzi |

## Reference documents

| Document | What it holds |
|---|---|
| `brain_architecture.md` | Operations architecture; **read at runtime** by `src/scripts/seedOpsManual.ts` (do not move) |
| `security_isolation_model.md` | User/tenant boundary layers |
| `background_jobs_inventory.md` | Recurring jobs and their protection |
| `brain_hardening_audit_2026-07-14.md` | Self-heal runbook, cited in `repairService.ts` alerts |
| `brain_living_assistant_standard.md` | Reply standard scored by `brainResponseEvaluator` |
| `ACTION_ITEM_DEFINITION.md` | Agreed definition enforced by `openItemGate.ts` |
| `GCP_BILLING_VIEW.md` | Actual GCP cost view (`gcpBillingService.ts`) |
| `NEXEO_SUZI_SPLIT.md` | Target direction for the Nexeo ⇄ Suzi split |
| `SIMPLIFICATION_PLAN.md`, `COST_REDUCTION_2026-11.md` | November removal list and cost plan (cited by code and the agreement) |
| `SELF_LEARNING_AGENT_PROMPTS.md` | Prompt templates tied to the owner's self-learning document |
| `WHATSAPP_QR_ARCHITECTURE.md`, `WHATSAPP_INTEGRATION_SPEC.md` | WhatsApp; being worked on by another session |
| `parked/` | Parked patch cited by the agreement |
| `orchestrator/` | Retired pipeline. `state/` is still written by deploys (`deploy-manifests`, `deployed-sha`); `scores/` by the benchmark scripts; the rest is history |

## Removed 2026-11-25

- `handoff-2026-08-27.md`, `handoff-2026-08-31.md`, `handoff-2026-09-03.md`: old session handoffs.
- `capability_matrix.md`: an 8 Jul snapshot, long out of date.
- `NEXEO_SPEC.md`: 19 Jun spec under the old name; superseded by `APP_MENTAL_MODEL.md` and the charters.
- `section35_living_assistant.md`: Suzi talking with everyone concerned; superseded by the WhatsApp user-only rule.
- 1,076 untracked orchestrator logs, loop outputs and retired iteration folders (113 MB), archived at `/root/backups/orchestrator-untracked-20261125_0725.tar.gz`.
