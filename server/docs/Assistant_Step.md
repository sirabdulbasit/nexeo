# The assistant step (T47)

The one document for Nexeo's assistant step: the founder's ruling, what it does, the contract with Suzi, the code map,
what is live, what waits, and how to continue. Anything about the assistant step (code, contract, deploy, a founder
decision, a finding) is written here in the same commit.

Last updated: 26 Nov 2026, by the Nexeo-Builder session that owns T47.

## 1. The founder's ruling

25 Nov 2026, after being shown three separate rules (meeting agreed but no invite, an email he sent about a task, an
update he sent on a task):

> "Nexeo should be enough intelligent to handle the things not to explain each and everythings — it should think/act
> like real assistant." Then: "go ahead".

So there is **one reasoning step** over every message, not a hand-written rule per case. The model reads each message with
his context and decides what a good assistant would do, choosing from a fixed set of steps.

**The safety line (his send rule):** internal steps happen by themselves. Anything that reaches other people, or closes
or changes his task, is only **proposed**, and happens on his one click.

## 2. What it does today

Every 15 minutes (job `assistant_step` in `server/src/server.ts`, first run 20 min after boot), for each user with an
active Google connection:

1. Takes each email, in or out, from the last **14 days** that it has not read yet (`wiki_sources`, kind `email`,
   `details.assistantRead` false), at most 40 per run.
2. Gives the model the email plus his 80 most recently updated open tasks (id, title, who, due).
3. Applies the steps the model returns, checked against the allowed list and the real task ids:

| Step | What happens | By itself? |
|---|---|---|
| `link` | history entry on the task (`metadata.suziTrail`), with the email and its direction | yes |
| `followup` | his sent email to the task's person counts as a follow-up (`metadata.lastFollowupAt`) | yes, sent mail only |
| `task` | his own promise becomes his task; what he asked of someone becomes a watched task (`metadata.watch`) | yes, sent mail only, only when no open task covers it |
| `propose` | done / new due date / new lead, stored on the task (`metadata.proposals`) | **no: shown for one click** |

Incoming asks are not made into tasks here: triage already does that.

**Proposals** (`server/src/services/suzi/proposals.ts`):
- One per task + change + value, so two emails saying "done" make one card.
- `why` names who, the date and the subject, plus the quote. Example: *"TMC Support Portal IT Support wrote on 12 Nov
  'The task has been completed.' (RE: (#4414262) Google …)"*.
- Shown: `done` and `due` only, open tasks only, newest first, at most 3 per task.
- On his own tasks they appear in `actions[].proposals`. On tasks he is watching (not in `actions[]`, CL-092) they appear
  in the pack-level `pack.proposals[]` (at most 10), each with `task {id, title, watching, watching_name?}`.
  `watching_name` comes from his people, or a name the watch already holds; it is never guessed from an address.

## 3. Contract with Suzi (agreed)

Suzi-Builder (Mac) AGREE 25 Nov 14:28 PKT, with six conditions. All six are built:

1. `why` names the evidence: who, subject, date.
2. **Do it** = send `op` with `args` exactly as given, signed, with `confirmed_by: "click"`. `args` carries `proposal_id`.
   - A replay changes nothing and answers the task as it is.
   - A task that changed since (closed, already on that date, or the proposal was dismissed) answers
     `{ok: false, error: "proposal_stale"}`.
   - Once done, the proposal is closed and leaves the pack.
3. The `calendar.create` preview (title, time, attendees) before Do it. **Not built yet: no invite proposals exist.**
4. **Dismiss** = `proposal.dismiss {id}`. Internal, no signature. The same change on that task is never proposed again.
5. Proposals are cards only; Suzi never speaks them unless he is talking with her. One brief line. **The brief line is not
   built yet.**
6. At most 3 open proposals per action, newest first.

Shape of one proposal:

```json
{"id": "3f9c0a1b2c3d4e5f", "op": "task.update",
 "args": {"id": "<task id>", "update": "done", "proposal_id": "3f9c0a1b2c3d4e5f"},
 "why": "Sofia Rana wrote on 24 Nov \"done, sent the deck\" (Re: Q4 deck)",
 "from": {"email_id": "<gmail message id>", "direction": "in"}}
```

A `due` proposal has `"update": "move", "due": "YYYY-MM-DD"`. A pack-level proposal adds
`"task": {"id", "title", "watching", "watching_name"?}`.

## 4. Code map

| File | What it holds |
|---|---|
| `server/src/services/suzi/assistantReasoner.ts` | the step: prompt (`SYSTEM`), `parseSteps` (allowed steps only), `taskKey`, `runAssistantStep` |
| `server/src/services/suzi/proposals.ts` | `evidenceWhy`, `packProposals`, `packLevelProposals`, `checkProposal`, `dismissProposal`, `markDone` |
| `server/src/services/suzi/suziActions.ts` | `proposalsOf` adds `proposals` to each action |
| `server/src/services/suzi/dayPack.ts` | `pack.proposals[]` for watched tasks |
| `server/src/services/suzi/suziAct.ts` | `proposal.dismiss`; `task.update` with `proposal_id` (stale/replay check, close after) |
| `server/src/server.ts` | the `assistant_step` job |
| Tests | `t47AssistantStep`, `t47Proposals`, `t47PackLevel` |

The model call is `gemini-flash` first, then `gemini` (`purpose: 'assistant_step'`), at most 700 tokens. That is one call
per new email, about 100 a day for the founder.

## 5. Deploys

| Deploy | What | State |
|---|---|---|
| D-317 (25 Nov 14:39 PKT) | the step; replaced D-314 (`sentCommitments`, sent mail → tasks only) | live. First run by hand: 40 emails read, 17 steps; history on the right tasks |
| D-322 (15:44) | proposals in `actions[]`, Do it with `proposal_id`, `proposal.dismiss` | live |
| D-323 (16:02) | `pack.proposals[]` for watched tasks | live. **Verified:** Suzi showed "Suggestions (2)" at 16:04 |
| D-323b (16:14) | `watching_name` | live |

Every row, with evidence, is in `brain_evaluation_chart.md`.

**Number clash:** the Integration session also used "D-322" for DEF-517 (Wiki contract §0.32). Check the chart's newest
row in HEAD right before taking a D-number.

## 6. Not built yet, in order

1. **Founder decision pending:** show watched tasks in `actions[]` (Suzi-Builder's ask, reversing CL-092), or keep
   CL-092. The recommendation is to keep it: proposals on watched tasks already reach him through `pack.proposals[]`.
2. **Invites:** a meeting agreed in email with no calendar event → a `calendar.create` proposal in `pack.proposals[]`.
   Add `calendar.create` to `CLICK_CONFIRM_OPS` in `suziAct.ts`, signed. The model needs his calendar for the next
   14 days in its context.
3. **The brief line** "N suggestions on your tasks".
4. **`lead` proposals shown:** they are stored, but need the person's id (resolve the name or email against his people).
5. **Learning across people:** the same kind of proposal for the same person comes less often after dismissals. Today
   only per-task dismissal is learnt.
6. **Closing the watch on Do it = done:** a closed task is no longer chased, because the follow-ups read only open tasks.
   Clear `metadata.watch` explicitly too, and confirm this against the reminder code.
7. **Open loops** (folded into T47 from the other session's proposal): `open_loops[]` {they_asked, he_promised,
   he_asked, gone_quiet}, computed from whole threads both ways.
8. **More inputs:** WhatsApp messages and meeting records through the same step.

## 7. Never verified

- No real **Do it** or **Dismiss** from Suzi yet. Ask Suzi-Builder for the time of the first one and check it in the act
  log.
- The scheduled job's own runs (as opposed to the run by hand) have not been read back. Check the log for
  `[assistantStep]` lines.
- No measurement of wrong links or wrong proposals yet: read a day of history entries and proposals and count the
  mistakes.

## 8. Who owns what

Two Nexeo-Builder sessions agreed this split on 25 Nov:
- **This session: T47** (the step, proposals, open loops, invites).
- **The other session:** task context, meeting record fields, minutes auto-send, WhatsApp, and Sofia Rana's "no working
  route".

Suzi-Builder (Mac) talks to Nexeo through `sirabdulbasit/suzi-nexeo-link` (`inbox/`, files `*-nexeo.md` and
`*-suzi.md`). Every D-number goes there with its time.

## 9. The three roles (27 Nov 2026)

The founder's three roles (Operator, Assistant, Advisor), the situation picture, the advisor, the scorecard and
scheduled jobs are in **`Three_Roles.md`**. Read it with this file. Changes to this file's sections since 26 Nov:

- §7 "No real Do it or Dismiss": **verified.** On 26 Nov 09:52 PKT he pressed Do it on three suggestions and Dismiss on
  one, and all four were applied (seen in the act log and in `decisions[]`).
- §6 item 3 "the brief line": taken over by `situation` (D-328), which carries suggestions under `new`.
- D-324 (27 Nov): a due-date suggestion before today is never stored, shown or done; a meeting's own date is not a
  deadline (DEF-518).
- §8: the other Nexeo-Builder session has ended. This session holds all of the Nexeo side.
