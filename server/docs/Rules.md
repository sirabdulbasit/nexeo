# Rules — how the My Rules page works

> **Living document.** Every change to the My Rules page, to any rule store, or to how Brain
> reads rules is written here **in the same commit** (owner ruling, 13 Nov 2026). The change
> log at the bottom gets one row per change.
>
> Page: `client/src/pages/MyRulesPage.jsx` · Route: My Rules (`?subtab=<tab id>` opens a tab)

## 1. What the page is

My Rules shows every way the user steers Brain, in one place: the instructions you've given,
what Brain has learned, the risk surface they drive, and every action Brain has taken.

There are seven tabs. Six always show; the seventh, Compose Hints, shows only while legacy hints exist.

| # | Tab (id) | Who writes it | Where it is stored | Does Brain act on it? |
|---|---|---|---|---|
| 1 | Standing Instructions (`standing`) | You, in plain English | `wiki_pages`, `page_type='instruction'` | Yes: read in every answer, triage and autonomous action |
| 2 | Learned Preferences (`overlay`) | Brain (from 👎) or you | user prompt overlay | Yes: added to every chat answer and draft |
| 3 | Patterns (`patterns`) | Brain (rule miner) | `shadow_rules` | Only in ACTIVE mode |
| 4 | Risk Radar (`risk-radar`) | System, admin, or you | risk rules | Raises flags on the daily Risk Radar |
| 5 | Decisions (`decisions`) | Log of every decision | `decision_logs` | No (audit log; it feeds Patterns) |
| 6 | Delegations (`delegations`) | Log of every delegation | `delegation_logs` | No (audit log; it feeds Patterns) |
| 7 | Compose Hints (`prompts`) | You (legacy) | brief prompts | Draft replies only; being phased out |

**Precedence, highest first:** Client standing instructions → your standing instructions →
learned preferences → ACTIVE patterns. Brain is told that client rules are company policy
and win over a conflicting personal rule.

---

## 2. Standing Instructions (the main tab)

**What it is:** the rules you have given Brain directly. You type one sentence; Brain turns
it into a structured rule and follows it from then on.

### 2.1 How a rule is created
1. You type a sentence, e.g. *"Always delegate Raazia's emails to Asad"*, and press **Tell Brain** (or Enter).
2. `POST /brain/instructions {text, scope}` → `createInstructionFromText`
   (`server/src/services/knowledge/instructionService.ts`).
3. A small model (`gemini-flash` → `gemini` → `claude`) turns the sentence into:
   **kind · title · subject · condition · action · dueAt**. It must never invent a time or
   subject. If the parse fails, the rule is still saved with kind `unknown`.
4. Saved as a Wiki page (`page_type='instruction'`). Your original sentence is kept word for
   word, so Brain can quote it back. The page is embedded for search, and the per-user cache
   is cleared so the next turn sees the rule at once.
5. A toast confirms it, e.g. *"Saved personal standing rule — Brain will respect this from now on"*.

### 2.2 The six kinds
| Kind | Means | Example |
|---|---|---|
| `standing_rule` | "Always do X" | Always delegate Raazia's emails to Asad |
| `watchpoint` | "Alert me if X happens" | Alert me if anyone mentions EXIM |
| `follow_up` | Person/topic + deadline | Follow up with Fahim if no reply by Thursday |
| `scheduled` | Runs on a schedule | Send me a weekly summary every Friday 5pm |
| `todo` | One-off task for you | Call Kate next Wednesday |
| `update_request` | "Tell me when X changes" | Update me when Project 846 hits UAT |

### 2.3 Scope: Client rule vs My rule
- **My rule** (`user`): applies only to you. This is the default.
- **Client rule** (`client`): applies to every user in the tenant. Only admins can create, pause or
  archive these. The scope switch appears only for admins, and for them it defaults to
  Client. Other users see client rules marked *admin-managed*.

### 2.4 Lifecycle
| Status | Effect | How |
|---|---|---|
| `active` | Brain follows it | Default on creation |
| `paused` | Brain remembers it but does not act on it | **Pause** / **Resume** |
| `fulfilled` | A one-off is done (e.g. a todo) | Set by Brain |
| `archived` | Removed from the list | **Archive** |

> **Found and fixed 13 Nov 2026 (DEF-458).** A rule is read only while its page status is
> `active` **and** its own `metadata.status` is `active`. The hourly wiki linter
> (`wikiLinterService.ts`) relabelled every page that has no links as `orphan`, and an
> instruction has no links. So every standing instruction stopped being read within an hour of
> being saved: Brain did not follow it and this tab showed "No standing instructions yet",
> although the user's own setting still said active. The linter now leaves alone any page that
> keeps its own lifecycle. **Restored on the owner's word, 13 Nov 2026, 13:30 PKT**
> (user 2, through `updateInstructionStatus`, so the cache was cleared):
> - **Active again, read by Brain (5):** Chase delegated tasks · Follow up on non-responders ·
>   Follow up on tasks · Communication tracking instructions · Differentiate communication channels.
> - **Paused by his decision (3):** "Don't ask for confirmation for tasks which I directly
>   instruct you" and "Don't ask for confirmation" (they conflict with his ruling of the same day
>   that a rule prepares and his yes acts), and the one-off to-do "Take care of it" (August, no subject).
> - The 4 instructions of user 3 (switched off since May) were left as they were.
> - Checked after the restore: `getActiveInstructions` returns 5 (was 0), and one full linter run
>   left all 8 pages `active`.
>
> **Paused rules are listed (DEF-460, live D-227, 13 Nov 2026 13:41 PKT).** `GET /brain/instructions` asks
> `getActiveInstructions(..., {includePaused: true})`, so a paused rule shows with its "paused" pill and
> **Resume**. Brain's own reads still take active rules only. Checked live: the tab receives his 5 active
> and 3 paused instructions. (Before this, a paused rule vanished from the page with no way back.)
>
> **A typed rule that is an email rule (DEF-457, live D-224).** When a standing instruction of his own is an
> incoming-email rule ("always ignore Demo VM alerts", "always delegate Raazia's emails to Asad"), it also
> becomes the email rule Suzi's list applies (`instructionEmailRules.ts` → `ruleSet`), linked by
> `payload.suzi.instruction_id`. The value must be in his words, and a person must resolve to exactly one of his
> people; otherwise it stays an instruction to Brain only. Pause or archive turns the email rule off, active
> turns it on (a second write today: see §11 proposal 1).

### 2.5 How Brain uses it
- **Every answer and draft:** `getActiveInstructions` loads up to 30 active rules (client rules
  first, then yours). `renderInstructionsBlock` adds them to the prompt as
  *"Standing instructions (non-negotiable)"*, with who wrote each rule and when (DEF-248). Three places use this block:
  the legacy composer, the reasoning composer and the voice context (`brainComposer.ts`,
  `brainVoiceContext.ts`).
- **Every incoming message:** `instructionMatcher.ts` checks rules of kind standing_rule,
  watchpoint, follow_up and update_request against each new message. A rule matches when its
  `subject` appears anywhere in the sender name, sender email, subject, snippet or body
  (case-insensitive). Matching aims to miss nothing, not to be exact: a match tags the item
  and Brain decides what to do with it.
- **Time-based kinds** (`scheduled`, `todo`) are fired by the cognitive engine
  (`brainCognitiveEngine.ts`), not the matcher.
- **Risk Radar** uses rules that fall due within 48 hours (the `imminence` signal).
- **Suzi** receives them in the `standing` list of the rules document (`suziRules.ts`; see §9).

---

## 3. Learned Preferences

**What it is:** one-line rules about *how* Brain should answer you, such as *"Keep answers
tight — 2–3 sentences for casual questions"*. They are added to every chat answer and draft.

- **Auto-created:** when 👎 feedback is diagnosed with the same problem **twice in 14 days**
  (`userPromptOverlayService.ts`), shown as 🤖 *Auto from 👎*.
- **Manual:** **+ Add rule** (6–240 characters), shown as ✍️ *Manual*.
- Controls: **Active/Inactive** toggle (an inactive rule is kept but not used), **Edit**,
  **Delete**, and **Reset all**, which deletes every learned preference so Brain learns again
  from new feedback.
- Each card shows how many turns used the rule.
- API: `GET/POST /brain/overlay`, `PATCH/DELETE /brain/overlay/:id`, `POST /brain/overlay/reset`.

---

## 4. Patterns (learned from your clicks)

**What it is:** rules Brain learns by watching your decisions in *My Attention*.

- The **rule miner** (`server/src/services/triage/ruleMiner.ts`) looks at the last 30 days of
  decisions and delegations, grouped by `dedup_hash` (the pattern's trigger key).
- **Modes:**
  | Mode | Threshold | Brain's behaviour |
  |---|---|---|
  | DRAFT | evidence ≥ 3 and agreement ≥ 70% | Watches only |
  | SHADOW | evidence ≥ 10 and agreement ≥ 95% | Ready; waits for you to press **Activate** |
  | ACTIVE | You activated it | **Today's code: acts without asking.** The item skips My Attention and appears in the Day Brief. **Owner's ruling, 13 Nov 2026: "a rule prepares; his yes acts"** (`Wiki-Knowledge.md` §0.9.4). Whether pressing **Activate** is that yes for every later item, or each prepared action still waits for him, is **to be confirmed by him** (§11 row 4); nothing is changed until then. No pattern is ACTIVE on production today |
  | FROZEN | You froze it | Paused until you press **Unfreeze** |
- Brain never activates a pattern on its own. You press **Activate**.
- **Edit action** changes what the pattern does: Archive/Ignore · Draft reply · Delegate to… · Add to
  Open Items. Saving an edit locks the action (shown as *manual*), and the miner stops
  overriding it.
- API: `/brief/rules`, `/brief/rules/:id/{freeze,unfreeze}`, `/shadow/rules/:id/promote`.

---

## 5. Risk Radar rules

**What it is:** checks that raise a flag on your daily Risk Radar when something matches
(`server/src/services/brain/riskRadarService.ts`).

- Every rule reads one **source**: Inbox (`feed_event`, with a look-back window of 1–168 h), Open
  Items (`open_item`), or Wiki / CRM pages (`wiki_page`).
- The condition is written in JSON (`all` / `any` / `not` over `{field, op, value}`), e.g.
  `priority in [critical, high] AND age_days >= 5`.
- Each rule also has a **severity** (low/medium/high), an optional **title template** that can use `{field}`
  placeholders, and an optional **suggested action**.
- **Three groups:**
  - *System rules* ship with Nexeo. You can't delete them, but **Disable for me** turns one off for you.
  - *Tenant rules* are made by an admin and switched on or off with a checkbox.
  - *My rules* are yours: **+ Add rule**, an on/off checkbox, and **Delete**.
- Each card shows how many times the rule fired and when it last fired.
- The Radar also runs six built-in signals: stagnant criticality, decay, silence,
  imminence, CRM stagnation, contradicted pages.
- API: `/risk-rules`, `/risk-rules/:id`, `/risk-rules/system/:ruleKey/{enable,disable}`.

---

## 6. Decisions and Delegations (audit logs)

- These are logs of what happened, not rules. **Decisions** lists every `decision_log` row. **Delegations** lists every
  `delegation_log` row.
- Filters: source (Mine / Brain's / All), type, action or delegatee, date range, and search.
- **Deleting a row also removes what Brain learned from it.** One deleted row is one less piece of evidence, so a pattern can
  drop back to DRAFT. **Delete all** removes every row that matches the filters, and only works after
  you type `DELETE ALL MY DECISIONS` / `DELETE ALL MY DELEGATIONS` exactly. It cannot be undone.
- **Conflict recorded 13 Nov 2026:** this hard deletion is what the code does today. It is against product invariant 7 (cleanup is reversible) and against the Wiki keeping history (`Wiki-Knowledge.md` §0.7 standard 7). It stays as it is until decisions and delegations move into the Wiki as trail; it is not changed by the approved proposal.

---

## 7. Compose Hints (legacy, being phased out)

- These are free-text hints added to the prompt for draft replies, scoped as global, triage,
  draft_reply or delegation.
- The tab appears **only while you still have hints**. New rules belong in Standing Instructions.
- API: `/brief/prompts`.

---

## 8. Rules that exist but are NOT shown on this page

| Store | What | Where it is managed |
|---|---|---|
| `user_action_rules` (other than Suzi's email rules) | Action rules ("when X, do Y") in DRAFT → SUGGEST → AUTO mode | Through the API only: `/brain/action-rules` (`brainAskRoutes.ts`). Suzi's email rules in this store ARE shown: see the note below |
| `delegation_matrix` | Who owns which area, and who it escalates to | Elsewhere in Settings |
| Quiet hours and language | `users.notification_preferences.brain_channel` | Settings |

> **Suzi's email rules are shown (DEF-457, live D-224, 13 Nov 2026 13:04 PKT).** The Standing Instructions tab
> has an "Email rules" section (`GET /brain/instructions` → `emailRules`, from `listEmailRules`) with **Remove**,
> which is `rule.remove` (`DELETE /brain/email-rules/:id`), so the rule is gone on Suzi too. A rule read from one
> of his instructions shows once, as the instruction. Other `user_action_rules` still have no screen.

---

## 9. How rules reach Suzi

`suziRules.ts` builds one versioned rules document for Suzi (Functional Charter row 4), with
no model involved:
`{quiet_hours, language, delegations, action_rules, standing}` plus the same content as Markdown.
`rules_version` goes up only when the content changes. Nexeo decides from its own copy
when it writes, so an outdated version number on `act` never causes a refusal. Changing these
fields changes the shared contract, so both sides must agree first (see
`NEXEO_SUZI_AGREEMENT.md`).

---

## 10. Change log

| Date | Change | Commit |
|---|---|---|
| 2026-11-13 | Document created from the code as it stands (no behaviour change). The §8 gap was found while writing it | (this commit) |
| 2026-11-13 | DEF-458: the hourly wiki linter no longer relabels a standing instruction as `orphan` or `stale` (it made every instruction unread within the hour). No instruction's status was changed by this commit; restoring the 12 affected ones waits for the owner | (this commit, Wiki session) |
| 2026-11-13 | DEF-458, data only (owner's decision): 5 standing instructions of user 2 restored to active and 3 paused, through `updateInstructionStatus`. Brain reads 5 instructions again (was 0). Gap recorded in §2.4: paused instructions are not listed on the tab | (this commit, Wiki session) |
| 2026-11-13 | Third outside review answered; proposal recorded in §11 (nothing built, no behaviour change) | (this commit, Wiki session) |
| 2026-11-13 | Owner approved the proposal (§11) (§4 states what the code does today and the open question on activated patterns; no behaviour changed by this commit). §6 records the deletion conflict | (this commit, Wiki session) |
| 2026-11-13 | Proposed, not built (owner's direction "all emails land in wiki and marked with rules", `Wiki-Knowledge.md` §0.12 and §0.12.1): which rule applied to an email is kept as a mark on the email's Wiki source (`rule:<id>` and what it prepared), written through the Wiki's door, and read by the briefs and Suzi from there | (this commit, Wiki session) |
| 2026-11-13 | DEF-454 (D-222): `rule.set` with the same kind and match folds into his existing rule; his 4 copies of the Demo VM ignore rule became 1 (3 turned off, not deleted) | 9fa8222 |
| 2026-11-13 | DEF-457 (D-224): Suzi's email rules shown on the Standing Instructions tab with Remove; a typed email-rule instruction also makes the email rule, linked by `instruction_id` (§2.4, §8) | c991ee2 |
| 2026-11-13 | DEF-460 (D-227): paused instructions listed with Resume (§2.4) | e535895 |
| 2026-11-13 | Text corrected after the third review (§2.4, §8, §11 row 3); no behaviour change | (this commit, Nexeo-Builder) |

---

## 11. Approved, not built yet (owner approved 13 Nov 2026, 13:44 PKT)

From the third outside review of the Wiki and rules. Each point was checked against the code; the full table with evidence is `Wiki-Knowledge.md` §0.11. **The owner approved all of it ("approve and doc it"). Nothing in this section is built unless its row says done.** Rows 1, 2 and 4 are built by the Nexeo-Builder session; row 5 by the Wiki session.

| # | What is wrong today | Proposed change |
|---|---|---|
| 1 | Pausing or archiving an instruction switches its email rule in a second, best-effort write (`updateInstructionStatus`); if that write fails the email rule stays on. Removing the email rule (`rule.remove`) leaves the instruction it came from active | Both rows change in one database transaction, in both directions. **BUILT 13 Nov (Nexeo-Builder, DEF-461):** `updateInstructionStatus` writes the instruction and its email rule in one `$transaction`; `rule.remove` deactivates the email rule and archives the instruction it was read from in one interactive transaction (Suzi's `rule.remove` and My Rules' Remove share it). Tests `reviewRulesItems12.test.ts`, `f2SuziEmailRules.test.ts`. **LIVE as D-228, 13 Nov 13:57 PKT**; checked: Brain reads his 5 active rules (paused left out), My Rules reads all 8. |
| 2 | `getActiveInstructions` turns a database error into an empty list, and readers ask for 30, 50 or 100 rules | One governed read: the rules, or "could not be read"; no reader's own limit; nothing that needs a rule check runs by itself while rules are unavailable; Suzi's rules document keeps its last version. **BUILT 13 Nov (Nexeo-Builder, DEF-461):** `getActiveInstructions` has no reader's limit (one ceiling, 1000, logged if reached) and throws `RulesUnavailable` instead of returning `[]`; Brain's prompts (composer, voice) say "could not be read"; the auto-executor HOLDS when its veto check cannot read the rules (it used to execute); the matcher and follow-up observations run nothing; My Rules answers 503; Suzi's pack leaves `rules` out so the desktop keeps its last copy. Tests `reviewRulesItems12.test.ts`, `reviewRulesExecutorHolds.test.ts` (mutation-checked). **LIVE as D-228, 13 Nov 13:57 PKT**; checked: Brain reads his 5 active rules (paused left out), My Rules reads all 8. |
| 3 | §8 above still said the email rules have no screen (DEF-457 added it, DEF-460 lists paused rules) | **Done 13 Nov** (§2.4, §8 corrected) |
| 4 | §4 says an ACTIVE pattern "acts without asking"; the owner's ruling of 13 Nov says a rule prepares and his yes acts. §6 says deletion "cannot be undone"; the Wiki keeps history | **To be confirmed by the owner:** does an activated pattern act by itself (his Activate was the yes), or does it prepare and wait for his yes each time (the Wiki session's reading of §0.9.4)? Not built either way. Deletion: §6 now says what the code does and that it conflicts with the Wiki keeping history; it is resolved when decisions and delegations become Wiki trail |
| 5 | Rules live in eleven stores | One rule note per rule in the Wiki (`Wiki-Knowledge.md` §0.10), marked instruction, learned suggestion, permission or system rule; this page stays the place rules are controlled |
