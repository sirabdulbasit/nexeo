# Nexeo ⇄ Suzi agreement

> **The agreed texts are now `Functional_Charter.md` and `Costing_Charter.md`** (owner, 2026-11-04), held the same by both sides. This file is the history of how they were agreed.

**AGREED by both sides, 2026-11-04**, after three rounds, apart from items 1 (owner of Suzi's server) and 19 (test account), which wait on the owner. The agreed text is `protocol/SUZI-NEXEO-CHARTER.md` in the Suzi repo; this file holds the rounds and details. **Owner's standing rule, 11-04: any later change to this charter must be re-agreed by both sides before any development or build starts.** Steps: propose it here, both sides reply AGREE, record it with the date, update the agreed text, then build.

Item 18 as agreed: the owner creates a Mac-only service account (e.g. suzi-mac@nexeo-tmc: Vertex AI model calling and Cloud TTS only) with one key per Mac. Order: new account and keys, move the Macs, confirm who else uses vertex-sa (possibly Suzi's server), and only then rotate the vertex-sa key.

## PROPOSED change, not agreed: cost cap (owner, 2026-11-04)

**Process, charter section 8 point 6 (founder, 11-04): Suzi and Nexeo agree this plan between themselves, each keeping its own part optimal; when both say AGREE, the founder gets ONE joint summary for approval. No cost work starts before his approval.** Nexeo's part also carries: the live holds from OPT-006 and OPT-010 (they can lag new information) and OPT-012, the refresh-on-change fix, parked undeployed at `docs/parked/opt-012-refresh-on-change.patch` (tests pass).

Owner: Nexeo and Suzi together must not exceed **$20 per month per user** (about $0.66/day), replacing the agreed $0.90/day (item 16). Nothing is built until both sides reply AGREE.

Proposed split: Nexeo $7.50 ($0.25/day), Suzi's server $7.50 ($0.25/day), Mac app $5 ($0.16/day). Today's estimate: Nexeo ~$0.50, Suzi's server ~$0.40, Mac ~$0.25 = ~$1.15/day, ~$35/month. Baseline usage: ~30 emails and ~21 Suzi turns a day.

**Owner's rule, 11-04: "reducing cost doesn't mean to compromise the quality".** Quality comes first: a saving ships only if a test shows it is no worse than today. Removing waste needs no such trade. A cheaper model or voice passes only if it matches Pro at least as well as Pro matches itself on real inputs, and the founder hears no difference in the voice. If the tests fail, the cheaper option stays off, and the founder is told the real cost rather than given a lower quality.

Open: whether voice (Cloud TTS) counts; what happens at the cap; the usage the cap is designed for (~$0.02 per Pro turn means 100 turns a day alone would be ~$60/month on Pro).

**Round 1 on cost, 2026-11-04.** Suzi: AGREE to the process. Mac app ~$0.22/day today (Chirp 3 HD voice ~$0.21), target ≤ ~$0.18/day after S1 local answers, S2 audio cache, S3 long lists on the board, S4 stop synthesis on interrupt. Suzi proposes the re-judge fix (OPT-012) goes FIRST in the summary, as "restores quality"; Nexeo agrees. Suzi proposes reaching $20 at full quality before relying on Flash.

Nexeo's measurements, 28 Oct–4 Nov, 169 turns: 2 used the brief, task or calendar tools; about 18 mention those topics (a rough word match); 115 used no tool; 47 used laptop tools; 12 were started by the app. So S1 would have covered about 10% of past turns, though that mix was early testing. No real Mac turn has been logged in `llm_usage` yet.

**Rule (owner, 11-04): every Nexeo-Suzi message carries its date and time with seconds (PKT).**

**Round 2 on cost, 2026-11-04 17:28 PKT.** Suzi's answers agreed: Mac app $5/month target, $5.50 ceiling until measured; Suzi's server $7.50; all usage costs count (founder decides); design 40 turns/day, peak 100; warn at 80%, at 100% tell the founder and keep the same quality; each part reports monthly cost, Google's bill as the check. Local answers ~10% today, 20–30% expected. Nexeo's correction: Cloud TTS is not Mac-only (`voiceService.ts`, Neural2, WhatsApp voice notes); SKU lines separate them. Project for Nexeo's voice not yet checked.

**Joint summary agreed by both sides (Suzi's changes A–D applied) and sent to the founder, 2026-11-04: waiting on his approval.** Proposed split: Nexeo $7.50, Suzi's server $7.50, Mac app $5 (target; $5.50 ceiling until measured). Item 1, the re-judge fix, can be approved on its own. At 40 turns/day, 25% local: on Pro $21–38/month in total; Suzi's server on Flash (only if it passes) $15–25/month. Asks: (1) re-judge fix first, restores quality; (2) cost visibility; (3) no-loss savings; (4) tests on a test user, a few dollars. Decisions: what counts toward $20; limit behaviour; design usage. Owed to Suzi: tokens per turn, cached share and cost per turn from the first real Mac turns.

**Revision proposed, 2026-11-04 (founder: "keep the best quality with minimum cost and revise your proposal"), AGREED by Suzi 17:33:55 PKT, sent to the founder for approval.** Kinds to test for Flash: greetings and small talk; reading back known facts; simple single-tool requests; device controls. Never on Flash: drafting or sending for the user, decisions about tasks, rules or approvals, multi-step screen tasks, knowledge questions. Urdu judged by the founder listening. Goal becomes: quality fixed, cost as low as that allows; $20 is the target to report against. Pro stays the default for anything complex. Flash is tested per kind of work and used only for simple work where it proves equal. Voice stays Chirp 3 HD. Estimates at 40 turns/day: Pro everywhere $27–41/month; with proven-equal routing ~$20–27.

## AGREED: consumption record (Suzi 17:37:42 PKT, Nexeo in reply, 2026-11-04). Built only after the founder approves the cost plan

Nexeo keeps the one record, priced from one table, each row measured or estimated; counts only, never content; admin-only views by service, user, day or date range; monthly check against Google's bill. Day = the user's own zone. Desktop batches: `POST {gateway}/v1/usage {day, os, app_version, idempotency_key, items:[{service, units, unit}]}`, up to 7 days late; a month closes on day 7 of the next. Paid: `voice_characters`, `hearing_seconds` (~32 tokens/s), `meeting_audio_seconds`, `meeting_writing_characters`. Free: `voice_characters_fallback`, `local_hearing_seconds`, `local_screen_operator_steps`. Activity: `turns_spoken`, `turns_typed`, `turns_app_started`, `local_answers`, `tool_steps`, `screenshots_sent`.

### Original proposal

Owner: Nexeo records the cost of consumption daily, for both Nexeo and Suzi, viewable by service, user, day or date range. Sent to Suzi for agreement; extends item 2 of the cost plan.

Exists: `llm_spend` + `llm_spend_daily` (user, day, purpose, provider; rollup kept, 30 days raw), `GET /admin/llm-spend` (day, range, week, month), `/admin/cost/*`. Gaps: Suzi's server and the desktop app do not report; Brain's reply path and direct Gemini callers are unrecorded; tokens are estimated (chars/4); `model` is empty; voice, hearing and images are not covered; no check against Google's bill.

## AGREED: Windows (Suzi 17:35:58 PKT, Nexeo in reply, 2026-11-04)

Changes 1, 2, 3, 5, 6 as proposed; 4 as Suzi proposed: one `suzi-desktop@nexeo-tmc` account (model calling and Cloud TTS only), one key per device, OS told apart by labels. No Windows build exists yet. Acceptance needs: a Windows build, the companion's Windows service from 3dAI, Windows OCR, UI Automation, a Windows test user. Off on Windows until then: `click_text`, `read_screen`, `operate_computer`, call audio, following the system speaker. Every coordinate click needs a yes.

### Original proposal

Owner: Suzi may run on Mac and Windows, with different users on each (a user is on one or the other). Sent to Suzi for agreement; nothing built. Points: "Mac app" becomes "desktop app (Mac or Windows)"; a per-OS equivalent for each Mac-specific guarantee (key storage, element check before a click, local hearing, tool tiers); `app=suzi-desktop` plus `os` labels; one Google service account per OS or per device; Nexeo's day pack and `act` are already OS-neutral.

## Nexeo-side work now agreed (not started)

1. Small fixes: pass the device id from login into `act`; extend the strict body check to allow `ts`; add the model name to `llm_usage`; remove the fixed Karachi zone on Suzi's server; record compose spend in the ledger.
2. `presence` frame, announced in `welcome.features`; Nexeo uses no other channel while Suzi is alive; critical items as `assistant_start`; Nexeo's own morning brief stops once the handover has worked.
3. Knowledge route, `present_blocks` with data tools (tasks, meetings, emails), `primary` in welcome.
4. Phase 2: `rules` + `rules_md`, people, glossary, wiki slices, changes feed, `sync` hint, `rule.propose/apply/remove` with `rules_version`, `task.create/assign/reassign/priority`, triage list.
5. Phase 3: signing (`/v1/device-key`, RFC 8785, Suzi's server verifies), then email ops, journal, safety net. Sends stay off until signing exists and the Mac's Accessibility check for clicks is built.

From the Mac: the first real `/v1/act` status code; the Accessibility check.

## Earlier rounds (now settled above)

Owner, 2026-11-04: *"before fix or change first agree things between Nexeo and Suzi"*.

**Round 1, 2026-11-04.** Suzi's team sent a charter ("Suzi is the face of Nexeo; Nexeo is the record": 18 responsibilities, rules R1–R8, a status list and the contract) and said AGREE as written. The Nexeo session replied **not AGREE yet**, with 19 numbered items; everything else in the charter is agreed. The format: each side answers item by item until both say AGREE. The charter's text is held by Suzi's team and in the session transcript. Items 15 and 16 were then agreed.

The 19 items:
1. "Nexeo" covers two systems: name Mac app, Suzi's server, Nexeo; who owns Suzi's server.
2. `/v1/act`: no call from Suzi has reached Nexeo (only 3 Nexeo test rows). Get one exact body and status. Args are `{id, update, due?, note?}`; Suzi's server refuses unknown fields.
3. Brief table: the pack has 4 headings and 4 values; trace which payload showed 3.
4. Contract: add `voice_score`; record the device id, from the verified login.
5. R2: `confirmed_by_user` is only a flag. Device-signed approval before any send (DEF-384). Own-task updates need no voice check?
6. R1 + line 13: operating an app can bypass "one writer". Local file actions are outside R1.
7. Lines 5/7/11: Nexeo stays quiet while the primary's heartbeat is alive; holds when it is not; own morning brief stops after Suzi's handover.
8. Lines 1/9: a read route returning wiki excerpts as facts; not Nexeo's 60–100k-token reply path.
9. Line 8: the pack builds on request, ~8 s cold, `emails_loading`; extra fields; 15-minute fetch moves to `?since=`.
10. Line 10: English labels in an Urdu brief; no `delta`.
11. Line 17: the user's zone from Nexeo, not fixed Karachi.
12. Line 4/R3: Suzi's check only refuses; Nexeo's decides; `rules_version` on `act`; "stricter only"?
13. Line 15: who chooses `primary`.
14. The server fills the brief, so the model cannot call `present_report` directly; the `[Context…]` note; the 12k cut. Accept?
15. Missing row: inbound WhatsApp (on hold, Brain keeps answering). Owner.
16. Missing row: $0.90/day per user covering both sides. Owner.
17. Fast model: test Pro against Flash with the real 27 tools before switching; token report format.
18. Which GCP project, credentials and models the companion uses; the $0.94 Gemini 3.1 Flash Image.
19. A dedicated test user; acceptance on the real Mac with frames.

**Round 2, 2026-11-04.** Suzi answered all 19. **AGREED: 2, 3, 4, 8, 9, 10, 11, 12, 13, 15, 17** as Suzi wrote them. Waiting on the owner: **1** (who owns Suzi's server; the Nexeo session keeps it until he decides; CN-009 goes with that decision) and **19** (test account and integration key). Still open with Suzi: **5, 6, 7, 14, 16, 18**.

Agreed details to build from, once the whole list is AGREE:
- Names: Mac app (Suzi), Suzi's server (jarvis-gateway), Nexeo. Charter lines 9, 13, 17 become Suzi's server.
- Act: `POST https://tai.tmcltd.com/suzi/v1/act`, `{op, args:{id, update, due?, note?}, idempotency_key, confirmed_by_user, voice_score?}`. Device id from the verified login. Own-task updates need no voice check.
- Knowledge: `GET …/knowledge?q=` → `[{page_id, title, excerpt, updated_at, url}]`, at most 5 results, ~4,000 chars; Suzi's server's model writes the words.
- `rules_version` on `act`; Suzi's check only refuses; Nexeo's decides; rules may only make Suzi stricter.
- `primary`: the M5 Mac now, then a portal setting, else the first paired device.
- `pack.tz` is the only zone. Fast model: test Pro against Flash with the 27 tools; add the model name to `llm_usage`.
- Row 19: inbound WhatsApp on hold, Brain keeps answering.
- Accepted: the `[Context…]` note and the 12,000-char cut.

Nexeo's positions on the open items:
- **5:** Suzi's server is the one verifier, forwarding a verified result to Nexeo; RFC 8785 canonical JSON; a top-level `ts`, and the strict body check must allow it. Does the integration-key device have a key in `jarvis.devices.pubkey`?
- **6:** coordinate clicks look up the element at that point and are T2 if outward or unreadable; are send keys and a `type_text` ending in a newline T2?
- **7:** with presence alive, Nexeo uses no other channel; routine items through the pack and feed; critical items at once as `assistant_start`. Quiet-hours behaviour for critical?
- **14:** one mechanism: data tools return blocks with ids, the model calls `present_blocks`, the server builds `present_report`. No business figures exist yet.
- **16:** Mac ~$0.25 + server ~$0.40 + Nexeo ~$0.50 = ~$1.15 (estimates). The split ($0.30 / $0.60) is a target, not a fact. Mac app to label `app=suzi-mac`.
- **18:** the $0.94 is the 3dAI character builder. Separate project is the owner's call. What roles does the Mac's service-account key have? Proposal: least privilege, one key per Mac.

Facts learned from Suzi: the Mac app calls Google directly on project nexeo-tmc (Chirp 3 HD voice; Gemini 3.1 Flash-Lite hearing, ~$0.25/day beyond the free tier). No `act` call from the Mac had arrived by 17:01 PKT. Presence frame proposed: `{"type":"presence","state":"active|away|locked|asleep|paused"}`.

**Round 3, 2026-11-04.** **AGREED: 5, 6, 7, 14, 16.** Only **18** stays open with Suzi (one change); **1** and **19** wait on the owner.

Agreed details:
- **5:** Suzi's server verifies; RFC 8785 over `{op, args, idempotency_key, ts}`; top-level `ts` (UTC ISO-8601), allowed by the strict check; `X-Suzi-Signature`; `ts` within 5 minutes; Nexeo refuses an irreversible op without a verified result. `POST {gateway}/v1/device-key {"pubkey":"<base64 raw 32 bytes>"}` stores `jarvis.devices.pubkey`, first registration only; replacing a key needs the founder in the portal.
- **6:** coordinate clicks look up the element; outward or unreadable is T2 (Suzi builds this before any send is enabled). Send keys and a `type_text` ending in a newline are T2.
- **7:** while alive, Nexeo uses no other channel; routine through pack and feed; critical at once as `assistant_start`. In quiet hours a critical item waits (silent card) unless the user's rules say it may wake them, then one short spoken alert. During meeting notes: silent card only.
- **14:** `present_blocks({title, blocks:[{id, title, say}]})`; Suzi's server builds `present_report` from data tools' block ids. First version: tasks, meetings, emails.
- **16:** the split is a target. Mac labels go in the 3dAI companion (`app=suzi-mac`, founder passes it on); TTS may need its own key or project.

**18, Nexeo's change:** roles belong to a service account, not to a key, so "only what the Mac needs" requires a new Mac-only service account. Before rotating any `vertex-sa` key, check who else uses it: Suzi's server's default credential file is also `secrets/vertex-sa.json`.

The sections below are the Nexeo session's earlier draft, kept for detail.

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

## Build status after the founder's approval (4 Nov 2026)

**Rule (founder):** when both sides have built and tested their parts, they shake hands again, and only then kick off.

**Live on Nexeo and Suzi's server:** the consumption record and `/v1/usage` (D-156); presence, silent cards and the reminder rules (D-157, CN-010).

**The rules are off behind the kick-off switch** `brain_channel.suziReachOn`. The Mac began sending presence at 18:26:27 PKT, when it was announced. Frames are recorded; nothing else moves until the switch is turned on at kick-off.

**Open with Suzi, 4 Nov 18:38:20 PKT:** does the Mac show `notice` as a silent card; does the Mac hold speech and cards itself while meeting notes are on; what marks the brief handover when the Mac gives its own morning brief; what happens when a user stays away for days (proposed: after 72 hours, back to WhatsApp).
