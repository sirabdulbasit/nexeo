# Suzi ⇄ Nexeo: Functional Charter

**Agreed by Suzi and Nexeo on 4 Nov 2026** (deploy D-155; Windows change agreed 17:37 PKT). Items 1 and 19 wait on the founder.
Costs, budgets and the consumption record are in [Costing_Charter.md](Costing_Charter.md).

## 1. The three parts and the principle

- **The desktop app (Suzi, Mac or Windows):** runs the user's day from a local working copy. She listens, talks, briefs, presents, follows up, drafts, takes meeting notes and operates the computer. The `hello` frame's `os` field says which OS (`macos` | `windows`). A user is on one OS or the other, not both.
- **Suzi's server (jarvis-gateway):** the live link to the desktop app. It runs the conversation model (answers requests, chooses tools, writes replies), verifies devices and signatures, and forwards operations to Nexeo.
- **Nexeo:** the record. Knowledge, connectors, data, rules and delegations, the Action Center and the audit trail. It is the **only writer** to the outside world (email, calendar, tasks, other people), and it keeps the day going when the computer is off.

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
| 12 | Meeting notes | Receives minutes only with consent per meeting | — | Opt-in; transcript, minutes and email draft stored on the computer only |
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
- **R2 Confirmation before anything irreversible**, with the voice lock passed; money and approval delegations get an extra on-screen confirmation. **Irreversible operations are signed by the device** (see the contract). Sends stay off until signing exists. `task.update` on the user's own items needs no voice check (it is recorded with `voice_score` when spoken).
- **R3** Rules are enforced in code; the desktop app's check can only refuse, and Nexeo's check decides.
- **R4** Act only on the current request.
- **R5** Never claim an action that didn't happen.
- **R6 Fail softly:** present what's available and name what's missing; one failed tool call means one short sentence, then end the turn.
- **R7** State freshness ("as of 3:05") when data is older than about 15 minutes.
- **R8 Privacy defaults:** meeting data stays local, idle speech is never sent, the camera stays off unless the user says yes.

**Safety tiers in the desktop app:**
- **T0, silent:** reading.
- **T1, narrated:** opening, typing, clicking.
- **T2, needs a voice-verified yes or an Approve click:**
  - closing apps, moving or deleting files (to the Trash or Recycle Bin), shell commands, risky hotkeys;
  - clicking an outward button (Send, Submit, Approve, Pay, Transfer, Buy, Confirm, Sign, Post, Publish, Share, Forward), and screen-operator tasks that ask for one;
  - typing text that ends in Enter, and the hotkeys Return, Enter and Cmd/Ctrl+Return;
  - a coordinate click (`mouse_click`) on an outward button, or on an element whose label can't be read. The element is looked up with Accessibility on the Mac (built) and UI Automation on Windows (to build; until then **every** coordinate click on Windows is T2).

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
  - `task.update` args: `{id, update: done|cancel|move|not_yet|note, due?: YYYY-MM-DD, note?}`
- **Signing (irreversible ops):**
  - An Ed25519 key in the OS keyring.
  - One-time `POST /v1/device-key {"pubkey":"<base64 raw 32 bytes>"}`, stored in `jarvis.devices.pubkey`. Replacing a key needs the founder.
  - The signature covers canonical JSON (**RFC 8785**) of `{op, args, idempotency_key, ts}`, sent as the header `X-Suzi-Signature`. `ts` is top level, in UTC, and within 5 minutes.
  - **Suzi's server is the only verifier.** It forwards a verified result to Nexeo, and Nexeo refuses irreversible ops without it.
- **Presence:**
  - `{"type":"presence","state":"active|away|locked|asleep|paused"}`, sent on every change and every 60 s, once `welcome.features` includes `presence`.
  - "Alive" means a presence frame in the last 3 minutes with state active, or away for under 30 minutes.
  - Working hours means outside the user's quiet hours (default 22:00–08:00), in the pack's `tz`.
- **Knowledge:** `GET …/knowledge?q=` → `[{page_id, title, excerpt, updated_at, url}]`, at most 5 results and about 4,000 characters.
- **Presenting:** data tools return blocks with ids; the model calls `present_blocks({title, blocks:[{id, title, say}]})`; Suzi's server builds `present_report`. First version: tasks, meetings, emails.
- **Usage:** `POST …/usage`, one batch per finished day (see the Costing Charter). Live since D-156, like `presence`.
- **To come:** `GET …/changes?since=`, the push `{"type":"sync"}` hint, `POST …/journal`, and `primary` in `welcome`.

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
- [ ] Founder: decide items 1 (owner of Suzi's server) and 19 (test accounts)
