# Suzi ⇄ Nexeo: Costing Charter

**Status:** agreed by Suzi and Nexeo on 4 Nov 2026; **approved by the founder on 4 Nov 2026** ("start building as per the charters"). Decisions 8.2 and 8.3 are taken as recommended until he says otherwise.
Functional responsibilities are in [Functional_Charter.md](Functional_Charter.md).

## 1. Principles (founder, 4 Nov 2026)

- **Quality is fixed; cost goes as low as that allows.** No saving may lower quality. Each one is tested against today's behaviour on the same real requests, and it ships only if quality is equal or better.
- **$20 per user per month**, all three parts together (desktop app, Suzi's server, Nexeo), is the **target we report against**, not a limit that can lower quality.
- **Each side keeps its own part optimal.** Suzi and Nexeo agree the plan between themselves. Then **one joint summary** goes to the founder for **approval**, and work starts only after it.
- Nobody, on either side, downgrades the voice, the model, features or how proactive Suzi is to save money without the founder's explicit decision.

## 2. Where the money goes today (estimates; real figures to follow)

| Part | Per day | Per month (30 days) |
|---|---|---|
| Nexeo | about $0.50 | about $15 |
| Suzi's server | $0.20–0.40 | $6–12 |
| Desktop app (voice, hearing, meeting notes) | about $0.22 | about $6.60 |
| **Total** | **$0.90–1.15** | **$27–35** |

At 40 turns a day (the design figure):
- Pro everywhere: **$27–41** a month.
- Routing only work proven equal to cheaper models: **about $20–27** a month.

Real per-turn figures replace these once real desktop turns are logged.

## 3. Proposed split of the $20 (a target per part)

| Part | Per month | Per day |
|---|---|---|
| Nexeo | $7.50 | $0.25 |
| Suzi's server | $7.50 | $0.25 |
| Desktop app | $5 (target; $5.50 ceiling until measured) | $0.16 |

## 4. Efficiency measures (no quality loss)

**Item 1, restores quality (approvable now, on its own):** Nexeo re-judges at once when something important changes. Its earlier savings could leave a score up to a day old and a triage decision up to 7 days old. The fix is live since D-156, and costs slightly more.

**Caching saves nothing until it's measured on real turns.**

**Seeing the costs:**
- record Brain's unrecorded reply path;
- the model name in the token log;
- `app=suzi-desktop` and `os=…` labels (in 3dAI for the companion's Gemini calls);
- the consumption record (section 7).

**Desktop app:**
- more answers from the day pack, with no server turn;
- an audio cache for sentences already spoken in that voice;
- long lists shown on the board with a short spoken summary;
- voice synthesis stops at once on interruption.

The voice stays **Chirp 3 HD**.

**Nexeo and Suzi's server:**
- wiki facts through the knowledge route, instead of Brain's 60,000–100,000-token reply path;
- `present_blocks`;
- no retry loops;
- screenshots only when reading text fails.

## 5. Tests (on a dedicated test user, about a few dollars in total)

- **Pro stays the default** for anything complex. **Flash is tested per kind of work** and used only for the simple kinds where it proves equal. A kind that fails stays on Pro.
- **Kinds to test:**
  - greetings and small talk;
  - reading back known facts;
  - simple single-tool requests;
  - device controls (open or close an app, play or pause, volume, battery, lock screen).
- **Never routed to Flash:** drafting or sending for the user, decisions about tasks, rules or approvals, multi-step screen tasks, and knowledge questions.
- **Urdu** is judged separately, by the founder listening.
- **Nexeo:** skipping Pro on bulk mail that rules identify, and small knowledge jobs on Flash.
- **Trimming old turns** from the context.
- **The bar:** a cheaper option ships only if it matches Pro at least as well as Pro matches itself, and the founder hears no difference. Results come back to him before anything switches.
- **Already rejected:** triage on Flash (17 of 30 against Pro's own 23 of 30). Triage stays on Pro.

## 6. Usage design and limits

- **Design usage:** 40 turns a day on average, 100 at peak. About 10% are answered on the desktop today, and 20–30% once more day-pack answers are added.
- **Alerts, not downgrades:** at 80% of the month the founder is warned with the per-part breakdown. At 100% he is told, quality stays the same, and he decides whether to raise the cap.
- **If the tests fail:** the founder gets the real number and the options. Quality is not lowered to meet $20.

## 7. Consumption record (Nexeo keeps it; viewable by service, user, day or date range)

1. **Nexeo keeps the one record.** Suzi's server and the desktop app report what they used.
2. **Suzi's server** reports each model round: user, tenant, device, turn id, model, prompt / cached / output / thinking tokens, and time, from the provider's own counts.
3. **The desktop app** sends a daily batch through its server: `POST {gateway}/v1/usage {day, os, app_version, idempotency_key, items:[{service, units, unit}]}`. It is safe to resend, and identity comes from the login.
   - **Paid:**
     - `voice_characters`: measured exactly.
     - `hearing_seconds`: measured duration; tokens estimated.
     - `meeting_audio_seconds`: measured.
     - `meeting_writing_characters`: measured; tokens estimated.
   - **Nexeo, Meeting Assistant (F-4):** `meeting_transcript_minutes` (Way A, counted when a transcript is read; a count
     only). Way B's line and `meeting_participant_seconds` are added only when that line is agreed.
   - **Free (counted for completeness):** `voice_characters_fallback`, `local_hearing_seconds`, `local_screen_operator_steps`.
   - **Activity:** `turns_spoken`, `turns_typed`, `turns_app_started`, `local_answers`, `tool_steps`, `screenshots_sent`.
4. **Counts only:** never speech, transcripts, prompts or any content.
5. **One price table at Nexeo** prices all parts the same way. Each row is marked measured or estimated.
6. **Monthly check against Google's bill**, with the gap reported. Unreported costs, such as the 3dAI character builder, show up there. Chirp 3 HD on the bill is the desktop voice; Neural2 is Nexeo's WhatsApp voice notes.
7. **Views:** an admin screen and export by service, user, day or date range. A user's figures are visible only to admins.
- **Day boundary:** the user's own time zone (the pack's `tz`).
- **Late batches:** accepted up to 7 days late; a month closes on day 7 of the next month. Older batches stay on the machine and show on Suzi's Live status.

## 8. For the founder to decide

1. Approve the plan (sections 3–7), or approve item 1 on its own first.
2. What counts toward $20. Both sides recommend all usage costs on all three parts (models, voice, hearing, images), but not hosting or fixed infrastructure.
3. Confirm the design usage: 40 turns a day, 100 at peak.
4. Provide the test accounts and their integration keys.

## 9. Sign-off

- [x] Suzi: agreed, 4 Nov 2026 (consumption record: 17:37:42 PKT)
- [x] Nexeo: agreed, 4 Nov 2026 (consumption record: AGREE on Suzi's 17:37:42 answers, given 19:37:41 PKT)
- [x] Founder: 5 Nov 2026, the desktop's own LLM: its cost on the user's key counts toward the $20; roughly cost-neutral; each rule on the model covers its own path ("never on Flash" governs what Suzi's server and Nexeo pick; on the own LLM screen tasks run only on tested models).
- [x] Founder: approved, 4 Nov 2026 (decisions 8.2 scope and 8.3 design usage as recommended, pending his correction; 8.4 test accounts still to come)
