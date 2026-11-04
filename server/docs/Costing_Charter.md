# Costing Charter: Nexeo and Suzi

**Version 1.0, 4 Nov 2026.** Agreed by Nexeo and Suzi. **Waiting on the founder's approval: no cost work starts before it.** Both sides hold this same file. Figures are estimates until real turns are measured.

**Changing this charter:** Suzi and Nexeo agree between themselves, each keeping its own part optimal, and send the founder ONE joint summary for approval. Every message carries its date and time with seconds (PKT). What each side does is in `Functional_Charter.md`.

## The goal

**Quality is fixed, and cost goes as low as that allows.** $20 a month per user (about $0.66 a day), across Nexeo, Suzi's server and the desktop app, is the target we report against. It can never force quality down. If it can't be met at full quality, the founder gets the real number and his options.

## The quality rule

Removing waste needs no trade. Anything cheaper ships only if a test shows it is no worse than today:

- A cheaper model passes only if it matches Pro at least as well as Pro matches itself on real inputs.
- Urdu is judged by the founder listening.
- Test results come back to the founder before anything switches.

**Never on Flash, whatever a test shows:** anything that drafts or sends for the user, decisions about tasks, rules or approvals, multi-step screen tasks, knowledge questions.

**Stays as it is:** the voice stays Chirp 3 HD. Triage stays on Pro (Flash matched Pro on the action 17 of 30 times, against Pro's own 23 of 30).

## The numbers

| Per day, estimates | Nexeo | Suzi's server | Desktop app | Per month |
|---|---|---|---|---|
| Today, about 21 turns a day | ~$0.50 | $0.20–0.40 | ~$0.22 | $27–35 |
| 40 turns a day, Pro everywhere | ~$0.50 | $0.30–0.60 | $0.16–0.22 | $27–41 |
| 40 turns a day, Flash only where proven equal | ~$0.25–0.35 | ~$0.27 | $0.16 | ~$20–27 |
| **Proposed share of the $20, per month** | **$7.50** | **$7.50** | **$5** (ceiling $5.50 until measured) | **$20** |

- Cost per turn on Pro: about $0.01–0.02. At 100 turns a day, Pro alone would be $30–60 a month on Suzi's server.
- Local answers on the desktop app: about 10% of turns today, 20–30% once more are added and Suzi is used daily.
- Desktop app today: voice about 7,000 characters a day at $30 per million, ~$0.21; hearing under $0.01; meeting notes ~$0.07 per meeting hour; everything else local, $0. Windows is measured separately before we count on it.

## For the founder's approval

1. **Restores quality, first:** re-judge an email at once when something important changes. Earlier savings can leave a score up to a day old and a triage decision up to 7 days old. Built and tested, not live: `server/docs/parked/opt-012-refresh-on-change.patch` (Nexeo repo). Costs slightly more. *Can be approved now, on its own.*
2. **See the costs:** the consumption record below; record Brain's unrecorded reply path; model name in the token log; `app=suzi-desktop` + `os` labels (the founder passes this to the 3dAI builder).
3. **Savings with no quality loss:** more answers from the day pack on the desktop app ("what's my day", "next meeting", "today's meetings", "how many overdue", "who emailed me"); a same-voice audio cache; long lists on the board with a short spoken summary; voice stops at once when interrupted; wiki facts instead of Brain's 60,000–100,000-token reply path.
4. **Tests on a dedicated test user, a few dollars in total:**
   - Suzi's server, Pro vs Flash, one kind at a time, on 30–50 real utterances with the 27 tools: greetings and small talk; reading back known facts; simple single-tool requests; device controls. A kind that fails stays on Pro.
   - Nexeo: skipping Pro on bulk mail that rules already identify; small knowledge jobs on Flash; trimming old turns from the context.
   - Caching: no saving is counted until measured on real turns.

## For the founder to decide

5. **What counts toward $20?** Recommended: all usage costs on all three parts (models, voice, hearing, images), not hosting or fixed infrastructure.
6. **At the limit?** Recommended: a warning at 80%; at 100% we tell him and keep the same quality, and he decides whether to raise the target. No automatic downgrade.
7. **Design usage?** Recommended: 40 turns a day on average, 100 at peak.

## The consumption record

Nexeo keeps the one record, every day, for Nexeo and Suzi, viewable by service, user, day or date range. Built only after the founder approves.

- **Suzi's server** reports each model round from the provider's own counts: user, tenant, device, turn id, model, prompt, cached, output and thinking tokens, time.
- **The desktop app** sends a daily batch through its server: `POST {gateway}/v1/usage {day, os, app_version, idempotency_key, items:[{service, units, unit}]}`. Safe to resend. Up to 7 days late; a month closes on day 7 of the next month; older batches stay on the machine.
- **Services.** Paid: `voice_characters`, `hearing_seconds` (about 32 tokens per second), `meeting_audio_seconds`, `meeting_writing_characters`. Free, counted for completeness: `voice_characters_fallback`, `local_hearing_seconds`, `local_screen_operator_steps`. Activity: `turns_spoken`, `turns_typed`, `turns_app_started`, `local_answers`, `tool_steps`, `screenshots_sent`.
- **Nexeo** holds one price table and works out the cost; each row is marked measured or estimated. The day boundary is the user's own time zone.
- **Never in the record:** speech, transcripts, prompts or any content. Only counts.
- **Views:** admin screen and export; a user's figures are visible only to admins.
- **The check:** each month Nexeo compares the record with Google's bill and reports the gap. Costs nobody reports, such as the 3dAI character builder, show up there. On the bill, Chirp 3 HD is the desktop app's voice and Neural2 is Nexeo's WhatsApp voice notes.

## Already live, before this charter

Nexeo: nightly build stopped; billed prices and `app=nexeo` labels; one triage call per email; scoring at most once a day per email; planner prompt 87% smaller; WhatsApp-down message written once per window; Mind State once a day. Suzi's server: `app=suzi` labels and token logging; per-turn lines moved out of the system prompt; long laptop results capped. Suzi's side also has T2 on outward clicks and handling of `emails_loading` and `missing`.

## Suggested to the founder

Give the 3dAI character builder its own Google project or key, so the Nexeo and Suzi bills stay clean (the $0.94 of Gemini 3.1 Flash Image came from it).
