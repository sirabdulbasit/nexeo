# The three roles: Operator, Assistant, Advisor (T49), and scheduled jobs (T50)

The one document for how Nexeo and Suzi are held to the founder's three roles: what each role means, what is built on
each side, how each is proven, and what is not built or never verified. Anything about the roles, the advisor, the
situation picture, the scorecard or scheduled jobs is written here in the same commit. The assistant step's own detail
stays in `Assistant_Step.md`; the screen operator's in `Computer_Operator.md`.

Last updated: 27 Nov 2026, by the Nexeo-Builder session (the only Nexeo-side session since 27 Nov).

## 1. The founder's rulings

26 Nov 2026 (relayed by Suzi-Builder):

> "Suzi will only be able to think correctly if it has Knowledge, Actionable Items, Rules, Delegations, Past Decisions,
> Instructions: Nexeo Wiki."
>
> "Suzi/Nexeo should know everything: what is new, what has been done/sent and what should be done. Suzi/Nexeo is not
> only a robotic operator, it is my living assistant and advisor as well."

27 Nov 2026 (this session):

> "how you make sure that Suzi will work like 1. Operator (to perform all task) 2. Assistant (to keep remember what
> should I do and what should not and what is important to me) 3. Advisor: it will also advise how to do, like with
> email, tasks, and based on historical data any improvements in process, mechanism that I should adopt or propose to
> management"
>
> "both Suzi & Nexeo agree on it and build what is necessary at both end"
>
> "Nexeo/Suzi will also keep remember schedule jobs if instructed" … "and build how Suzi/Nexeo will performed schedule
> jobs"

Agreed with Suzi-Builder (Mac) on the link the same morning: **T49** (AGREE 10:30 PKT, four conditions) and **T50**
(AGREE 10:35 PKT, three conditions). The record is in `NEXEO_SUZI_AGREEMENT.md`.

**The safety line is unchanged (his send rule):** what stays inside happens by itself; anything that reaches other
people, or closes or changes his task, is proposed and happens on his one click.

## 2. How each role is made sure of

The same four things for every role:

1. **A definition** (the table below).
2. **Automatic tests** that fail when the role breaks (named per row in §4).
3. **A number counted every week** from the records, never judged: the scorecard (§3.5).
4. **Agreement with Suzi** before any contract change, on the link.

| Role | It means | Nexeo's part | Suzi's part |
|---|---|---|---|
| **Operator** | does the work end to end | the actions (`/v1/act`): send, delegate, follow up, calendar, tasks, rules; one send gate; every act logged; scheduled jobs that need no screen; the screen operator's control (`Computer_Operator.md`) | the hands on the Mac; the click and signature; scheduled jobs that need his computer |
| **Assistant** | remembers what to do, what never to do, and what matters to him | rules, standing instructions, delegations, past decisions, the assistant step over every email (`Assistant_Step.md`), the situation picture, his goals | keeps his rules in her AI's instructions through every reset; shows the boards; asks his goals once |
| **Advisor** | says how, and what to change in the way he works or to propose to management | advice (at most 3) in the situation picture; the weekly review; the track record of his answers | her own findings worked out on the Mac; one line in the brief, never a lecture |

## 3. What is built on Nexeo's side

### 3.1 Past decisions and delegations (D-327, live 27 Nov 10:53 PKT)

- `pack.decisions[]`, newest 50: `{at, kind, by: "him" | "suzi" | "nexeo", about, what, why?}`. Read from his acts
  through Suzi (`suzi_act_log`, ok only; a held send is not a decision), emails a rule forwarded, and tasks the assistant
  step made. Kinds: `done, moved, cancelled, reopened, not_yet, taken_back, helper_added, helper_removed, delegated,
  task_created, followed_up, replied, ignored, handled, rule_set, rule_removed, instruction_added, instruction_removed,
  delegation_set, delegation_removed, booked, meeting_changed, meeting_cancelled, proposal_done, proposal_dismissed,
  rule_delegated, advice_feedback`.
- His Wiki page "Past decisions" (`Wiki-Knowledge.md` §0.33).
- `rules.delegations[]` with `person`, `source` ("company" or "rule"), and for his own rules `match` and `rule_id`
  (`Rules.md` §10).
- Code: `services/suzi/decisions.ts`, `suziRules.ts`. Test: `d327DecisionsDelegations`.

### 3.2 The situation picture (D-328; T48)

`pack.situation`, built from the parts the pack already read (`services/suzi/situation.ts`, pure; test
`d328Situation`):

| Part | What | How |
|---|---|---|
| `new` | new to him since his last look, newest first, at most 20 | after the newest `seen.update {at}` (Suzi sends it when he opens a board or hears the brief); with none on record, the last day. Emails needing him, FYI, replies and changes on tasks by others, meeting records ready, suggestions, job results |
| `done` | today and yesterday, whoever did it, at most 30 | from `decisions[]`, with `by` and `to` |
| `to_do` | ranked, at most 12, each with `why`, `ref`, `risk?`, `goal?` | one scale: his overdue task 100 + days late; a reply he owes 90 (critical) or 60, + days waiting; his task due today 80; someone else's overdue task 70 + days late; due tomorrow 50; no deadline 20; +15 when it serves a goal |
| `advice` | at most 3, each `{id, what, why, rests_on[], goal?}` | written by the advisor step (§3.3) |

`new`, `done` and `to_do` are computed: every word comes from a record. Only `advice` is judged by a model.

### 3.3 The advisor (D-328 advice and feedback; D-329 review and scorecard)

Code: `services/suzi/advisor.ts`. Test: `d329Advisor`. Everything is kept in his Wiki as `learned` notes.

- **Advice.** Every 15 minutes the job looks; it writes new advice only when the last is older than 3 hours and what it
  reads has changed (or it is a day old). It reads his ranked to-do list, his last 40 decisions, his rules and standing
  instructions, his goals, and what he marked not useful. The model may cite only the references it was shown
  (`task:<id>`, `email:<thread>`, a decision, a rule); anything else is dropped. Note: "Advisor: current advice".
- **Feedback (B2).** `advice.feedback {id, verdict: "useful" | "not_useful" | "done", what?}`, internal, no signature.
  It works for advice, review items, and Suzi's own findings (`suzi:<hash>`, then `what` is required). The newest
  verdict on an id counts. An answered item leaves the pack; what he marked not useful is given to the model as "never
  again". Note: "Advisor: track record".
- **Weekly review (B1).** From Monday 07:00 PKT, once a week (and once at the first run). Counted facts over 90 days:
  tasks by person (open, overdue, no deadline, finished, oldest), his own tasks and how often deadlines moved, what he
  asked others for by email that is still open after a week, whom he delegates to by hand again and again, his
  decisions by kind, emails waiting 3 days or more, meeting records with action items waiting or with no record. The
  model picks at most 5 items: `{id, kind: habit | process | management | relationship, what, why, suggest, rests_on[],
  note_for_management?, goal?}`. Every item has a `suggest` (one action and an owner) and cites facts. A draft for
  management exists only on a `management` item and is **never sent or saved to Gmail by itself**. `pack.review`
  carries the newest review for 8 days. Note: "Weekly review, <Monday>".
- **Goals (B3).** His words, kept by Suzi as the profile note `goals` (`profile.update`). The advisor says which goal
  an item serves, word for word; a goal he did not give is dropped.
- **Scorecard (B3).** `pack.scorecard {this_week, last_week}` and the note "Scorecard, week of <Monday>". Counted from
  the records: Operator (actions done, failed, held by reason; screen runs done, unverified, failed), Assistant
  (suggestions made, accepted, dismissed; tasks made from his own mail), Advisor (advice given; useful, done, not
  useful), and scheduled jobs. **A held act is counted held, never ok; an unverified run is never done.**

### 3.4 Scheduled jobs (D-330; T50)

Code: `services/suzi/scheduledJobs.ts`, `knowledge/instructionSchedule.ts`, `knowledge/instructionService.ts`,
`suziDelegations.ts`. Tests: `t50ScheduledJobs`, `t50InstructionOps`.

- **A job is a standing instruction with a schedule**, on its own Wiki instruction page. `schedule` is
  `{every: day | week | month, on?, at?}` or `{once: "<ISO date-time>"}` ("remind me at 4 to call Ali").
- **Where it runs:** `runs_on: "nexeo" | "mac"`.
  - `nexeo`: anything over his data (reports, reminders to him, checks). The server runs it in his time zone whether
    or not the Mac is on.
  - `mac`: anything that needs his computer. Suzi runs it and reports `operator.report {job: "scheduled"}`.
  - Suzi may send it. When missing, Nexeo decides once from the words; clear computer words give `mac` without a model.
    A schedule set before T50 stays a Mac job.
- **Running.** A job every minute (`scheduled_jobs` in `server.ts`). One run per due slot is guaranteed by a claim on
  the job's own page (one conditional UPDATE), so a restart or a second runner cannot run a slot twice. A failed run
  is retried once. A Nexeo slot found 6 hours late, and a Mac job with no report after 2 hours, are recorded `missed`.
  A one-off leaves `jobs[]` after its run.
- **The run itself:** one model call with the job's words and his facts (open tasks, today's meetings, emails needing
  a reply). The result is a summary of at most 600 characters; longer text goes to a Wiki `document` note.
- **The send rule holds.** A job that ends in a message to someone makes a draft and a ready-to-send card; the run is
  `waiting_click`. `send: "auto"` is recorded only on his explicit words (`said`) and confirmed back, **but is still
  held today**: no authorised by-rule send path is switched on (F-2.4 is held).
- **Every run is recorded** on the job's page, newest 20: `{due_at, ran_at, by, status: done | failed | missed |
  waiting_click, summary, ref?}`.
- **Pack:** `jobs[]` `{id, text, schedule, runs_on, send, said?, paused, next_at?, last?}`; a Nexeo result is also in
  `situation.new` as `job_result`. `rules.standing[]` carries `runs_on` on a scheduled instruction.
- **Control:** `instruction.update {id, schedule | runs_on | paused | send}` (one per call), `instruction.remove`,
  and `job.run_now {id}` (internal).
- **Reaching him at once:** the result is pushed to his live Suzi as a silent notice card. A dedicated `job.result`
  frame needs a gateway route and is not built.

### 3.5 What the scorecard read on 27 Nov, before any of this ran

Week of 23 Nov so far: 26 actions done, 1 failed, 9 held; 6 suggestions made, 3 accepted, 1 dismissed; 0 screen runs;
no advice given yet. Week of 16 Nov: 43 done, 4 failed, 4 held.

## 4. Proof per role

| Role | Automatic tests | Counted weekly | Live proof so far |
|---|---|---|---|
| Operator | `clickConfirm`, `suziSignedSend`, `holdReasonOrganizer`, `t50ScheduledJobs`, `t50InstructionOps`, `d325EscalateOnce` | actions done / failed / held; screen runs; jobs done / failed / missed | a signed click send, 25 Nov 13:15 PKT. **Screen runs: 0 ever. Scheduled runs: 0 ever.** |
| Assistant | `t47AssistantStep`, `t47Proposals`, `t47PackLevel`, `d324DescribePastDate`, `d326FyiFacts`, `d327DecisionsDelegations`, `d328Situation` | suggestions made / accepted / dismissed; tasks from his mail | 3 Do it and 1 Dismiss by him, 26 Nov 09:52 PKT; decisions and delegations in his live pack, 27 Nov 10:56 |
| Advisor | `d329Advisor` | advice given; useful / done / not useful | see §6 |

## 5. Not built yet

1. The four open founder answers for the screen operator (`Computer_Operator.md` §8): machine, screenshots yes, relay
   builder, images yes.
2. `send: "auto"` for a job actually sending (needs the by-rule send path, held with F-2.4).
3. A `job.result` frame in the gateway; "told once in the brief" for a failed or missed job.
4. Mac reports carry no job id, so one report in the window counts for every Mac job due in it (a contract change).
5. Company-wide scheduled instructions are not run; only his own.
6. Business numbers for the advisor: finance, pipeline and project systems are not connected (integrations work).
7. Calendar load is not among the review's facts; tomorrow's calendar is not among a job's facts.
8. The rest of `Assistant_Step.md` §6: invite proposals, lead proposals, learning across people, open loops, WhatsApp
   and meetings as inputs.
9. The founder's decision on CL-092 (watched tasks in `actions[]` or not).

## 6. Never verified

Written honestly at each deploy; see the evaluation chart rows D-324 to D-330 for what was read live and what was not.
