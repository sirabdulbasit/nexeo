# Suzi ⇄ Nexeo: Functional Charter

**Agreed by Suzi and Nexeo on 4 Nov 2026** (deploy D-155; Windows change agreed 17:37 PKT). Items 1 and 19 wait on the founder.
Costs, budgets and the consumption record are in [Costing_Charter.md](Costing_Charter.md).

## 1. The three parts and the principle

- **The desktop app (Suzi, Mac or Windows):** runs the user's day from a local working copy. She listens, talks, briefs, presents, follows up, drafts, takes meeting notes, is the user's Meeting Assistant (F-4) and operates the computer. The `hello` frame's `os` field says which OS (`macos` | `windows`). A user is on one OS or the other, not both.
- **Suzi's server (jarvis-gateway):** the live link to the desktop app. It runs the conversation model (answers requests, chooses tools, writes replies), verifies devices and signatures, and forwards operations to Nexeo.
- **Nexeo:** the record. Knowledge, connectors, data, rules and delegations, the Action Center and the audit trail. It is the **only writer** to the outside world (email, calendar, tasks, other people), and it keeps the day going when the computer is off. It gets online meetings' transcripts as the user's Meeting Assistant and keeps the meeting record (F-4).

Each user has their own Suzi, a personal assistant for the boss's clerical work. **Suzi is the face of Nexeo:** day-to-day work happens through her, and the Nexeo portal is for account management.

**Open (founder):** who owns and edits Suzi's server (item 1). Until then the Nexeo session keeps it, and CN-009 is finished or parked by its owner.

## 2. Responsibilities

| # | Area | Nexeo | Suzi's server | The desktop app (Suzi) |
|---|---|---|---|---|
| 1 | Knowledge (wiki) | Builds and keeps the wiki; serves excerpts as facts (knowledge route); chooses wiki slices for the day pack | Its model writes the words from the facts and cites the page title | Carries today's slices; asks for anything else through the knowledge route |
| 2 | Connectors | Holds email, calendar, contacts, chat, drive and organisation systems, and their tokens | — | Holds no connector tokens |
| 3 | Data of record | The truth for tasks, rules, people and history; resolves conflicts | — | An encrypted, read-only working copy, wiped on sign-out or account change |
| 4 | Rules and delegations | A version-numbered structured file plus Markdown; checks who may grant what at the moment of writing (**it decides**); audit; push | Passes `rules_version` along | Captures and reads back rules, confirms with the user, sends them; its own check can **only refuse, never allow**. Rules may only make Suzi stricter. |
| 5 | Action Center | Owns tasks: create, assign, update, notify, nudge others by rule or on the user's yes | Forwards `act` | Presents tasks, follows up at good moments (follow-up card), sends decisions as `task.update`, triage |
| 6 | Email | Find, draft, send, forward, undo; auto-send only by rule | Verifies the signed send | The draft on the board, edits, the explicit "send" (voice lock), the 10-second undo |
| 7 | Calendar | Reads and writes events; reminders while the computer is off | — | Meeting alerts and prep; booking requests through `act` |
| 8 | Day pack | Built **on request** (about 8 s cold; may say `emails_loading: true`). Includes `date`, `tz`, `missing`, today and tomorrow in full, the rest of the week as titles, **all** open actions | Serves `/v1/day-pack` | Fetches on connect, unlock, every 15 minutes (moving to `?since=` once the feed exists) and before a brief; caches encrypted; re-fetches after 30 s while emails are loading; names missing sources in the brief |
| 9 | Live conversation | Facts and data | The conversation model | Wake word, voice lock, listening, transcription, acknowledgements, interruptions, goodbyes, language switching, voice, the 3D character |
| 10 | Presentation | Data blocks with numbers filled in | Builds `present_report` from data-tool block ids (`present_blocks`); **a number never comes from the model** | The board and the presenter; narration written in the user's language when `say` is empty; Stop and Esc |
| 11 | Follow-ups | Decides what to chase; reminds others; holds due items while the computer is off | — | Picks the moment, records answers, reports progress |
| 12 | Meeting Assistant (F-4) | With the user's switch on: gets the transcript (Way A, later Way B), keeps the one meeting record per meeting, proposes action items, serves the reads | — | Asks which meetings, shows status, the meeting card and the brief line; taking notes on the computer stays opt-in per meeting; once taken, they go to his record (F-4.6, W-1) |
| 13 | Operating the computer | — | Its model chooses tools step by step | Runs them locally under its safety tiers |
| 14 | Journal | Stores Suzi's reports | Forwards them | Sends follow-up answers, decisions and actions taken; meeting notes only with consent |
| 15 | Devices | Marks the device in charge (`primary`): the founder's M5 Mac now, later a setting in the Nexeo portal, otherwise the first paired device | Puts `primary` in `welcome` | Only the device in charge runs follow-ups and actions |
| 16 | Privacy | Per-user access; only the user's data in the pack | — | Idle speech never leaves the computer; only voice-verified requests go out for transcription; the camera stays off unless the user says yes |
| 17 | Language and time | Each user's zone, sent in the pack's `tz` | Replies in `reply_language`, times in the user's zone (its fixed Karachi zone gets replaced) | Preferred speaking language; a one-reply switch. Urdu is a speaking language: its script is only what the voice reads, never shown; everything written or shown is English (founder, 5 Nov 2026) |
| 18 | Audit | Every write: who, what, when, and the device (from the verified login) | Device id from the login, never from the body | Logs every menu action and tool step locally |
| 19 | WhatsApp (founder, 4 and 5 Nov 2026) | WhatsApp connects the user with Nexeo or Suzi only, on one registered number per client. Nexeo recognizes each user from the number they write from. The user can ask anything; Nexeo and Suzi can inform or update them. Nexeo does not read messages from others and does not message others on WhatsApp. Nexeo's Brain keeps answering the user on that number until the founder moves that. Nexeo's personal-number link stays off. | — | Does not read or write WhatsApp. The own-number reader is on hold (founder, 5 Nov 2026) and off for everyone. |
| 20 | Consumption record | Keeps the one record (see the Costing Charter, once agreed) | Reports each model round | Reports a daily usage batch |

## 3. Rules both sides follow

- **R1 One writer.** Only Nexeo changes the outside world, including by operating an app on the computer, unless the user asked for it in this request, confirmed it with the voice lock, and it is journaled. Local file actions on the computer are outside R1 (Suzi's tiers cover them).
- **R2 Confirmation before anything irreversible**, with the voice lock passed; money and approval delegations get an extra on-screen confirmation. **Irreversible operations are signed by the device** (see the contract). An email is really sent only when signed, for a user on Nexeo's send switch (off by default); otherwise "send" saves to Gmail Drafts (T22). `task.update` on the user's own items needs no voice check (it is recorded with `voice_score` when spoken).
- **R3** Rules are enforced in code; the desktop app's check can only refuse, and Nexeo's check decides.
- **R4** Act only on the current request.
- **R5** Never claim an action that didn't happen.
- **R6 Fail softly:** present what's available and name what's missing; one failed tool call means one short sentence, then end the turn.
- **R7** State freshness ("as of 3:05") when data is older than about 15 minutes.
- **R8 Privacy defaults:** meeting notes go to the user's Wiki (W-1, F-4.6, F-4.10); idle speech is never sent; the camera stays off unless the user says yes.
- **R9 Wiki first (W-1):** all knowledge lives in Nexeo's Wiki. Suzi holds none of her own: her copy, the day pack and the knowledge route are views of the Wiki (section "Wiki first").

**Safety tiers in the desktop app:**
- **T0, silent:** reading.
- **T1, narrated:** opening, typing, clicking.
- **T2, needs a voice-verified yes or an Approve click:**
  - closing apps, moving or deleting files (to the Trash or Recycle Bin), shell commands, risky hotkeys;
  - clicking an outward button (Send, Submit, Approve, Pay, Transfer, Buy, Purchase, Rent, Confirm, Sign, Post, Publish, Share, Forward, Subscribe, Join, Comment, Reply, Thanks), and screen-operator tasks that ask for one;
  - typing text that ends in Enter, and the hotkeys Return, Enter and Cmd/Ctrl+Return;
  - a coordinate click (`mouse_click`) on an outward button, or on an element whose label can't be read, except a click whose label can't be read in Excel or Numbers, or in a browser whose front tab's address is YouTube (youtube.com, www, m and music.youtube.com, youtu.be; read from the browser, never the window title; an address that can't be read asks). Mac only, until Windows has the element check. Agreed 5 Nov 2026. The element is looked up with Accessibility on the Mac (built) and UI Automation on Windows (to build; until then **every** coordinate click on Windows is T2).

**Same guarantees on both OSes.** Each OS-specific promise needs an equivalent before that OS may do the action; until then the action stays off.

| Promise | Mac | Windows |
|---|---|---|
| Signing key storage | Keychain | Credential Manager (DPAPI), via the OS keyring (untested) |
| Encrypted local copy | Keychain-held key | The same, via the keyring (untested) |
| Element check before a coordinate click | Accessibility (built) | UI Automation (to build; every coordinate click is T2 until then) |
| T2 hotkeys | Cmd forms | Ctrl and Alt forms |
| Off-limits paths and commands | Per OS (limits.py) | Per OS (limits.py) |
| Local hearing (R8) | Whisper on Apple Silicon | Whisper on the CPU or an NVIDIA GPU (speed to be measured) |
| Click by text, read screen | macOS Vision | Windows OCR (to build) |
| Local screen operator | On-device model (Apple Silicon) | Off |
| Meeting call audio | ScreenCaptureKit | To build (the room microphone works) |

**Windows acceptance order:**
1. A Windows build.
2. The companion's Windows service (from 3dAI).
3. Windows OCR.
4. UI Automation for the click check.
5. A test user on Windows.

**Reaching the user:** while the device in charge is alive, Nexeo uses no other channel. Routine items go through the pack and the changes feed, and Suzi picks the moment. **Critical items arrive at once** as `assistant_start`. During quiet hours a critical item waits (a silent card), unless a rule says it may wake the user. While meeting notes are on: silent card, spoken after the meeting. Nexeo's own morning brief stops once Suzi's handover has worked. **With nudges off (the user's Settings), nothing is raised, critical items included; they're kept and given when the user asks.** **While Suzi is offline, Nexeo works through WhatsApp and email, by the item's criticality, priority and deadline (founder, 5 Nov 2026).**

## 4. The contract

- **Live link:** WebSocket protocol v1 (`hello` with `os`, `welcome` with `features`, `user_utterance`, `assistant_start`, `assistant_delta`, `assistant_done`, `tool_call` → `tool_result`, `notice`). Tool arguments go under `args`, matching the schema announced in `hello`. Context such as the clock, memories and language goes in a `[Context, not spoken by the user: …]` note. Desktop text results are cut at 12,000 characters as the model sees them.
- **Day pack:** `GET https://tai.tmcltd.com/suzi/v1/day-pack`
- **Act:** `POST https://tai.tmcltd.com/suzi/v1/act` (401 without a credential).
  - Body: `{"op", "args", "idempotency_key", "confirmed_by_user", "voice_score"?, "ts"?}`. Unknown fields get a 400.
  - Tenant, user and device come only from the verified login, never from the body.
  - `task.update` args: `{id, update: done|cancel|move|not_yet|note|reopen|assign, due?: YYYY-MM-DD, note?, person_id?}`. `reopen` puts the user's finished or cancelled task back on the open list, with no time limit. An open task gets `bad_state`, and a finished one refuses every other update until reopened, except `note`. `assign` needs `person_id` from `people`: it records who the task went to and tells nobody, and a person with no email gets `no_email`. Whether the person is told is the founder's to rule (link T21, both AGREE, 5 Nov 2026).
  - Answer: `{ok, audit_id, item}` on success, `{ok, audit_id, error, detail?}` on failure. A retry with the same key adds `replayed: true`; a stale `rules_version` adds the current one. The email ops of E4 describe `item` (both AGREE, 5 Nov 2026).
- **Signing (irreversible ops):**
  - An Ed25519 key in the OS keyring.
  - The key: a paired device signs with its pairing key (`jarvis.devices.pubkey`). A device signed in with an integration key registers its key once with `POST /v1/device-key {"pubkey":"<standard base64, raw 32 bytes>"}` and its bearer: it is set only on a device still holding the placeholder; the same key again is `200 {ok, already: true}`; another key is `409 key_set` (replacing needs the founder); a paired device is `409 paired`. Errors come as `{error: {code, message}}`.
  - Base64 is standard with padding, for the key and the 64-byte signature.
  - The signature covers canonical JSON (**RFC 8785**) of `{op, args, idempotency_key, ts}`, sent as the header `X-Suzi-Signature`. `ts` is top level, in UTC, and within 5 minutes.
  - **Suzi's server is the only verifier.** It checks against the key of the device behind the credential and forwards a verified op to Nexeo with `signature_verified: true`, which the device can't set (400). A bad, stale or keyless signature is `401 bad_signature`, never forwarded as unsigned.
  - `email.send` signed needs `voice_score` (400 `no_voice_score` without it); Nexeo records it and sets no threshold. Nexeo sends only when signed, confirmed, voiced, and the user is on the send switch. Then the answer is `item: {draft_id, saved_to_gmail_drafts: true, sent: true, send_at, undo_until, gmail_draft_id}`: the email is held 10 seconds and then the saved Gmail draft itself is sent. Otherwise it is saved to Drafts with `sent: false`, as before.
  - `email.undo` is unsigned. Inside the hold it cancels the send and the email stays in Drafts (`{undone: true, sent: false}`); once it has gone, `bad_state` "it has already gone". A failed Gmail send is recorded on Nexeo and the email stays in Drafts; there is no frame for it yet. (Link T22, both AGREE, 6 Nov 2026.)
- **Already answered (link T23, both AGREE, 6 Nov 2026):** each email in the pack's `emails` and on `GET …/email` carries `replied_at` (UTC, the user's latest Sent message on the thread when it is newer than anyone else's latest, else null) and `reply_checked` (false when Gmail couldn't be asked, or the mailbox isn't Gmail: then she says she can't tell; a missing field never means "no reply"). Nexeo asks Gmail itself, by its Sent label, when the pack is built and on every `GET …/email`, so any address and any app counts. An answered thread is left out of `emails` until someone writes after him. `email.draft` on an answered thread still saves the draft and sets `item.replied_at`; she warns him before he sends. Replies outside the mailbox can't be seen. Gmail reads only, no cost line.
- **Delegate suggestions (link T24, both AGREE, 6 Nov 2026):** `GET …/delegate-suggestions?task_id=` → `{suggestions: [{person_id, name, email, reason, source: "rule"|"past_practice", rule?, count?, last_at?}], skipped, checked}`. A read with no AI, only for the user's own task: 404 `not_found` if it isn't his, 400 `bad_state` if finished or cancelled, errors as `{error: {code, message}}`. `person_id` is one of his own contacts (the id `task.update` assign takes), matched by email; anyone who can't be matched is counted in `skipped` (only those that would have been shown), never returned. `rule` is `{kind: "area", area}` (the company delegation table, area as a whole word or phrase of the title) or `{kind: "type", item_type}` (his per-type list). `past_practice` counts his own delegations to that person, never anyone else's, and the reason never says "similar". Rules first, then past practice by count, then most recent; at most 3, each person once, never him or the current delegate. `checked: false` when a source couldn't be read. It ends only in `task.update` assign, on his choice, with Suzi's on-screen confirmation.
- **Task history (link T25, both AGREE, 6 Nov 2026):** `GET …/task-history?id=` → `{history: [{at, who, change, note?}], checked}`, newest first, at most 20, only his own task (404 `not_found` otherwise). Built with no AI from status changes, assigns, due-date moves, notes, replies from the person it's with, and Nexeo's own follow-ups. `who` is "you", "you, through Suzi", "Nexeo", "a colleague" or the person's name. Priority and title changes and some older due moves left no record and can't appear. Each pack action also carries **`changed_at`**: the latest real change (status, due date, assign, a note or answer from him or someone else, or creation). Nexeo's own follow-ups never move it, while `updated_at` moves on every write. "Last changed" on a board reads `changed_at`.
- **Presence:**
  - `{"type":"presence","state":"active|away|locked|asleep|paused"}`, sent on every change and every 60 s, once `welcome.features` includes `presence`.
  - "Alive" means a presence frame in the last 3 minutes with state active, or away for under 30 minutes.
  - Working hours means outside the user's quiet hours (default 22:00–08:00), in the pack's `tz`.
- **Knowledge:** `GET …/knowledge?q=` → `[{page_id, title, excerpt, updated_at, url}]`, at most 5 results and about 4,000 characters.
- **Presenting:** data tools return blocks with ids; the model calls `present_blocks({title, blocks:[{id, title, say}]})`; Suzi's server builds `present_report`. First version: tasks, meetings, emails.
- **Usage:** `POST …/usage`, one batch per finished day (see the Costing Charter). Live since D-156, like `presence`.
- **To come:** `GET …/changes?since=`, the push `{"type":"sync"}` hint, `POST …/journal`, and `primary` in `welcome`.

## Build control (link T28, superseded 2026-11-10 by the Suzi Upgrade Charter)

Build control (gaps, approvals, releases, the lead, the stop switch and installers) is agreed in `SuziUpgrade_Charter.md`, which both sides hold byte for byte. Suzi Master holds the gap list, releases and lead mark. Nexeo carries messages and stores nothing of Suzi's. The T28 text of 6 Nov is in git history.

## Brief by sections, act on every item (F-2, agreed 11 Nov 2026)

Every brief, the morning brief or one section, starts with one summary line per section. On his yes she gives the details section by section, and after each section, or on a no, asks what he'd like done. Every item can be acted on by voice or by click: emails (reply, delegate, ignore, once or as a rule), meetings (change, cancel) and the Action Center (create, change, forward). Suzi's side is the flow, the cards and the voice. Nexeo's side is the ops below, all through `/v1/act`. Delegate rules prepare and hold: nothing is sent without his yes.

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

## Meeting Assistant (F-4, agreed 12 Nov 2026)

Each user's Suzi is also their **Meeting Assistant**: for the online meetings he chooses she gets what was said and by
whom, writes the minutes, the decisions and the action items, keeps them where he can ask about them later, and follows
the action items up. To every participant she is only "Suzi". Nothing goes out by itself.

- **F-4.1 Ways in.** All ways end in one meeting record on Nexeo; Suzi Master holds none of it.
  - **Way A, Google's own transcript (`google_transcript`, built first).** Nexeo turns on Meet's transcription for the
    meetings his switch or rule covers (Meet API), is told when the transcript is ready (Workspace Events through
    Pub/Sub), and reads it with each speaker's name. Nobody joins the call. **Way A covers meetings the user hosts on a
    Google account connected to Nexeo. Any other meeting, including one hosted by a colleague at TMC, is
    meeting.status `not_covered` for him (he can still take notes on his computer).** About $0.01 per meeting hour.
  - **Way B, as a participant (`participant`).** Nexeo's own joiner on its own cloud, Meet first, visible as "Suzi, for
    \<user's name\>". **Parked until its Costing line is agreed.** No meeting-notetaker service (founder, decision 3).
  - **On his computer (`computer`)**, as today.
  - **Imported (`imported`):** transcripts that already reach Nexeo (Plaud, Otter, Fathom, Fireflies emails; Google's
    transcript Doc in Drive).
- **F-4.2 Which meetings.** A per-user switch, off by default. With it on, Suzi asks before each meeting with a join
  link, in the brief and on the meeting alert, until he sets a rule (founder, decision 2). `rule.set` kind
  `meeting_attend`, match by organiser, attendee, title or "all with a link", set only by him (voice or click, as
  F-2.4). Any single meeting can be switched on or off by click or voice, before or during it. Way A follows this
  exactly; a meeting it can't cover gets `not_covered` and no attempt.
- **F-4.3 Everyone knows.** Under Way A, Meet shows every participant that transcription is on. Under Way B she posts
  one chat line on joining ("Suzi is taking notes for \<user's name\>"), never speaks or answers, and leaves at once
  when the host removes her or anyone asks, recording that and why. On his computer notes stay opt-in per meeting and
  Suzi reminds him once to tell the others.
- **F-4.4 The record.** `{meeting_id, event_id?, title, platform, start, end, way, sources[{way, ref, received_at}],
  participants[{name, email?}], transcript[{t, speaker, text}], minutes, decisions[], action_items[{title, owner_name?,
  person_id?, due?}], status}`. Only that user reads it; the others get nothing unless he sends the recap. **No sound
  is kept**; the transcript and minutes are the record (founder, decision 1).
- **F-4.5 One record per meeting, per user (N8, C5–C7).**
  - Keyed by the calendar event (or the Meet conference and its start), never by the way it arrived; one record per
    meeting **per user**, never merged across users. Without an event or conference, an upload or import attaches to
    an overlapping event of his, else gets its own record.
  - The first arrival makes the record; later ones attach as `sources[]`. The best transcript wins: google_transcript,
    then participant, imported, computer. Minutes are re-derived only when a better one arrives.
  - Re-deriving never undoes his decisions: accepted or skipped action items stay as they are, only new ones are
    proposed, checked against his open items; minutes he edited are kept, with the improved version offered beside
    them. `record_ready` with `updated: true` is a silent "notes improved" on the card.
  - Google's transcript Doc in Drive is recognised as a copy and attached, never digested as separate notes. Older
    Plaud minutes are linked only on the founder's separate yes.
- **F-4.6 From the computer.** `meeting.upload` {event_id?, title, start, end, transcript[], minutes,
  action_items[]} is sent automatically when a meeting noted on the computer ends, with Meeting Assistant on or off
  (W-1, founder 13 Nov 2026); event_id when known, start and end always. The pack's meetings carry
  `attendees[{name, email}]` so Suzi can name speakers. Voice identity is kept as W-1 S2 says. Suzi doesn't upload when
  the record already has `google_transcript` or `participant` (sources[].way).
- **F-4.7 After the meeting.** Action items are proposed: on his yes, by click or voice, each becomes a task through
  `task.create` with `source {meeting_id, item_id}` (F-2.1): Nexeo marks that item accepted with its task_id (an
  unknown item_id still makes the task, and the answer says `item_state: "not_found"`). `meeting.item` {meeting_id,
  item_id, decision: skip | propose} (confirmed, unsigned) answers {meeting_id, item_id, state}; `meeting.get` keeps
  each item's id, state and task_id. The pack carries `meeting_assistant {on}`. Until `meeting.status` is pushed, Suzi
  reads `meeting.list` after his meetings. The recap is a draft, sent under the send rules (R2). (Detail agreed
  13 Nov 2026 16:10:35 PKT.)
- **F-4.8 Reads.** `meeting.list` {from?, to?, person?}, `meeting.get` {meeting_id} (with sources[].way), the knowledge
  route across his own records only, and the pack's `meetings_recorded[]` since the last brief: title, when, a one-line
  outcome, the count of proposed action items.
- **F-4.9 Acts and status.** `meeting.attend` {event_id | join_url, way}, `meeting.leave` {meeting_id},
  `meeting.delete` {meeting_id} (signed, irreversible). Nexeo pushes `meeting.status`: Way A `transcribing`,
  `transcript_ready`, `record_ready`; Way B `joining`, `waiting_to_be_let_in`, `in`, `left`, `refused`, `ended`,
  `record_ready`; either way `not_covered` and `failed {reason}`.
- **F-4.10 Privacy.** The meeting record is kept in his Wiki for him alone, whether notes came from the computer or
  from Meeting Assistant (W-1); he can delete any record. Records are kept 12 months, then only the minutes and
  action items (founder, decision 4). Under Way A, Google's own copy of the transcript is the host's, in his Drive:
  this limit and our delete don't reach it. The consumption record carries counts only.
- **F-4.11 Cost.** Way A needs no new line; the consumption record counts `meeting_transcript_minutes` (Costing
  Charter §7). Way B gets its own line (estimated $0.25–0.35 per meeting hour, a monthly cap per user, counter
  `meeting_participant_seconds`) before anything of it is built.
- **Start:** one user, the founder, through the group nexeo-users@tmcltd.com (TMC's Workspace includes Meet
  transcripts; Nexeo's sign-in app is trusted for his unit).

## Meeting reminders while the computer is off (row 7, agreed 13 Nov 2026)

- 10 minutes before each timed meeting on his calendar (not all-day, cancelled or declined by him), Nexeo sends a
  reminder only when no Suzi device of his is alive (the presence rule). While one is alive, Suzi's own alert covers it,
  so the two never double. When his latest presence said nudges off, Nexeo sends nothing either.
- WhatsApp to his registered number first, email if that can't deliver: the title, the time, who it's with and the join
  link. One message for meetings starting together, once per event and start; quiet hours apply. A user with no Suzi
  device always gets it.

## Wiki first (W-1, agreed 13 Nov 2026)

Founder, 13 Nov 2026: "nothing should be stored or saved outside of wiki", for the whole product, Suzi included.

- **W-1.1** All knowledge lives in Nexeo's Wiki (R9). Suzi's copy, the day pack and the knowledge route are views of it.
- **W-1.2** Everything Suzi captures goes to Nexeo, which places it in the Wiki: meeting notes (F-4.6), what she learns
  about the user (`profile.update`), identity (`identity.put`), and her settings, audit and usage (`device.report`).
- **W-1.3** Suzi cites note titles; the knowledge route returns them.
- **W-1.4** Later changes to what Suzi receives are proposed first.
- **W-1.5** The pack's `emails[]` and `fyi[]` are read from the Wiki's marked email sources; a rule is a mark on each
  email it covers, and `email.mark` writes a "handled" mark (same fields and caps; agreed 13 Nov 2026 15:20, live D-239).
- **Split rule:** what is about this user, or would be wrong for another user, is USER and goes to his Wiki. What
  helps everyone and holds no personal data is GENERIC and goes to Suzi Master (`learning.note`, SuziUpgrade Charter).
  When unsure, it is USER. Requests and training feedback about Suzi herself go to Suzi Master under the SuziUpgrade
  Charter; once a note is sent Suzi drops his verbatim words, and keeps training rounds as counts.
- **S1** The device's signing key and the keys that encrypt storage on the computer never leave it, not even
  encrypted. Other secrets (an AI key, a voice key) go to Nexeo's encrypted secret store, never into a note's text.
- **S2** Identity (voiceprints, faceprint, the 8 s voice sample) is stored encrypted, readable only by that user's own
  signed-in devices, used only to verify that user (never to identify others, never for training). A note holds a
  reference, not the data. Deleting it removes it everywhere.
- **S3** Every user is told before enrolment that their prints are kept encrypted in the company knowledge store, and
  once on screen that meeting notes are saved there.

| Op | What | Signed |
|---|---|---|
| `meeting.upload` | F-4.6, sent when a meeting noted on the computer ends | no (confirmed) |
| `identity.put` {kind: voiceprint \| faceprint \| voice_sample, data, model} / `identity.get` {kind} / `identity.delete` {kind} | S2; get answers only to the same user's device | put and delete |
| `profile.update` {notes[{key, value, evidence_count, updated}]} | USER learning, one person note "How to work with <user>"; the pack returns `profile{}` | no (confirmed) |
| `device.report` {settings, audit[], usage} | daily, extending /v1/usage | no |
| `learning.note` | GENERIC learning, relayed unread to Suzi Master (SuziUpgrade Charter) | yes, by the device |

## 5. Credentials (Google project nexeo-tmc)

1. Create one desktop service account, `suzi-desktop@nexeo-tmc`, with only Vertex AI model calling and Cloud TTS. The OS is told apart by labels (`os=macos|windows`). The founder decides and creates it.
2. Issue one key per device on that account, and move the devices to them.
3. Confirm who else uses `vertex-sa` (possibly Suzi's server: `secrets/vertex-sa.json`).
4. Only then rotate the `vertex-sa` key.

Also: the 3dAI character builder (image generation) should get its own project or key.

## 6. Testing

A dedicated test user per OS, with its own integration key (item 19, from the founder). The desktop app runs a separate test profile, and the founder's history and items stay untouched. Acceptance happens on each real OS, with the frames reported.

## 7. Changing this charter (founder's rule, 4 Nov 2026)

1. **Nothing in this charter changes without both sides agreeing first.** Neither side starts development or a build that depends on a change until both have replied AGREE.
2. **How:** the side that wants a change sends a numbered proposal (section, line, what changes and why). The other replies AGREE, or with numbered changes and questions. Rounds continue until both say AGREE. Then the agreed text is written here, with the date and the deploy ids. Replies carry the date and time, with seconds.
3. **What counts as a change:** responsibilities (who does what), the contract (routes, fields, frames, formats, signing), the rules and safety tiers, privacy defaults, credentials, and anything in the Costing Charter.
4. **What doesn't:** fixing a bug or improving something inside one side's own part, as long as the contract and the rules stay exactly as agreed. If unsure, treat it as a change and ask.
5. The founder may approve, overrule, or decide anything that's open.
6. **Founder's approval (5 Nov 2026):** both builders' AGREE is enough for a change, unless it touches cost, privacy, sends or a new way of reaching the user; those go to him.
7. **Kick-off (founder's rule):** when both sides have finished their parts, each confirms its part is done and tested, and only then does the system kick off.

## 8. Sign-off

- [x] Suzi (desktop app): agreed, 4 Nov 2026
- [x] Nexeo: AGREE, 4 Nov 2026 (rounds 1–3, deploy D-155: Nexeo 0d65495, Suzi's server 3bc1938; Windows change 17:37:02 PKT). Nexeo's copy is server/docs/NEXEO_SUZI_AGREEMENT.md.
- [x] Founder: joint summary approved, 5 Nov 2026 ("approve all"): the own LLM with the R8 and L4 exceptions for users he has enabled, and its cost line; screen tasks on tested models only; meeting assistance for others by a per-user switch, off by default; `language` and `meeting` on presence and `local_context`; emails one by one (until signing, "send" saves to Gmail Drafts, and Suzi says so); one English line per Urdu reply; back to WhatsApp after 72 hours away; `briefs_shown`; nudges off and `presence.nudges`; Phase 2 of the pack (rules, 100 people, glossary, wiki slices, changes, sync hint); one assistant on the registered number (T13).
- [x] Founder, 5 Nov 2026, the desktop's own AI (Settings: provider, model, the user's key), for a user the founder has enabled: it writes email drafts, on the user's request, from the rules, delegations, instructions, people and knowledge in Nexeo; that email and what relates to it go to the provider under the user's key. Nexeo keeps the record and does all sending (R1). Without a usable AI the desktop stays online, shows why, answers what needs no AI, and says so for the rest ("Sir, AI is not configured").
- [x] Nexeo: AGREE F-1, 11 Nov 2026 11:44 PKT (the T28 build-control section is replaced by a pointer to SuziUpgrade_Charter.md)
- [x] Suzi Master: proposed and AGREE F-1, 11 Nov 2026 11:43:34 PKT (same change)
- [x] Founder: "agreed F-2", 11 Nov 2026 17:49 PKT, in Nexeo's session (brief by sections, act on every item; delegate rules prepare and hold)
- [x] Nexeo: AGREE F-2, 11 Nov 2026 (Nexeo commit 8b82467)
- [x] Suzi Master: proposed and AGREE F-2, 11 Nov 2026 (the same text)
- [x] Founder: "agree F-4", 12 Nov 2026, in Nexeo's session, with decisions 1–4 (no sound kept; ask each meeting until a rule; our own joiner for Way B; 12 months, then minutes and action items)
- [x] Nexeo: AGREE F-4 (N1–N8 with C1–C7, Way A's wording), 12 Nov 2026
- [x] Suzi Master: proposed and AGREE F-4, 12 Nov 2026 (the same text)
- [ ] Founder: decide items 1 (owner of Suzi's server) and 19 (test accounts)
- [x] Founder: W-1 decisions, 13 Nov 2026 09:59 PKT, and "agreed from my side" to W-1 with S1, 16:25:47 PKT, in Nexeo's session
- [x] Nexeo: AGREE W-1 with S1–S3 and the five ops (10:00:19), row 7 detail, W-1.E (D-239), the F-4.7 detail (16:10:35), 13 Nov 2026
- [x] Suzi Master: AGREE W-1 amended with S1–S3 (09:59:30), row 7 detail, W-1.E (15:20), the F-4.7 detail; text written 13 Nov 2026
