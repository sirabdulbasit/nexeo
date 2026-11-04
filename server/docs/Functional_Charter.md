# Functional Charter: Nexeo and Suzi

**Version 1.0, 4 Nov 2026.** Agreed by Nexeo and Suzi. Both sides hold this same file. Items marked *founder* wait on the founder's decision.

**Changing this charter:** any change must be re-agreed by both sides BEFORE any development or build starts: propose it, both reply AGREE with date, time and seconds (PKT), update this file on both sides, then build. Cost matters are in `Costing_Charter.md`.

## The principle

Suzi is the face of Nexeo; Nexeo is the record.

- **Nexeo** knows: knowledge, connectors, data, rules and delegations, the Action Center and the audit trail. It is the ONLY writer to the outside world (email, calendar, tasks, other people). It keeps the day going when the user's computer is off.
- **Suzi** runs the user's day from a local working copy: listens, talks, briefs, presents, follows up, drafts, takes meeting notes, operates the computer. When something must change in the world, she asks Nexeo to do it, after the user's confirmation.

Each user has their own Suzi: the boss's personal assistant for clerical work. The Nexeo portal is for account management, not day-to-day work.

## The three parts

- **The desktop app (Suzi):** runs on Mac or Windows; a user is on one or the other. The `os` field in hello says which.
- **Suzi's server (`jarvis-gateway`):** holds the live connection and the conversation model.
- **Nexeo:** the system of record.

*Founder:* who owns Suzi's server. Until he decides, the Nexeo session keeps it. CN-009, the unfinished work there, is finished or parked by that owner.

## Responsibilities

"Suzi" below means the desktop app, unless a row names Suzi's server.

| # | Area | Nexeo | Suzi |
|---|---|---|---|
| 1 | Knowledge (wiki) | Builds and keeps the wiki from all feeds; serves knowledge as facts; chooses the wiki slices for the day pack | Carries today's slices (people, glossary, quick facts, meeting prep, pinned pages); asks for everything else through the knowledge route. Suzi's server's model writes the words, citing the page title |
| 2 | Connectors | Holds email, calendar, contacts, chat, drive and organisation systems, and their sign-in tokens | Holds none; reads through the day pack and acts through Nexeo |
| 3 | Data of record | The truth for tasks, rules, people and history; resolves conflicts | A local, encrypted, read-only working copy, wiped on sign-out or account change. It may hold the whole pack: today and tomorrow in full, the rest of the week's titles, all open actions |
| 4 | Rules, delegations, standing instructions | Stores them as a version-numbered structured file plus readable Markdown; checks who may grant what; audits; pushes changes | Captures new rules by voice or typing, reads them back, gets confirmation, sends them to Nexeo, and ENFORCES the structured rules in code before any action |
| 5 | Action Center (tasks) | Owns tasks: create, assign, update, notify owners, nudge others by rule or on the user's yes | Presents them, follows up at sensible moments (follow-up card, quiet hours, away detection), captures decisions (done / move / drop / not yet) and sends them as `act` operations; triage sessions |
| 6 | Email | Finds threads, drafts in the user's style, sends, forwards and undoes; auto-sends only when a rule allows | Shows the draft on the board, takes voice and typed edits, gets the explicit "send" confirmation (voice lock), offers a 10-second undo |
| 7 | Calendar | Reads and writes events; sends reminders while the computer is off | Gives meeting alerts and prep from the day pack; sends booking requests through `act` |
| 8 | Day pack | Builds it on request (about 8 s cold; `emails_loading` may be true), serves changes since a cursor, sends push hints | Fetches it on connect, unlock, every 15 minutes and before a brief (moving to `?since=` once the feed exists); caches it encrypted; works offline from it. Handles `emails_loading` and `missing` |
| 9 | Live conversation | Serves the facts behind requests. **Suzi's server** answers requests that need knowledge, data or reasoning | Wake word, voice lock, listening, transcription, instant acknowledgements, interruptions, goodbyes, language switching, the speaking voice and the 3D character |
| 10 | Presentation | Supplies data blocks with numbers filled in by the server | The board, the presenter (walk, point, look at the user), narration in the user's language when `say` is empty, Stop / Esc. Labels on the board show as sent; known ones are translated when spoken |
| 11 | Follow-ups and chasing | Decides what to chase, reminds other people, keeps follow-ups due while the computer is off | Asks the user at good moments, records answers, reports others' progress |
| 12 | Meeting notes | Receives minutes or action items ONLY with the user's consent per meeting | Records only when opted in (Settings); transcript, minutes, action items and email draft stay on the machine |
| 13 | Operating the computer | **Suzi's server** chooses tools step by step | Runs them locally: apps, URLs, typing, keys, text-finding clicks, files (search, open, read, write, move, delete to the Trash or Recycle Bin), clipboard, media, system status, screenshots, the local screen operator |
| 14 | Journal | Stores what Suzi reports; keeps the team in step | Sends what happened (follow-up answers, decisions, actions taken), batched; meeting notes only with consent |
| 15 | Devices | Marks one device per user as `primary`: the founder's M5 Mac now, then a portal setting, else the first paired device | Only that Suzi runs follow-ups and actions; others only show and talk |
| 16 | Privacy | Enforces per-user access: nothing outside the user's rights goes in the day pack | Never sends idle speech off the machine (local Whisper); only voice-verified requests of 2 s or more go out for transcription (Gemini via the companion); the camera stays off unless the user says yes |
| 17 | Language and time | Gives times in the user's own time zone, never UTC (`pack.tz` is the only source). **Suzi's server** replies in `reply_language` | Uses the preferred language from Settings, switches for one reply when the user speaks another, writes Urdu in Urdu script, never Hindi script |
| 18 | Audit | Audits every write: who, what, when, from which device | Logs every menu and button action and every tool step locally |
| 19 | Inbound WhatsApp | On hold by the founder: Nexeo's Brain keeps answering until he lifts it | Not involved until then |

## Rules both sides follow

- **R1 One writer:** only Nexeo changes the outside world. Suzi never sends, books, approves or updates anything directly, including by operating an app on the computer, unless the user asked for it in this request, confirmed it with the voice lock, and it is journaled. Local file actions on the computer are outside R1; Suzi's tiers cover them.
- **R2 Confirmation before anything irreversible** (send, approve, delete, reassign, rule change): the user's spoken or clicked yes with the voice lock passed; money or approval delegations need an extra on-screen confirmation. `task.update` on the user's own items needs no voice check; `voice_score` is recorded when sent.
- **R3 Rules are enforced, not advised:** the structured rules are checked in code. Suzi's check can only refuse; Nexeo's check at the moment of writing decides. Rules may only make Suzi stricter.
- **R4** Act only on the current request; never carry out old or unfinished requests unless repeated.
- **R5** Never claim an action that didn't happen; report failures plainly.
- **R6 Fail softly:** if one source is down, present what's available and say what's missing. After one failed tool call, say one short sentence and end the turn; no loops.
- **R7 State freshness:** when local data is older than about 15 minutes, say when it's from ("as of 3:05").
- **R8 Privacy defaults:** meeting data stays local, idle speech is never sent, the camera is off, the day pack holds only the user's own data.

## Suzi's action tiers

- **T0, silent:** reading.
- **T1, narrated:** open, type, click.
- **T2, needs a voice-verified yes or an Approve click:** close app; file move or delete; shell commands; risky hotkeys, including Return, Enter and Cmd/Ctrl+Return; `type_text` ending in a newline; `click_text` on Send, Submit, Approve, Pay, Transfer, Buy, Confirm, Sign, Post, Publish, Share or Forward (Sign in and Sign up stay T1).
- **Coordinate clicks:** the element at that point is looked up (Accessibility on Mac, UI Automation on Windows). An outward button or an unreadable label makes the click T2. Suzi builds this before any send is enabled.
- Off-limits paths and commands are always refused, per OS. At most 15 screen steps per turn.

## Reminders and presence

- Presence frame: `{"type":"presence","state":"active|away|locked|asleep|paused"}`, on every change and every 60 s while connected, sent only if `presence` is in `welcome.features`.
- **Alive:** a presence frame in the last 3 minutes with state active, or away for under 30 minutes.
- While the primary Suzi is alive, Nexeo uses no other channel to reach the user. Routine items go through the pack and the changes feed, and Suzi picks the moment. Critical items arrive at once as `assistant_start`.
- With no heartbeat for 10 minutes in working hours, Nexeo holds items and delivers them on return; urgent ones may go by email. Working hours: the user's day outside quiet hours (from rules; default quiet 22:00–08:00), in `pack.tz`.
- In quiet hours a critical item waits (silent card) unless the user's rules say it may wake them, then one short spoken alert. While meeting notes are on: silent card only, spoken after the meeting.
- Nexeo's own morning brief stops once Suzi's handover has worked.

## The contract

- **Live link:** WebSocket protocol v1 (hello / welcome with features, user_utterance, assistant_start, assistant_delta, assistant_done, tool_call → tool_result, notice). Tool arguments go under `args` and must match the schema the device announces in hello.
- **Device tools:** the tools announced in hello, including `present_report` (blocks: kpis, chart, table, list, text).
- **Day pack:** `GET https://tai.tmcltd.com/suzi/v1/day-pack`. Fields include `version` (format version), `generated_at`, `cursor`, `tz`, `date`, `calendar`, `actions`, `emails`, `emails_loading`, `kpis`, `brief`, `missing`.
- **Act:** `POST https://tai.tmcltd.com/suzi/v1/act` with `{op, args, idempotency_key, confirmed_by_user, voice_score?, ts?}`. `task.update` args: `{id, update: done|cancel|move|not_yet|note, due?: YYYY-MM-DD, note?}`. Tenant, user and device come only from the verified login, never the body. `rules_version` is added once rules are in the pack.
- **Signing, before any send:** Ed25519 key in the OS keyring (Keychain, or Credential Manager on Windows), registered once with `POST {gateway}/v1/device-key {"pubkey":"<base64 raw 32 bytes>"}`; replacing a key needs the founder in the portal. The device signs RFC 8785 canonical JSON of `{op, args, idempotency_key, ts}` in the header `X-Suzi-Signature`; `ts` is UTC ISO-8601, within 5 minutes. Suzi's server is the only verifier and forwards a verified result; Nexeo refuses an irreversible op without it. Sends stay off until signing and the coordinate-click check exist.
- **Knowledge:** `GET …/knowledge?q=<text>` → `[{page_id, title, excerpt, updated_at, url}]`, at most 5 results, about 4,000 characters.
- **Reports:** `present_blocks({title, blocks:[{id, title, say}]})`: data tools return blocks with ids, and Suzi's server builds `present_report` from them, so a number never comes from the model. First version: tasks, meetings, emails. Business figures come once a source is connected through Integrations.
- **Accepted on Suzi's server:** per-turn lines reach the model as a `[Context, not spoken by the user: …]` note; laptop text results are cut at 12,000 characters as the model sees them.
- **To come:** `GET …/changes?since=`, `POST …/journal`, the `{"type":"sync"}` push hint and `presence` in `welcome.features`, `primary` in welcome.

## Windows

Same guarantees on both systems: a Mac-specific promise needs its Windows equivalent before Windows can do that action. No Windows build exists yet. Acceptance needs: a Windows build, the companion's Windows service (3dAI), Windows OCR, UI Automation, a Windows test user. Off on Windows until then: `click_text`, `read_screen`, `operate_computer`, call audio, following the system speaker. Every coordinate click needs a yes.

## Credentials

A `suzi-desktop@nexeo-tmc` service account with only model calling and Cloud TTS, one key per device, the OS told apart by labels. The founder creates it. Order: new account and keys, move the machines, confirm who else uses `vertex-sa` (possibly Suzi's server), only then rotate the `vertex-sa` key.

## Testing

A dedicated test user per OS, so tests stop touching the founder's history and items (*founder:* the test account and its integration key). Acceptance runs on the real machine, with the frames reported.

## What exists and what's next

**Suzi, built:** wake word, voice lock, instant Urdu/English acknowledgements, interruptions, Urdu goodbyes; companion voice and hearing; the 3D presenter and full-screen stage; board reports, morning brief, what's pending, the follow-up card; the day pack client with encrypted cache, local narration and an outbox for `task.update`; local meeting notes, the typing box, 27 local tools, the local screen operator.

**Suzi, to build:** the Rules view and read-back card, the email compose card, the journal sender, the changes feed and push handling, task create and assign from speech, triage mode, respecting `primary`, the coordinate-click check, signing registration, the Windows steps above.

**Nexeo and Suzi's server, built:** day pack v1, `act` with `task.update`, audit trail.

**Nexeo and Suzi's server, to build:**
1. Device id in `act`; allow `ts`; remove the fixed Karachi zone on Suzi's server.
2. Presence and the reminder rules above.
3. Knowledge route, `present_blocks`, `primary`.
4. `rules` + `rules_md`, people, glossary, wiki slices; `rule.propose / apply / remove`; `task.create / assign / reassign / priority`; changes feed and `sync`; triage list.
5. Signing, then email ops, journal, safety net.

## How we talk

Every message between Nexeo and Suzi carries its date and time with seconds (PKT). Each side replies AGREE, or a numbered list of changes and questions. The history of how this was agreed is in Nexeo's `server/docs/NEXEO_SUZI_AGREEMENT.md`.
