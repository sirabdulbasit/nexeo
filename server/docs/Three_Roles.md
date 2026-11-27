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
  `{every: day | weekday | week | month, on?, at?}` or `{once: "<ISO date-time>"}` ("remind me at 4 to call Ali").
  `weekday` is Monday to Friday; `on` for a week is `mon`..`sun` (a full day name is read as its three letters), for a
  month 1..28 (D-331).
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

### 3.4a Advice on the item he opens (D-332; T51)

Founder, 27 Nov 11:35 PKT: "when anything open to me like emails, tasks Suzi/Nexeo should also suggest what to do? and
how to do. before suggesting Suzi/Nexeo should have complete related knowledge (Nexeo wiki)". Agreed with Suzi-Builder
11:44 PKT, four conditions. Code: `services/suzi/itemAdvice.ts`. Test: `d332ItemAdvice`.

- **`item.advise {kind: "email" | "task", id}`**, internal; it changes nothing.
- **Knowledge first.** Before a word is written, Nexeo gathers: the whole thread, both directions (or the task with its
  history, without Nexeo's own bookkeeping notes, and its source email); the Wiki notes on the people and the company;
  notes found by the subject; his other open tasks with the same people or thread; how he decided before on them; his
  rules, standing instructions and delegations; his goals. Each piece gets a reference.
- **The answer:** `{id, about, what, how[≤4], suggest?, rests_on[], knowledge[≤6], missing[], complete, made_at}`.
  - Only references that were shown are kept; advice without one is not given.
  - `missing` says what was not on record (an unknown sender, an unreadable email), and then `complete` is false and
    the advice is the careful step, never a guess.
  - `suggest` is one button for an op Suzi already has, with real ids: `email.draft`, `email.delegate`, `email.mark`,
    `task.create`, `task.followup`, `task.update` (done, move, assign). His click runs it, signed where needed.
  - Steps are in his words: no tool names, no references inside the sentences, never "ask Nexeo".
- **Speed (condition 1).** A copy younger than 45 minutes is answered at once. Every 15 minutes, and 3 minutes after
  each start, Nexeo prepares advice for the emails needing him and the top of his to-do list (at most 22 items); an
  unchanged item costs a read and no model call. The copy is kept in memory.
- **Cost (condition 4).** `scorecard.advisor.cost {week_usd, month_usd, month_pkr}` from the spend record (rupees at
  `USD_PKR`, 280 when unset, an estimate). Measured 27 Nov: about USD 0.0013 per item. Over PKR 1,000 a month goes to
  him first (Costing Charter).
- Feedback: `advice.feedback` with the advice's `item:<hash>` id; counted under the advisor.

### 3.4b The outlook: Nexeo keeps thinking (D-333; T52)

Founder, 27 Nov 11:45 PKT: "suzi/nexeo keep thinking as per knowledge what to do, and what is important, what is
pending, what are possible risk now and in future, forecasting, predicting etc". Agreed with Suzi-Builder 11:44 PKT,
four conditions. Code: `services/suzi/outlook.ts`. Test: `d333Outlook`. Kept as the `learned` note "Advisor: outlook".

`pack.outlook`, at most 5 per list, rewritten with the advisor step (at most every 3 hours, only when what it reads
changed, or once a day):

| List | What | How |
|---|---|---|
| `important` | the top of his to-do ranking, with why and goal | computed (the same ranking as `situation.to_do`) |
| `pending` | what waits, `with` whom and `since` when, oldest first | computed: tasks he gave, things he asked for by email, replies he owes |
| `risks_now` | what is already going wrong, with `prevent` | the model, citing counted signals |
| `risks_ahead` | **predictions**: `{what, by, likelihood: likely / possible, why, rests_on[], prevent, ref?}` | the model, citing counted signals |
| `forecast` | the load ahead, by `period` | the model, citing counted signals |

- **Counted signals** are the only thing a risk or forecast may rest on: each open task due within 14 days (who has it,
  days to or past its date, how often its deadline moved, and how late that person's finished tasks closed on
  average); how many tasks were finished a week over 8 weeks against what is due; things he asked for that are still
  open after 5 days; emails waiting 2 days or more; scheduled jobs that failed or were missed twice. `rests_on`
  carries the signal's own words.
- **A prediction is never a fact** (condition 1): it needs a likelihood, a date after today within 45 days, and a
  signal. Without any one of them the line is dropped. `prevent` is one action with an owner (condition 2).
- **Checked when its date passes** (condition 3), against the record: `came_true` when the task was still open (or
  closed after the date), or the email still unanswered; `prevented` only when it did not happen **and** he acted on
  that item in between; otherwise `did_not`. A prediction about no single item is not checked. The scorecard carries
  `predictions {made, came_true, did_not, prevented, open}`.
- `risks_ahead` is ordered most likely and soonest first. Raising at most one new risk a day unasked is Suzi's part
  (condition 4).
- Feedback: `advice.feedback` with any outlook line's id; an answered line leaves the pack.

### 3.4c The chase: ask the task's person, tell him only when it is off track (D-334; T53)

Founder, 27 Nov 16:12 PKT, after Suzi asked him about a task Muhammad Yousuf leads: "Why Suzi asked me about the task
which is delegated to other? It should ask the person directly one day before deadline ending, and if the task is on
right direction then fine, otherwise update me or suggest me to do meeting etc." Agreed with Suzi-Builder as T53
(16:25 / 16:26). Code: `server/src/services/suzi/chase.ts`; test `tests/t53Chase.test.ts`.

- **The switch** is one standing instruction of his (its Wiki page carries `metadata.chase`). Paused or archived: no
  chase. `setChaseRule` records it once.
- **When:** 09:00 to 18:00 PKT, Monday to Friday, on the last working day before the deadline (a task due Saturday,
  Sunday or Monday is asked on Friday). Never on or after the due day. Checked in the 15-minute thinking run.
- **Whom:** the Lead and every helper with an email, never him. Watched tasks are not included.
- **Not when:** he followed up in the last 2 days, one of its people wrote on it in the last 2 days, or it has no
  deadline. Once per task per deadline (one conditional write claims it); a moved deadline is asked once more.
- **The send:** the follow-up note (model-worded from the task's facts, his Settings signature), through the one send
  gate as `gate.standing: "chase"`, with the 10 s hold. A refused gate records `not_sent` with the reason and tries
  again on the next run.
- **The answer:** the person's reply on the follow-up's thread, or an email the assistant step linked to the task, is
  read by the model: on track or not, their own words (`said`, which must be in the reply), a new date if they give
  one. Unclear or unreadable counts as off track.
  - On track: a history line "On track". He is not told.
  - Off track: `chase.answer: "off_track"`, `suggest: "move"` with a stored proposal (Do it = move to their date) when
    they gave a date, else `suggest: "meet"` (Suzi finds the slot).
  - No answer by the deadline: `no_reply`, `suggest: "meet"`, a history line "No answer from <name>".
- **What Suzi gets:** `actions[].chase {asked_at, due, to[], answer, by?, said?, new_due?, suggest?, reason?,
  answered_at?}`; `situation.new` kind `chase` (off track and no answer only); `decisions[]` "Followed up by rule: one
  day before the deadline"; `scorecard.assistant.chases {sent, on_track, off_track, no_reply}`.
- **Never by itself:** moving the deadline, booking the meeting, reassigning. Those stay his click.

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
4. ~~Mac reports carry no job id.~~ **Built, D-331:** `operator.report` takes an optional `job_id`; a report that
   names its job counts only for that job. Suzi adds the field on her side.
5. Company-wide scheduled instructions are not run; only his own.
6. Business numbers for the advisor: finance, pipeline and project systems are not connected (integrations work).
7. Calendar load is not among the review's facts; tomorrow's calendar is not among a job's facts.
8. The rest of `Assistant_Step.md` §6: invite proposals, lead proposals, learning across people, open loops, WhatsApp
   and meetings as inputs.
9. The founder's decision on CL-092 (watched tasks in `actions[]` or not).

## 6. Never verified

State on 27 Nov 2026, 12:25 PKT (D-324 to D-333b all live; chart rows of the same names):

- **On-open advice (D-332):** `item.advise` has not been called by Suzi yet; no click on a suggested button; only two
  pieces of advice were read by a person. The kept copy is lost on a restart and rebuilt 3 minutes later.
- **Outlook (D-333):** no prediction has been checked (none is due). Four predictions are on record, two of them from
  the first trial run (dated 11 Dec, before the dating rule was tightened). One forecast line added its people up
  wrongly. The scheduled run of the step has not been read.
- Everything below, from 11:15 PKT, still stands:


- **No scheduled job has ever run**, on Nexeo or the Mac. He has none on Nexeo yet. The claim (one run per due time)
  was proven on Postgres against a session-only copy and in tests, never with his job.
- `seen.update`, `advice.feedback`, `job.run_now` and `task.update describe` have not been sent by Suzi yet.
- The push of a job result to his live Suzi.
- **Whether the advice is right.** The first run gave 2 pieces of advice and a 5-item review. Each cites real facts,
  but the wording is the model's: one line says he "marked the invoice as paid", which was not checked against the
  record. Read a week of advice with him and count the wrong ones; the track record (`advice.feedback`) is the measure.
- The scheduled runs of the advisor and of the jobs runner (only the runs by hand were read). Look for `[advisor]`,
  `[decisionsPage]` and `[scheduledJobs]` lines in the server log.
- Goals: none set, so no item carries a goal yet.
- D-325: that the Vision Metrics task gets no eleventh "can't reach Sofia Rana" note (the tenth was 26 Nov 13:55 PKT;
  read `metadata.actionLifecycle.followUpHistory` of task `cmwj33pjz001srt5difi81mgy` after 14:00 PKT on 27 Nov).
- A knowledge search finding the "Past decisions" page.
- Known small fault: a review fact reads "1 emails".

## 7. How to continue

1. Read the link (`/root/suzi-nexeo-link/inbox`) for Suzi-Builder's times: his first scheduled job, his first card
   opened with advice, his first click on a suggested button. Read each in `suzi_act_log` (`item.advise`,
   `advice.feedback`) and on the job's page (`wiki_pages.metadata->'job'->'runs'`). Settled with Suzi-Builder 27 Nov:
   the notice card for job results is enough; `job_id` on reports is built (D-331).
2. Do the D-325 check above.
3. With the founder: his goals (Suzi's card), then a week of advice read together.
4. §5, in order.
