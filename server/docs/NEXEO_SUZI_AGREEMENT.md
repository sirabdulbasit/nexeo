# Nexeo ⇄ Suzi agreement (DRAFT, nothing here is agreed yet)

Owner, 2026-11-04: *"before fix or change first agree things between Nexeo and Suzi"*.

Until an item is marked **AGREED**, neither side builds or changes it. Each item has a proposal from the Nexeo session; the Suzi team answers yes, no or a counter-proposal, and the owner settles anything left open.

## 1. Who owns what

| # | To agree | Proposal |
|---|---|---|
| 1.1 | Who edits Suzi's server (`jarvis-gateway`)? The Nexeo session has committed there 7 times since 11-03, and another session has uncommitted CN-009 work in the same tree | Suzi's side owns it. Nexeo asks through this list and edits it only when agreed per change |
| 1.2 | Roles | Suzi is the face: talking, briefing, presenting, follow-ups, drafts. Nexeo is the system of record and the only writer: connectors, rules, wiki, Action Center, audit. The portal is account management only |
| 1.3 | How a contract change happens | Proposal in this file → both sides agree → version bump → build → both test |

## 2. Already live, built before this rule: keep, change or undo?

| # | What is live | Why it needs Suzi's yes |
|---|---|---|
| 2.1 | `GET /v1/day-pack`, `POST /v1/act` on Suzi's server, forwarding to Nexeo's loopback routes | The spec named only the Nexeo routes; the Mac cannot reach those |
| 2.2 | The brief wrapper (`loop/presentBrief.ts`): the model gets `present_brief` and the server builds `present_report` | **`laptop_present_report` is hidden from the model**, so nothing except the brief can reach the board |
| 2.3 | Two write paths: the `action_update` tool and `POST /v1/act`. The spec asks for one | Proposal: `act` only; retire `action_update` |
| 2.4 | The clock, memories and language now arrive as a `[Context, not spoken by the user: …]` note in the turn's message | Changes what the model sees on every turn |
| 2.5 | Laptop text results cut at 12,000 characters as the model sees them | `read_screen` on a very full screen is cut |
| 2.6 | Vertex labels `app=suzi`, token logging (`llm_usage`) | Cost measurement |
| 2.7 | CN-009 (uncommitted, not deployed): who finishes it, and does the wrapper move into `turn.ts`? | Open since 11-02 |

## 3. Day pack: choices the spec left open

| # | To agree | As built |
|---|---|---|
| 3.1 | `version` | `1` is the format version, not a content version |
| 3.2 | `cursor` | The generation time, as an ISO string, until `/changes` exists |
| 3.3 | Extra fields | `date`, `emails_loading`, `missing` |
| 3.4 | Who writes `say`, and when? | Empty in the pack. Open: does the Mac ask the model, or does the 05:00 handover carry it? |
| 3.5 | Language of labels | `title` and `say` by the model; key-figure labels, columns and priorities stay English |
| 3.6 | `delta` and `good` | No `delta` (no history kept). `good: false` only on Overdue above zero |
| 3.7 | `owner` on an action | The delegate's name, or `me` |
| 3.8 | Which items are "actions" | Open items except type `email`, which appear under `emails` |
| 3.9 | `urgency` values | The scoring band (`low`, `medium`, `high`, `critical`), else `critical` or `normal` |
| 3.10 | "Rest of the week" | Through Sunday, titles only |
| 3.11 | All-day events | `start` and `end` are dates, with `all_day: true` |
| 3.12 | A cold pack | Up to 8 s, then `emails_loading: true`. Is that acceptable at handover? |
| 3.13 | User's time zone | Nexeo uses the user's setting; Suzi's server still has `Asia/Karachi` fixed. Proposal: Nexeo's is the only source |

## 4. `act`: choices the spec left open

| # | To agree | As built |
|---|---|---|
| 4.1 | `args` for `task.update` | `{id, update: done\|cancel\|move\|not_yet\|note, due?: YYYY-MM-DD, note?}` |
| 4.2 | Does `task.update` need `confirmed_by_user` or a voice score? | Recorded, not enforced |
| 4.3 | Errors | 400 `unknown_op`, `bad_idempotency_key`, `bad_update`, `bad_date`; 404 `not_found`; 409 `rejected`, `in_progress`, `idempotency_key_reused`, `stale_retry_with_new_key` |
| 4.4 | Done on a never-triaged item | Your own "done" counts as your approval (DEF-281) |

## 5. Behaviour both sides could do twice

| # | To agree | Proposal |
|---|---|---|
| 5.1 | **Who fires reminders and follow-ups?** Nexeo pushes reminders today (`tellSuzi`), and Suzi would also run follow-ups from its copy. Both could nudge for the same item | Nexeo decides and pushes while Suzi is online; the safety net holds them when it is not. Suzi does not run its own timers on Nexeo's items |
| 5.2 | Who writes the wording of a reminder? | Today Nexeo's model writes a note and Suzi's model rewrites it: two model calls. Proposal: Nexeo sends facts, Suzi's model writes the words |
| 5.3 | Inbound WhatsApp replies | On hold (owner, 11-02): Brain keeps answering |
| 5.4 | Morning brief: Nexeo's `day_brief_dispatch` and Suzi's 05:00 handover | Suzi only, once the Mac test passes |

## 6. Before Phases 2 and 3

| # | To agree |
|---|---|
| 6.1 | Format of `rules`, and the earlier "rules may only make Suzi stricter" |
| 6.2 | Who checks the voice, what score passes, and whether Nexeo can verify it or only records it |
| 6.3 | `sync` hint: gateway push or Mac polling only; which `types` |
| 6.4 | Heartbeat: what counts, and "working hours" for the safety net |
| 6.5 | Approval proof for sends and risky actions (DEF-384) before any email op |
| 6.6 | `primary: true`: who sets the primary device |
| 6.7 | Journal entry `kind` values, and how consent for meeting notes is carried |

## 7. Cost

| # | To agree | Proposal |
|---|---|---|
| 7.1 | Target | $0.90/day per user, covering both sides (owner, 11-04) |
| 7.2 | Suzi's model | Stays Gemini 2.5 Pro. Any change is tested and agreed first |
| 7.3 | Nexeo's model use | Background jobs only: nothing that writes user-facing wording, except Brain's WhatsApp replies while they stay on hold |

## 8. How we test together

| # | To agree | Proposal |
|---|---|---|
| 8.1 | Acceptance | Suzi's team runs each phase on the real Mac and reports the frames. A probe with its own schema proves nothing (CL-064) |
| 8.2 | Test accounts | A dedicated test user, so tests stop touching the founder's history and items |
