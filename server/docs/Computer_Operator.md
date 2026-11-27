# Computer Operator

The one document for the computer operator: what it is, what the founder decided, what is live, what is built but
off, what is waiting, and how to continue. Update it in the same commit as any change to the operator.

Founder, 24 Nov 2026: *"this should be documented and Computer_Operator.md, for all things related to computer
operator."* So everything about the operator goes here, by every session (rule in the project `CLAUDE.md`).

Last updated: 24 Nov 2026, 09:55 PKT (close of the operator session).
Link topic: **T41**. Full history, round by round: `NEXEO_SUZI_AGREEMENT.md` § T41.

---

## 1. What it is

Suzi working on the user's own computer the way a person does: looking at the screen, clicking, typing, scrolling,
until a task is done. Asked for by the founder on 18 Nov 2026: one central operator system that every Suzi client
uses to operate its own computer, each client isolated, working like Claude Desktop Commander or Claude in Chrome.

The six jobs he listed:

| # | Job | Condition |
|---|---|---|
| 1 | Read, search (name and content), organise and move files; every task on readable files | |
| 2 | Read images | his special permission, per folder |
| 3 | System settings and optimising | his permission, or a standing instruction |
| 4 | Run or search anything on the internet | |
| 5 | Run AI tools such as Claude and ChatGPT | under his own account |
| 6 | Open and fill any form on the internet | submitting is a T2 action |

Why it exists (DEF-386, CL-062, 3 Nov): Suzi said eight times that she had downloaded a Mixamo animation and had
downloaded nothing. The operator's first rule comes from that: **a run is `done` only with proof.**

## 2. The founder's rulings (these govern everything)

| Date | Ruling |
|---|---|
| 18 Nov | He wants a central operator system used by every Suzi client, each isolated. |
| 18 Nov | "It should be totally free": no paid model per step. |
| 19 Nov 18:07 | "yes switch on": consent recorded and the operator switched on for his company (TMC-0001). |
| 23 Nov | "we will call it Operator Model now": the name for UI-TARS-1.5-7B in everything said to him and in the charter. |
| 23 Nov | **"Operator Model will remain under Nexeo and Suzi Client will use it because i can't install 4.5GB suzi client."** The model runs on a machine Nexeo holds. The client never carries it. |

The last ruling overrules the design built on 18 Nov (model on the Mac). Do not propose or build any path where a
customer's Suzi client installs the model.

## 3. The Operator Model

- **What:** UI-TARS-1.5-7B, made by ByteDance (Seed team), licence Apache-2.0. It is downloaded, not built by us.
  The copy used is the 4-bit one, about 4.5 GB (`mlx-community/UI-TARS-1.5-7B-4bit`).
- **What it does:** given a goal and a screenshot, it answers with one action (click at x,y; type; scroll; finished).
- **Checked once, 23 Nov, on the founder's Mac** (Suzi-Builder, in an older test environment, nothing installed): the
  files are complete; it loads in 3.5 s; one step took 8.1 s; peak memory 5.6 GB; asked to click a Download button it
  clicked within 6 pixels of its centre.
- **Where it must run:** a machine with a GPU or an Apple chip. The Nexeo server has 8 CPUs, 31 GB memory and no
  GPU, so it cannot run it at a usable speed. **No machine is chosen yet** (§8).

## 4. The design (both sides AGREE, 23 Nov; in the Functional Charter, operator section)

```
 Suzi client (Mac)                 gateway                    Nexeo                    Operator Model
 hands only                        relay (NOT BUILT)          control + loop           (machine NOT CHOSEN)
 ─────────────────                 ─────────────────          ─────────────────        ─────────────────
 screenshot (JPEG) ───────────────────────────────────────▶   operator/step  ───────▶  screenshot + goal
 does the action   ◀───────────────────────────────────────   one action     ◀───────  one action
 Guard, blanked apps, proof on the Mac                        consent, limits, ledger
```

- **Suzi client:** takes the screenshot, sends it, receives one action, carries it out through her Guard, repeats.
  Blanked apps are masked on the computer before anything is sent. She proves the result on the computer.
- **Structure first:** browser and form work uses the page's structure (the Mac's Accessibility tree) with no
  screenshot and no model step. The Operator Model is called only where structure gives no answer. Expected: 0 to 3
  model steps for most web and form jobs.
- **Nexeo:** consent, the on/off switch, limits, hidden apps, permissions, the run ledger, and the loop that talks to
  the Operator Model.
- **Free:** a run on the Operator Model never calls a paid model. Without proof from the computer it ends
  `unverified`, never `done`.
- **Per step:** one JPEG, 1280 px wide, quality 80, about 120 to 300 KB. Aim 2 to 4 s per step; a step is cut at 20 s;
  a run at 15 minutes.
- **Privacy (needs his yes, §8):** a screenshot is used for its step only, never stored, never logged, never used for
  training by Nexeo.

## 5. The contract

### 5.1 Live (D-301, D-305)

- **Day pack `operator`:** `{enabled, consent_at, images {allowed, folders[]}, system {allowed}, blank_apps[],
  max_steps, limits {tasks_month, steps_month}, used {tasks, steps}}`. `enabled` is true only with recorded consent.
- **`/v1/act` `operator.report`:** exactly 9 fields: `run_id, job, status, proof, steps, actions, started, ended, goal`.
  Any other field is refused (`bad_args`), so a screenshot or file content has nowhere to arrive. `done` with
  `proof: none` is stored `unverified`. A repeat of the same run writes nothing more (`already: true`).
  Jobs: `files, images, system, web, form, ai_tool, screen, scheduled`. Proofs: `file, page, screen, none`.
  Used for runs done by Suzi's own tools with no model step.
- **`/v1/act` `operator.permission`:** his yes or no to images (and which folders) and to system jobs. Confirmed by him only.
- **`/v1/changes`:** type `operator` after a permission or settings change.
- **Scheduled standing instructions (D-305):** `instruction.add {text, scope?, schedule?}`,
  `instruction.update {id, schedule | null}` (the schedule only). `schedule: {every: day | week | month,
  on?: mon..sun | 1..28, at?: "HH:MM"}` in the computer's local time. Details: `Rules.md` §9.

### 5.2 Built, not deployed, off (commit `93a0043f`)

Loopback routes for the gateway (`/api/v1/suzi/gateway/…`, built for DEF-386, D-150):

- `POST operator/start {user_id, tenant_id, goal, os?, job?}` → `{status: "act", run_id, actions, max_steps}`, or
  `refused` (`disabled, no_consent, no_model, limit_reached, bad_goal`), or `local` (`central_off, private_mode`).
- `POST operator/step {run_id, results: [{call_id, ok, output?, image_b64?, meta?, error?, note?, proof?}]}` →
  `{status: "act", actions, step}` or the end: `done | unverified | needs_user | failed | step_limit | stopped`.
- `POST operator/stop {run_id}`.
- An action is `{call_id, tool, args}` or `{call_id, wait_ms}`. Tools sent today: `screen_capture, mouse_click,
  click_text, type_text, hotkey, read_screen, scroll {direction: up | down, amount: 1–20}`. `open_url` and `open_app`
  are allowed by the contract but not sent.
- `meta` on a screenshot: `{scale, origin_x, origin_y, pointer_x, pointer_y}`.
- `note` on a failed result: `refused_by_guard` or `blanked_app`. The Operator Model is told a fixed sentence; Suzi's
  own error text is not passed on.
- `proof` on a screenshot's result: `file` or `page`, when Suzi's check on the computer holds at that moment. The
  proof on the latest screenshot counts. With it the run ends `done`; without it, `unverified`.

The whole loop stays off while the server's `OPERATOR_CENTRAL` is not `on`: `start` answers
`{status: "local", reason: "central_off"}`.

## 6. Where the code is

| What | Where |
|---|---|
| Pack, report, permission | `server/src/services/suzi/suziOperator.ts` |
| Central loop, limits, ledger | `server/src/services/operator/operatorService.ts` |
| Operator Model and Claude adapters, image reading | `server/src/services/operator/models.ts` |
| Action → client tool, coordinates | `server/src/services/operator/actions.ts` |
| Gateway routes | `server/src/routes/suziGatewayRoutes.ts` (`operator/start, step, stop`) |
| Schedule on instructions | `server/src/services/knowledge/instructionSchedule.ts`, `instructionService.ts`, `suzi/suziDelegations.ts`, `suzi/suziRules.ts` |
| Admin screen | `client/src/pages/admin/OperatorTab.jsx` (Admin → Client Specific → Computer Operator; `GET/PUT /api/v1/admin/operator`) |
| Tests | `tests/t41Operator.test.ts` (17), `tests/t41Schedule.test.ts` (8), `tests/t41Central.test.ts` (9), `tests/def386Operator.test.ts`, `tests/f210DelegationsInstructions.test.ts` |
| Stores | `operator_settings` (per customer), `operator_runs` (ledger), `users.notification_preferences.suzi.operator` (his permissions), the instruction's Wiki page (schedule) |
| Suzi client | `/var/www/suzi` (repo suzi-client): `suzi/operator.py`, `suzi/tools/operate.py`, `suzi/tools/guard.py`. This copy may be older than the Mac's. |
| Gateway relay spec | `/var/www/jarvis-gateway/docs/inbox-2026-11-03-operator.md` |

Ledger rows: a local report has id `loc_<hash>` and model `local:<job>`; a central run has model `uitars:<name>#<job>`.

## 7. State on 24 Nov 2026

| Piece | State |
|---|---|
| Nexeo control: pack, report, permission, changes | **Live**, D-301, 18 Nov 16:48 |
| Operator switched on for TMC-0001 | **On** since 19 Nov 18:07:22 (consent by user 2) |
| Admin screen | Live in the client bundle; **never opened in a browser** |
| Scheduled standing instructions | **Live**, D-305, 23 Nov 13:19 |
| Central loop additions (job, note, proof, scroll, JPEG, no paid checker) | **Built, not deployed, off** (`93a0043f`); D-306 and D-307 left it out on purpose |
| Machine for the Operator Model | **Not chosen** |
| Gateway relay (client ⇄ Nexeo) | **Not built; no builder** (gateway is under Suzi Master, on hold) |
| Suzi client half | Being built by Suzi-Builder behind a switch |
| Suzi: browser by structure (C4) | by 25 Nov |
| Suzi: forms (C7) | by 26 Nov |
| Suzi: system jobs (C5), AI tools (C6) | by 27 Nov |
| Suzi: scans (C3) | after his yes to images |
| Go-live tests with him (planted instructions on screen; Mixamo download) | 28 Nov |
| **Real operator runs completed** | **0, ever** |

Why 0 runs: until 23 Nov the client tried to load the model on the Mac, and the libraries for that were never
installed in the Suzi version he runs, so every run failed in under a second (17 Nov, and 23 Nov 16:43). That
install is now withdrawn; the local loop is a builder's test tool only. Suzi-Builder added a start-up check and a
`failed` report for a run that crashes before it starts.

Related, not the operator: Suzi's screen-reading tools (`read_screen`, `scroll_read`, the `screen_text` of `open_url`
and `open_app`) send the front window's text to the AI answering that turn. Agreed charter line, 23 Nov: the text
read is not stored by Nexeo or the gateway; what Suzi answers is kept like every answer.

## 8. Waiting on the founder (asked 23 Nov, not answered)

1. **The machine for the Operator Model.** Recommended: a Mac mini he owns, kept on (one-time cost, nothing per
   step). The other way: a rented GPU server (monthly cost, against "totally free").
2. **His yes that each step's screenshot goes to Nexeo**, used for that step only and never stored. Until then
   charter row 13's privacy sentence is not in force for central runs and nothing goes live.
3. **Who builds the operator's relay in the gateway** while Suzi Master is on hold. The operator session offered;
   it was not started, because Suzi's side is never changed without his word.
4. His yes to reading images (starts C3, scans).

## 9. How to continue (in this order, after §8)

1. Serve the Operator Model on the chosen machine behind an OpenAI-style chat endpoint. For the customer, set
   `operator_settings.model = 'uitars'` and `uitars_base_url`; the key goes in env `UITARS_API_KEY`.
2. Build the gateway relay to `operator/start | step | stop`. The gateway's `ImageOutput` (`src/protocol.ts`) is a
   strict object and drops `meta`: it must keep `meta`, `note` and `proof`.
3. Deploy `93a0043f` (clean clone, compare with the running `dist`, copy only the changed files, chart row), then set
   `OPERATOR_CENTRAL=on` and restart after a quiet check.
4. Announce the routes to Suzi-Builder for his account on the link.
5. First real run with him. Check the row in `operator_runs`, and that a run without proof ended `unverified`.
6. The two go-live tests (28 Nov plan).

## 10. Never verified

- Any real operator run, local or central.
- The central loop against a real Operator Model (unit tests use a scripted model).
- The admin screen in a browser.
- `rules.standing[].schedule` read from real data; a real scheduled run.
- Windows: the Suzi client has Windows versions of its everyday tools, but no operator work has been done for
  Windows. With the model under Nexeo, a Windows client needs only the hands; not designed, not agreed.

## 11. Rules for whoever works on this

- Any change to the contract, the charter text or shared behaviour is agreed with Suzi on the link
  (`/root/suzi-nexeo-link`, topic T41) **before** building.
- Never change Suzi's side (client, gateway) without the founder's word.
- Nothing about a screenshot, page text or file content is stored or logged by Nexeo. `t41Central.test.ts` pins it.
- `done` only with proof. Never call a paid model for an Operator Model run.
- Watching the link: compare file names (`YYYYMMDD-HHMMSS-suzi.md`) against a cut-off, in `inbox/` and `archive/`.
  Never `find -newer` on our own file: Suzi archives it in the same commit as her answer. Last Suzi T41 file read:
  `20261123-175641-suzi.md`.
- Probes on the real database: a made-up customer is refused by the Wiki's guard; use a rolled-back transaction on
  his customer and check from a fresh process afterwards.

## 12. Scheduled jobs after T50 (27 Nov 2026)

Agreed with Suzi-Builder 27 Nov 10:35 PKT (T50). A scheduled standing instruction now says where it runs:
`runs_on: "mac"` (this document: Suzi runs it and reports `operator.report {job: "scheduled"}`) or `runs_on: "nexeo"`
(Nexeo's server runs it; not the operator). A schedule set before T50 stays a Mac job. Nexeo marks a Mac job `missed`
when no scheduled report arrives within 2 hours of its time. One limit: a report carries no job id, so one report in
the window counts for every Mac job due in it. Everything else about jobs is in `Three_Roles.md` §3.4.
