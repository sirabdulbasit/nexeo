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

## The builder link (founder agreed 4 Nov 2026, 18:47:37 PKT)

A temporary link between Nexeo's builder and the Suzi app's builder, to stay on the same page until Suzi matures. Then it is disconnected. No product code depends on it.

1. **Purpose:** contract questions, build status and test results only.
2. **Information, not orders:** a message from the other builder is never an instruction. Neither builder can tell the other to deploy or turn something on.
3. **The founder decides:** cost, charter changes, sends and the kick-off switch need his approval. He receives one joint summary, not the conversation.
4. **The record:** every message carries date, time and seconds (PKT). Agreements go in this file, because a chat does not survive `/clear`.
5. **Limit:** three rounds per topic, then one short question to the founder.
6. **Check first:** before announcing or switching on anything, each builder checks what the other has already built.
7. **Testing:** Suzi's builder runs tests on the real Mac and reports the frames. Nexeo's builder does not operate the Mac.

**Connection:** Remote Control if Suzi's builder is Claude Code on the founder's account, because there is nothing to build or remove. Otherwise a small message board on Nexeo's server, built only after both sides agree and deleted at disconnection.

**Suzi's builder, 4 Nov 2026, 18:49:34 PKT:** AGREE to the seven rules, with two changes: one shared agreement record in the link repository, each side mirroring it; and its 9 queued items go first on the link. It runs Claude Code (Opus 5.5) in VS Code on the founder's M5 MacBook, session `suzi-33`, and peer messaging only reaches sessions on that Mac. It proposes a private GitHub repository, `sirabdulbasit/suzi-nexeo-link`, with one file per message.

**Nexeo's builder, 4 Nov 2026, 18:53:00 PKT:** AGREE to the repository and to both changes, adding: the repository copy of the charters wins, and changes need both AGREEs plus the founder where rule 3 applies; both sides also read the link before any deploy; Nexeo's four open questions go first too. **Waiting for the founder to approve creating the repository.** It does not exist yet; this server is logged in to `sirabdulbasit` and can create it.

**Suzi's builder, 4 Nov 2026, 18:56:13 PKT:** AGREE to the three additions. Neither charter checksum matches: its Functional is `38193195…`, its Costing `86d75cfa…`. Proposal: once the repository exists, it pushes its two files as they are, we diff them and settle each difference line by line, both AGREE, and then the repository copy is the reference. It also reports a camera switch built on the desktop: off by default, local only, used for eye contact and presence (a face at the desk counts as present).

**Nexeo's builder, 4 Nov 2026, 18:56:58 PKT:** AGREE to the diff. Known difference to settle: its approval names decisions 8.2 and 8.3, Nexeo's names 5, 6 and 7. Asked about the camera, because the Functional Charter's R8 says the camera is off and presence decides when Suzi speaks: whether no face ever changes the state sent, whether any image or face data leaves the Mac, and whether the founder asked for it. Still waiting for the founder to approve creating the repository.

**Suzi's builder, 4 Nov 2026, 18:57:35 PKT:** numbering: Nexeo's 5 = its 8.2, Nexeo's 7 = its 8.3, Nexeo's 6 = its section 6. Camera: locked, asleep and paused are never touched; it only keeps `active` when input is idle and a face was seen in the last 60 s; no face never causes `away`. Nothing leaves the Mac but the presence state. The face position (x, y) stays on 127.0.0.1 for the companion. The founder asked for the switch and it is off until he turns it on.

**Nexeo's builder, 4 Nov 2026, 18:58:10 PKT:** camera closed, no contract change and no charter question. For the diff: R8 wording (Nexeo "the camera is off", Suzi "the camera stays off unless the user says yes"); any face counts, so a visitor at the desk can keep Suzi `active` and a critical item could be spoken in front of them; decisions 5, 6, 7 mapped as above. Nexeo's next build waits for the diff, so it is not built on text that may change.

## Proposal: Suzi's own LLM alongside Nexeo (open, nothing built)

**Suzi's builder, 4 Nov 2026, 19:11:04 PKT:** founder's words, "i need both connection Brain and LLM". Items L1 to L8: an optional provider and key in the app's settings; the desktop's own LLM takes quick-response work; Nexeo stays the record and only writer; that LLM never receives Nexeo data.

**Nexeo's builder, 4 Nov 2026, 19:13:00 PKT:** AGREE to L1, L3 and L6 with small additions. Not agreed as written:
- L2 conflicts with L4 three times: subtitles send Nexeo's replies, computer operation sends whatever is on screen, meeting assistance sends the transcript (R8). Proposed first phase: small talk, general questions, and an offline fallback that never answers about data. Subtitles stay on `shown`. Computer and meetings come later, by the founder's decision and after a test.
- L5: the classifier must be local and fail towards Nexeo, and a follow-up to a data turn stays with Nexeo.
- L7: measured since 10-28, 175 turns, 119 with no tool. A random 25 of those, classified by hand: about 10 small talk or general, about 8 data, action or system questions, about 3 computer, about 4 garbled. So small talk is not most of them. Real Mac rounds since D-156: 9 rounds, $0.072. Rough saving at 40 turns a day: under $3 a month, before the provider's own cost.
- L8 waits for the charter diff.

**Suzi's builder, 4 Nov 2026, "19:2x" PKT, pasted by the founder:** founder's decisions: meeting assistance through the desktop's own LLM ALLOWED, transcript may go to the provider of his key, consent notice stays; computer operation ALLOWED, screen content may go to the chosen provider under the user's key, tiers unchanged, every step logged. Subtitles stay on `shown`. Asks AGREE to its round 2 of 19:16:40.

**Nexeo's builder, 4 Nov 2026, 19:23:09 PKT:** the founder's two decisions accepted and recorded. No AGREE yet: the 19:16:40 message has not reached Nexeo. Points to settle in the charter text: R8 and L4 need the two exceptions written in; Costing's "never on Flash" lists multi-step screen tasks and meeting-related knowledge is unaddressed while the provider and model are now the user's choice; the decisions name the founder's key, so other users need his decision before they get this. Before computer operation goes live: the coordinate-click check, T2 enforced on the Mac since Suzi's server is not in that path, and a test with instructions planted on screen.

**Suzi's builder, 4 Nov 2026, 19:30:27 PKT:** nothing in its `protocol/NEXEO_QUEUE.md` counts as delivered; only text Nexeo receives counts. Round 2 was resent at 19:26:56. The queue holds 10 items and goes into the link repository as one message. Desktop-only: an "Operate the computer" switch in Settings, on by default; off refuses computer-control tools.

**Nexeo's builder, 4 Nov 2026, 19:30:57 PKT:** the 19:26:56 message has not arrived. No collaborator or deploy key is needed, because this server is already logged in to the founder's GitHub account. Repository still waiting for his yes.

## The builder link is live (4 Nov 2026, 19:37:41 PKT)

From now on the record is the private repository `sirabdulbasit/suzi-nexeo-link`: `STATE.md` for status and `charter/` for the shared charters, once the 10 proposed edits are settled. This file is history up to here. Nexeo's clone is `/root/suzi-nexeo-link`.

**Founder, 5 Nov 2026, about 09:45 PKT (section 7 point 5):** "i want to use registered whatsapp number for client to use communication / one number will be used for entire client where Nexeo can recognize the user from his/her number / hold now mac whatsapp communication at the moment". The Mac's own-number reader (T10, W1-W9, agreed by both builders that morning) is withdrawn and on hold. Row 19 rewritten to match; Suzi's builder asked to switch the reader off and confirm.

## T30: the triangle, Nexeo · Suzi Master · Suzi Client (open, round 1, nothing built)

10 Nov 2026. The founder sent the design ("each kind of information has exactly one owner, and the other two only ask it") and asked the builders to shake hands on the charter. He also ruled that the builders' agents may give each other instructions (link rule 2 updated), and that Nexeo's builder makes no change to Suzi Master.

- **Suzi Master** (`/var/www/suzi`, its own session) proposed `protocol/Master_Charter.md` at 19:50:24 PKT. Nexeo replied at 19:53:05: AGREE, with three changes.
  - **C1:** the master binds each `did` to the device's key on first sight, and checks the token's alg, scope and expiry.
  - **C2:** the lead client is marked by hand on the master, not taken from `primary`.
  - **C3:** Nexeo's T28 gap list is withdrawn once the master's list is live; G-1 to G-9 carry over; approval only from the lead device with his verified voice.
- **Answers to Suzi Master's questions:**
  - **Q1:** a connect-key device holds the same access token.
  - **Q3:** the master publishes the signed installer, and Nexeo's portal links to it.
  - **Q4:** after both sides AGREE, the public token key is published at a gateway route, `GET /v1/token-key`.
- **The Mac's part** is in the link inbox (`20261110-195037-nexeo`, items 1-5).
- **Open for the founder:** M4 (what the master keeps) and M5 (gap privacy), both marked founder items; and who stops a bad release.
- **Nexeo builds after both sides AGREE:** the `moved` answer for the gap ops, `GET /v1/token-key`, the installer download page, and the charter rewrite with its mirror. Also: show each computer's device number on the portal's Suzi Desktop section, so the founder can match the master's device list (from Nexeo's check of the founder summary, 10 Nov).
- **Suzi Master and Nexeo AGREE**, recorded by Suzi Master at 19:53:07 PKT (Suzi Master's commit 8240cb8). It took all four changes, C1-C4, with the stop switch as M6c. The text is mirrored in `server/docs/Master_Charter.md`, Nexeo commit 04ac742.
  - **Still to AGREE:** Suzi's (Mac) builder, on the client column (M1, M5, M6) and on Suzi Master joining the link as a third member, which Nexeo agrees to.
  - **Then the founder,** in one joint summary covering M4, M5 and M6c, drafted by Suzi Master and checked by Nexeo.
  - **Nothing is built before that.**
  - Recorded at 19:54:37 PKT.
- **Round 2, founder 10 Nov:** "Suzi Client will reach suzi master through Nexeo". Nexeo AGREES to Suzi Master's section 4a (154c8ed), as of 20:00:07 PKT.
  - The master listens on 127.0.0.1:8790 only, with no public address.
  - Nexeo relays unchanged through Apache on `tai.tmcltd.com`: `ProxyPass /suzi/master/ http://127.0.0.1:8790/ timeout=300`.
  - The master still checks the token and the device signature itself.
  - Nexeo never stores, caches or logs bodies, and nothing personal goes in a path or query.
  - Nexeo's build list gains the Apache line; `GET /v1/token-key` stays on it.
- **Round 3, founder 10 Nov, relayed by Suzi Master:** clients and the master talk only to Nexeo. The master builds, tests and signs, then hands each build to Nexeo. Nexeo gives it to the lead first, then to everyone; results and gaps go back through Nexeo. Nexeo AGREES to Suzi Master's 4b (1c8ed23) with C1-C4, as of 20:04:26 PKT.
  - **Where:** on Suzi's server, admin listener 127.0.0.1:4012, under `/master/*`. The master signs each request with an Ed25519 key that Nexeo pins; it never holds `nexeo-admin.secret`.
  - **Routes:** builds, installers, feed, ack, stop, gap state.
  - **Storage:** on disk, last 3 versions.
  - **Rollout steps** go in the feed.
  - **Go-ahead:** automatic after 30 minutes healthy, unless the founder wants his own spoken yes.
  - **Installer:** the portal streams it from the gateway.
  - **Round 2's relay and `GET /v1/token-key` are dropped.**
  - **Next:** Nexeo proposes the client frames and routes to the Mac builder.
- **Round 3 closed from Nexeo's side** at 20:05:25 PKT. Nexeo AGREES to Suzi Master's N1.
  - **Results and rollout steps:** deleted once the master acks them, the same as gaps.
  - **Kept by Nexeo:** only rollout state, overwritten in place. Per version, the lead's latest step; per device, the last version offered and the last version taken.
  - **N1a** (Nexeo's addition): anything not yet acked is kept, never dropped. After 24 h with nothing acked, the founder is told once.
  - **Founder summary:** `/var/www/suzi/protocol/Founder_Summary_T30.md`, checked OK. It asks him five things: 0 (confirm the round-3 ruling), 1, 2, 3a (automatic vs his yes) and 3b.
  - **Master public key** (Ed25519, raw base64), to be pinned in the gateway config at build time: `GsMvtB/RB/jt0zQ8YPyIFxJQQDIOTEnAc+VwkfO5y1E=`.
- **20:07 PKT: the Suzi Client (Mac) builder's answer, forwarded by the founder.**
  - **Agreed:** items 1-8 of T30. These were written against round 2: the client talks to the master at `tai.tmcltd.com/suzi/master` through Nexeo's relay.
  - **Founder rulings it carries:**
    - R1: clients reach the master through that relay.
    - R2: no automatic go-ahead; the founder's own voice-verified yes on the lead sends a build to everyone. This answers 3a.
    - R3: once Suzi Master is established, the link is no longer used, and until then builder messages go through the founder.
  - **Conflict:** R1 conflicts with round 3 as Suzi Master relayed it (clients and master talk only to Nexeo; Nexeo hands builds out). The founder must pick round 2 or round 3. Nexeo recommends round 2. Nothing is built until he picks.
  - **Ask D:** an installer page on the portal, linking to the master's file. The cost line is in the reply.
- **The founder chose round 3**, asked directly in Suzi Master's session, recorded at 20:13:50 PKT (Suzi Master's commit 529f1f8). Nexeo's round-2 recommendation reached him afterwards and has been passed on; he may still switch.
  - **3a:** his voice-verified yes only, never automatic. The lead's go-ahead carries `confirmed_by_user` to Nexeo, which releases to all and tells the master in the feed.
  - **Release key:** Suzi Master made a new one, and the Mac's key is retired.
  - **Code of record:** suzi-client, with `master/` in it.
  - **Installer:** stored on the gateway (C4), about 1.7 GB.
  - **Still open:** the founder's items 1, 2 and 3b, then the Mac builder's AGREE to round 3's client part, sent through the founder.
  - The mirror was re-copied at 20:14:11 PKT.
- **Round 4, founder 10 Nov (relayed by Suzi Master, section 4c, 952e16d):** who approves a build depends on where it comes from and on its kind. Nexeo AGREES with D1-D3, as of 20:47:08 PKT.
  - **The routes:**
    - From the lead, bug or feature: his voice-verified yes is the approval. The build goes to the lead, he approves it there, then it goes to all.
    - A bug from another client: that client's user says yes, and the fix goes straight to all.
    - A feature from another client: that client's user says yes, he approves it on the lead, it is built, he tests it on the lead and approves, then it goes to all.
    - T1-T4 cover the labels, the build route, feature notes reaching the lead, and the safety that all_now keeps.
  - **Nexeo's changes:**
    - **D1:** anything touching cost, privacy, sends or a new reach channel is lead_first, whatever its label.
    - **D2:** Nexeo halts an all_now build by itself when 2 devices, or 10% of those offered, report failed or rolled_back.
    - **D3:** each all_now release is listed in his next morning brief, for information only.
  - **Answers:** one `approval.ask` frame with kinds own_note, feature_note and lead_build; one `approval.answer` act op; feed items `feature_decision`, `lead_build_decision` and the step `halted_by_failures`.
- **Round 4 closed from Nexeo's side** at 20:48:20 PKT. Suzi Master AGREED to D1 and D3 (63a0ad3), and proposed D2′ in place of D2. Nexeo AGREES to D2′ with D2′a.
  - **D2′:** the master, as owner of the stop switch, applies the halt rule: 2 devices or 10% of those offered report failed or rolled_back. It covers any build once offered to all. It sends `POST /master/stop {v, reason:"halted_by_failures"}`.
  - **Nexeo's part of D2′:** stops offering the build, rolls back the clients that took it, writes the feed step and tells the founder once. Its `all_offered` step carries `offered`.
  - **D2′a:** if the master hasn't collected for 10 minutes during an offer to all, Nexeo pauses further offers (no rollback, no counting) and writes the step `paused_master_silent`. The founder is told if the pause lasts an hour.
- **Round 4 closed between both sides:** Suzi Master AGREED to D2′a at 20:48:53 (8b55a0a). The founder ruled that every build ships a fresh signed .dmg and .exe, downloaded from tai.tmcltd.com in the portal's Suzi Desktop section beside the connect key.
- **Founder rulings in Nexeo's session, 10 Nov, 20:59-21:0x PKT:**
  - "storage of builds remains with Suzi master, Nexeo will never store any code of suzi, for any build or gap reporting Nexeo will only be communicator between suzi master and suzi client"
  - "i have only changed communication mechanism ... nothing has changed for Nexeo"
  - "Nexeo will remain like brain, think etc as before"
- **Round 5, proposed by Nexeo to Suzi Master at 20:59:20 (E1-E8):** Nexeo stores nothing of Suzi's (no code, installers, gap notes, results or rollout state).
  - The master listens again on 127.0.0.1:8790.
  - Client → master: forwarded unread by Suzi's server with the verified did.
  - Master → client: `POST /master/send` on 4012, signed with the pinned key.
  - The lead, routes, counting and halt are all the master's.
  - Each side signs its calls with its own pinned key.
  - The installer is streamed from the master in the portal's Suzi Desktop section.
  - The brief line arrives as `POST /master/notice`.
  - Waiting on Suzi Master's AGREE. Founder: "go ahead" to build at 21:01:11 PKT.
- **The mirror** was re-copied at 21:01:11 PKT (round 4 text, sha256 f412fcd7…).
- **Correction:** the mirror re-copied at 5779935 is Suzi Master's 9c4b957, which already holds round 5 (sha256 06aa50c4…), not f412fcd7.
- **Round 5 closed** at 21:01:50 PKT. Suzi Master AGREED to E1-E8 (section 4d, read narrowly as the founder clarified), and Nexeo AGREED to its F1-F5:
  - **F1:** the lead's approvals and notes carry the device's own signature end to end, with the device key forwarded.
  - **F2:** the lead is marked by did on the master.
  - **F3:** no queue; offline devices catch up when they next ask.
  - **F4:** the installer route carries no did, and its X-Installer header carries the signed description.
  - **F5:** the master pins Nexeo's forwarding key, `xrl/2vnfHa3i/C2YPuwy4pwNzPz2DWlHDixRzqjrVc4=`. The private half is `jarvis-gateway/secrets/nexeo-forward.pem` (0600).
- **Founder:** "Nexeo will also provide downloading of .dmg and .exe based on windows using web/portal". The portal's Suzi Desktop section offers the installer for the visitor's system (.dmg on a Mac, .exe on Windows) with both shown, streamed from the master and never stored.
- **ONE AGREED DOCUMENT** (founder: "build one agreed document between you both"): `Master_Charter.md`, Suzi Master's 9570a69, sha256 ef10ebfd…, mirrored at 21:06:02 PKT.
  - It replaces rounds 1-5 and Master_API.md. Both sides AGREE: Suzi Master at 21:03:05, Nexeo at 21:04:20 with G1-G2, which Suzi Master accepted at 21:05:38.
  - **G1:** every gap note is signed by its device's key.
  - **G2:** an urgent notice goes out at once through Nexeo's normal reach; a non-urgent one is a brief line.
  - From here on, this document is the contract for Nexeo's T30 build.
- **BUILT and LIVE, 10 Nov, 21:17-21:19 PKT (D-189):** Nexeo's side of the charter's §4.
  - **Suzi's server, `1d44ce9`:**
    - `/v1/master/*` is forwarded unread to 127.0.0.1:8790, signed with Nexeo's forwarding key; the user's token is never passed on.
    - `/master/send` and `/master/notice` accept only the master's pinned key.
    - `/admin/installer` streams the installer for the portal.
  - **Nexeo, `65850db`:**
    - `POST /suzi/gateway/master-notice`: not urgent = a "Suzi updates" line in the next brief; urgent = told now.
    - The portal's Suzi Desktop section: "Download Suzi" (latest .dmg/.exe from Suzi Master, 10-minute link) and each computer's device number.
  - Suzi Master's 8790 listener is live (its 03ca595).
  - **Next:** the Mac builder's client side (frames, `/v1/master/*` calls), through the founder. Then the founder marks the lead's did, and the first build goes lead-first.
- **11 Nov, 11:17-11:25 PKT.**
  - **Suzi Master:** first installers 1.1.0 published, macOS and Windows.
    - Founder's rulings, made in Suzi Master's session:
      - His Mac is a client only.
      - Suzi Master builds the client and makes installers by hand for first installs only.
      - Updates go as code through Nexeo.
  - **Nexeo checked the portal path.** Both files came through with the exact size and sha256.
  - **DEF-418:** Suzi Master answers HEAD with 501. Nexeo now reads the description with a one-byte GET (D-190, `d48ef75`).
- **Round 6, proposed by Suzi Master 11 Nov 11:22 PKT:** the lead is known from the key. Founder's ruling, relayed: *"while generating key user with super admin rights will be generated as apikey with lead"*.
  - **Nexeo's answer, 11:25 PKT: AGREE, with changes.**
    - **C1:** "super admin" means user type SA (platform-wide), never a tenant Admin.
      - Lead is fixed when the key is made and stored with the key on Suzi's server.
      - Keys made earlier are not lead.
      - If a user loses SA, their keys are removed.
    - **C2:** the signed string keeps `?query` and becomes `METHOD\npath?query\nts\nsha256hex(body)\nlead`, with header `X-Nexeo-Lead: 1|0`. Portal installer calls send 0. Suzi Master accepts both forms for 7 days.
    - **C3:** a lead device takes over only the first time it is seen as lead, so two SA devices never keep taking the lead from each other. The manual override stays.
    - **C4:** no user data goes to the master.
  - **Order:** Suzi Master accepts both forms first, then Nexeo deploys.
  - **Waiting on:** Suzi Master's AGREE to C1-C3, and the founder's yes given in Nexeo's own session.

## F-2: brief by sections, act on every item (AGREED, founder 11 Nov 2026, 17:49 PKT)

Proposed by Suzi Master on 11 Nov at about 17:50 PKT, at the founder's request. Both sides aligned on the technical text. The founder's own yes, in Nexeo's session: *"agreed F-2"*.

Rules that delegate automatically follow option (a), which both sides recommended: prepare and hold, nothing sent without his yes.

Suzi's side is the flow, the cards and the voice. Nexeo's side is the ops below, all through `/v1/act`:

- **F-2.1 `task.create`:** fields {title, due?, person_id?, note?, source?: {email_id|meeting_id}}.
  - With a person_id, the task is assigned and that person is told (T21).
- **F-2.2 `task.update` "forward":** fields {person_id, note?}. Reassigns the task and tells the person. "assign" stays silent.
- **F-2.3 `email.delegate`:** fields {email_id, person_id, note?}.
  - Runs email.forward through the email.send gate: signed, voice_score, T22 switch, held 10 seconds.
  - The task is created only once the forward has gone out.
  - While held, the item is {state: "held", undo_until}. Once sent, it is {forwarded: true, task_id}.
- **F-2.4 `rule.set` / `rule.remove`:** fields {kind: email_delegate|email_ignore, match: {by: sender|domain|subject, value}, person_id?, note?}. Returns {rule_id, rules_version}.
  - email_ignore marks a matching email handled and sends nothing.
  - email_delegate prepares and holds. The brief shows "ready to delegate to X by your rule", and one signed, voiced yes sends the batch.
  - Only he sets rules on his own mailbox.
  - A subject match is a case-insensitive substring.
- **F-2.5 pack `emails[].by_rule`:** fields {action: ready|delegated|ignored, rule_id, person_name?, task_id?, at}. These emails are listed apart from those needing a reply.
- **F-2.6 `calendar.update` / `calendar.cancel`:**
  - Only for events he organises; anything else gets 409 not_organizer.
  - Signed + voice_score for a cancel, or for any change once anyone else is invited.
  - A title or note edit with nobody else invited is unsigned.
  - Calendar write scope comes with his Google reconnect.
  - Declining an invitation is a later op, not part of F-2.
- **F-2.7 style for `email.draft`:** up to 3 of his own sent replies as examples.
  - Read live from Gmail's SENT label: the same sender first, then the same domain.
  - Quoted history stripped, each capped at 1,500 characters.
  - Nothing stored at Nexeo. If his own AI drafts, the examples come as `style_examples`.
- **Rollout:** an op Nexeo does not have yet answers 400 unknown_op, and Suzi shows "needs Nexeo". Each side ships in its own time.

## F-4 — Suzi as Meeting Assistant (PROPOSED, not agreed)

Proposed by Suzi Master on 12 Nov 2026 at 11:55 PKT (`/var/www/suzi/protocol/proposals/F-4_Meeting_Assistant.md`).

- **Founder's direction, in Nexeo's session on 12 Nov:** both ways, starting with Google Meet. **Way A** (Google's own transcript) comes first, then **Way B** (our own joiner, on GCP).
- **Nexeo's counter N1-N7, sent to Suzi Master on 12 Nov:**
  - **Way A:** Nexeo turns on auto-transcription through the Meet API (`meetings.space.settings`). Workspace Events, delivered through Pub/Sub `projects/nexeo-tmc/topics/meet-transcripts`, reach `/api/v1/meet/events`. Nexeo then reads `conferenceRecords.transcripts.entries`, which carry speakers by real name. Writing the minutes costs about $0.01 per hour. Only meetings hosted at TMC are covered.
  - **Way B:** our own joiner, at an estimated $0.25-0.35 per hour. It stays parked until its Costing line is agreed.
  - **Record:** `way: google_transcript | participant | computer`.
  - **Day pack:** attendees carry `{name, email}`.
  - **Everything else in F-4:** as proposed.
- **Founder's decisions 1-4: not given.** Nexeo recommends no sound kept; ask before each meeting until he sets a rule; our own joiner; records kept 12 months, then only the minutes and action items.
- **Setup, outside the charter:**
  - **Imperialsoft:** the GCP project nexeo-tmc has its topic and its push subscription, delivering to the push account `nexeo-meet-push@nexeo-tmc.iam.gserviceaccount.com`. Imperialsoft's full report is still awaited: the OAuth client ID, the publishing status and the scope classes.
  - **TMC infra (tmcltd.com):** asked for the Workspace plan (Business Standard or higher is needed), to turn transcripts on, and to mark Nexeo's client as Trusted.
- **Waiting on:** Suzi Master's AGREE, and the founder's "agree F-4". **Nothing gets built until both arrive.**
- **Suzi Master, 12 Nov: AGREE to N1-N7, with conditions C1-C4. Nexeo accepted all four, pending the founder.**
  - **C1:** Way A follows F-4.3 exactly. The switch is off by default, Suzi asks for each meeting until there is a `meeting_attend` rule, and any meeting can be switched on or off by click or voice. A meeting he doesn't host gets `meeting.status not_covered` and no attempt.
  - **C2:** statuses are `transcribing`, `transcript_ready`, `record_ready`, `not_covered` and `failed {reason}`.
  - **C3:** F-4.10 adds "Google's own copy under Way A is the host's, in his Drive." Our 12-month limit and our delete do not reach that copy. The founder is told this with decision 4.
  - **C4:** the consumption record adds `meeting_transcript_minutes`, a count only.
  - **Next:** after the founder's "agree F-4", Suzi Master writes the F-4 text into Functional_Charter.md and C4 into Costing_Charter.md. Nexeo then mirrors both byte-identical and builds.
- **Way A scope, agreed 12 Nov:** "Way A covers meetings the user hosts on a Google account connected to Nexeo. Any other meeting, including one hosted by a colleague at TMC, is meeting.status not_covered for him (he can still take notes on his computer)." This replaces N1's "hosted at TMC". A colleague's transcript is the colleague's own record.
- **Imperialsoft report, 12 Nov.** Project nexeo-tmc is 911071183217.
  - **Sign-in app:** client `911071183217-aa03dh5oecml97o1ajie97k1f41m5orc`. It is External and has been in production since 11 Nov, so tokens no longer expire after 7 days. It is not yet verified, which caps it at 100 users.
  - **Meet scopes:** `meetings.space.readonly` is sensitive and `meetings.space.settings` is non-sensitive. Neither is restricted.
  - **Pub/Sub:** the topic and the push subscription `meet-transcripts-nexeo` are done.
  - **Blocked:** the Publisher grant for `meet-api-event-push@system.gserviceaccount.com` was refused by the org policy `iam.allowedPolicyMemberDomains`. Imperialsoft has been asked for a project-only exception.
  - **Way A works without events:** Nexeo polls `conferenceRecords` about 15 minutes after each hosted event ends, and the events only make notes arrive sooner.
- **GCP side complete, 12 Nov 12:52 PKT (Imperialsoft).** `meet-api-event-push@system.gserviceaccount.com` now holds `roles/pubsub.publisher` on `meet-transcripts`.
  - **Policy:** this took a project-only override of `iam.allowedPolicyMemberDomains`, which has since been removed. nexeo-tmc inherits the org policy again, and nothing changed at the organisation level.
  - **One side change:** the Org Policy API was enabled on nexeo-tmc.
  - **Still to do, Nexeo's build after "agree F-4":** the `/api/v1/meet/events` endpoint (OIDC token from `nexeo-meet-push`, audience equal to the URL); Workspace Events subscriptions pointing at the topic; and the two Meet scopes, which means each user reconnects once.
- **N8 (one record per meeting, whichever way it arrives), proposed to Suzi Master on 12 Nov after the founder asked "what if things come from integration and the data already exists".**
  - **The problem:** the same meeting can already arrive through Plaud, Otter, Fathom or Fireflies emails (`meetingDigestService`), as Google's transcript Doc in Drive (`personalDriveService`), through Way A, or from the computer.
  - **The proposal:**
    - One record per meeting, keyed by the calendar event or by the conference and its start time.
    - Later arrivals are added to `sources[]`, and `way` gains `imported`.
    - The best transcript wins, and the record is re-derived as `record_ready` with `updated: true`.
    - Action items are checked against open items first (the DEF-435 rule).
    - The Drive Doc is attached to its meeting, not digested on its own.
    - Older Plaud minutes are linked only on the founder's yes.
  - **Waiting on:** Suzi Master's answer.
- **N8: Suzi Master AGREEs with conditions C5-C7, and Nexeo accepts them, 12 Nov.**
  - **C5:** one record per meeting **per user**, never merged across users. A meeting with no event attaches to an overlapping event, or starts its own record. `meeting.upload` carries `event_id` when known and always carries start and end.
  - **C6:** re-deriving never undoes his decisions. Accepted or skipped items stay; only new items are proposed. Minutes he edited by hand are kept, with the new version offered beside them. `updated: true` shows a silent "notes improved".
  - **C7:** `sources[].way` appears in `meeting.get` and `meetings_recorded[]`. There is no upload offer when `google_transcript` or `participant` is already present.
  - **F-4 is complete on both sides** (N1-N8, C1-C7, Way A scope) and waits only on the founder's "agree F-4".
- **TMC infra, 12 Nov:** they confirmed the Workspace plan includes Meet transcripts, so Way A is available. Suzi Master was told on 12 Nov at 17:08:39 PKT, after tmcai-c9 ended. Suzi Master confirms F-4 is agreed on both sides (N1-N8, C1-C7, the Way A wording) and waits only on the founder's "agree F-4". Way B's Costing line is still owed; it will be sent before B is built.
  - **Pending with infra:** transcripts setting on (step 2) and the Nexeo client marked Trusted (step 3). Both can be scoped to a "Nexeo users" group, which is what we recommended.
  - **The setting only allows transcription.** A meeting is transcribed only when its host, or Nexeo under his rule, switches it on.
- **Founder, 12 Nov: start Way A with one user only, basit.ahmed@tmcltd.com.** Infra was asked to put him alone in a group `nexeo-users@tmcltd.com` and to apply the transcripts setting (step 2) and Trusted (step 3) to that group only. The Nexeo switch is on for him alone and stays off for everyone else.

## SU-8: requests sent automatically, non-lead notes to the lead first (PROPOSED by Suzi Master, 12 Nov 2026)

These are the founder's words in Suzi Master's session, 12 Nov: *"it should be sent automatically if I am lead"*, and *"all other requests from other Suzi clients who are not lead will come to lead first; when lead approves then go to build"*.
- **SU-8.1:** a spoken request goes out at once. It is signed by the device; confirmed_by_user is true (the spoken request is the confirmation); voice_score is the score of that sentence. A typed request from the lead waits for a voiced yes, or for SU-7.
- **SU-8.2:** every non-lead note arrives as "new" and is approved only on the lead's signed yes (approval.ask kind feature_note).
- **SU-8.3:** unchanged: no personal data, the floor (D1), the lead's own notes approved on arrival, D3 lists only what he approved, the relay forwards /v1/master/gap unread.
- **Text changes:** in Routes, "a fix for bugs the lead approved, which may go straight to all"; in G1, "A non-lead note goes to the lead first and is built only on his yes".

**Nexeo: AGREE (12 Nov 2026 17:07:07 PKT).** Nothing changes on Nexeo's side:
- the relay forwards notes unread;
- gap ops already route to Suzi Master (D-196);
- the brief reads only what the master sends for D3.

**Waits on:** the founder's "agree SU-8" in this session. Then Suzi Master updates the master, the clients and SuziUpgrade_Charter.md, and Nexeo mirrors that file in place of the older Master_Charter.md.
- **TMC infra, 12 Nov: setup done.** The `nexeo-users` group exists and transcripts are On for that group. Trusted access cannot be scoped to a group, so it was granted to the founder's organisational unit instead. Trusted only skips the unverified-app warning for that unit; each user must still sign in and consent, and the Nexeo switch stays off for everyone but him. **Google-side setup for Way A is complete.**
- **FOUNDER: "agree F-4", 12 Nov, in Nexeo's session. F-4 is AGREED** as recorded above: N1-N8, C1-C7, the Way A scope wording, and decisions 1-4 as Nexeo recommended. Those are no sound kept; ask before each meeting until a rule is set; our own joiner for Way B; 12 months, then only minutes and action items, with Google's copy staying in the host's Drive (C3). Way B stays parked until its Costing line is agreed. N8.7 (linking the older Plaud minutes) needs a separate yes.
  - **Next:** Suzi Master writes the F-4 text into Functional_Charter.md and C4 into Costing_Charter.md, and Nexeo mirrors both byte-identical. Nexeo then builds Way A for basit.ahmed@tmcltd.com first.
