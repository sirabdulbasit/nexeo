# Wiki-Knowledge

Written 2026-11-12 by the Brain Wiki session. This is the one document of the Wiki: the rule every part of Nexeo and Suzi follows (§0), the owner's direction (§1) and the design and state of the Wiki (§2 onwards). It is a release blocker (AGENTS.md §2, invariant 9). Owner direction is in §1, his decisions in §5, the build order in §6, pruning in §7 and the state in §8.

## 0. The rule: Wiki first (owner, 2026-11-13)

### 0.1 The rule

1. **One memory.** Everything Nexeo knows is in the Wiki: people, companies, projects, topics, meetings, decisions,
   commitments and action items, rules, delegations, instructions, policies, documents, integration data, and the text
   of every email, message, meeting and attachment it learned them from.
2. **Placed in the Wiki.** Anything new Nexeo learns or is told is written to the Wiki: as a **note** (typed, with
   properties, `[[links]]` and backlinks, Obsidian-style) or as a **source** that notes cite (the text of an email,
   message, transcript or attachment). Nothing is saved as knowledge anywhere else.
3. **Retrieved from the Wiki.** Brain, the brief, the Action Center, the Meeting Assistant, the portal and Suzi read
   knowledge from the Wiki. Anything else they read is an index or cache **derived from** the Wiki, rebuildable from
   it, and never the only copy.
4. **Derived, not duplicated.** Action items are commitment notes; contacts are person notes; a meeting record is a
   meeting note with its transcript as the cited source; a rule or delegation is a rule note. Their lists, counts and
   screens are views of those notes.
5. **The trail is the citations.** What led to a note (every email in and out, chat, meeting) is the list of sources it
   cites, in order, kept current. An action item's conversation trail and its done/open state come from its note.
6. **Who may read follows where it came from** (owner, 2026-11-12): integrations are per client, so what they bring is
   company knowledge, readable by every user of the client; connectors are per user, so what they bring is that user's,
   readable by them alone. Enforced underneath, in one wiki.

### 0.2 What each part does

| Part | Writes to the Wiki | Reads from the Wiki |
|---|---|---|
| Feed (email, calendar, chat, tasks, integrations, Suzi's reports; **not WhatsApp**, §0.13.1) | Hands each item over once, with its source id; the Wiki decides which notes it belongs to | — |
| Wiki (the Brain Wiki role) | Writes, links and prunes notes; keeps sources; keeps every note's citations | — |
| Think (Brain, briefs, suggestions) | Only through the same intake as any feed | Everything it answers or decides from |
| Action Center | Through Think: a new or changed commitment note | The commitment notes, their state and their trail |
| Meeting Assistant (F-4) | The meeting note (minutes, decisions, action items, participants) and the transcript as its source | Its own notes |
| Rules, delegations, instructions (F-2.4, F-2.10) | Rule and instruction notes | The same notes |
| Integrations | Notes per integration, KPI and business unit, refreshed each run | — |
| Portal | Only through Nexeo's routes, which write notes | Views of notes |
| **Suzi** (charter) | Holds no data (agreed 5 Nov). Everything she captures or is told goes to Nexeo, which writes it to the Wiki | Nexeo's knowledge route and day pack, both views of the Wiki; she cites note titles |

### 0.3 Nothing is kept outside the Wiki (owner's decision, 2026-11-13)

Asked whether mechanics could stay outside, the owner chose **everything into the Wiki**: the audit trail, usage and job
history, device settings and identity (voiceprints, faceprint, the enrolment voice sample), and the rest. Secrets
(sign-in, OAuth tokens, keys) are kept **encrypted** in it and are never shown as text. What runs from them (queues,
in-flight sends) may keep a working copy, but the Wiki holds the record.

His other decisions the same day:
- **Meeting notes taken on the computer always go to the Wiki**, with Meeting Assistant on or off.
- **The enrolment voice sample is kept as well as the prints.**
- **What Suzi learns about him goes to the Wiki** ("remember me, how to communicate with me"). Lessons that apply to every
  user are product learning, sent to Suzi Master. Suzi decides intelligently which is which.

### 0.4 The ledger: every store, and where it goes

Counted on production on 2026-11-13 (14:00 PKT): **145 tables** (144 until the marks table of §0.12.1 was added that afternoon). (The first count that morning was 161: the 19 leftover backup copies were then removed on the owner's word, and the Wiki's two source tables were added. The table below is the current count; rows outside the Wiki are as counted that morning.) Every one is named in `src/services/wiki/wikiLedger.ts`. `tests/wikiFirstLedger.test.ts` fails when a table exists that the ledger does not name, and when the number of stores outside the Wiki goes up; the hourly wiki job logs any table in the live database that the ledger does not name. So nothing can be added outside the Wiki unnoticed, and the count can only fall.

| Kind | Tables | Rows | Rule |
|---|---|---|---|
| The Wiki | 6 | 68,781 | This is the Wiki: notes, links, citations, the source store and the marks on sources |
| Knowledge outside the Wiki | 70 | 146,539 | Moves in as notes or sources |
| Trail outside the Wiki | 34 | 156,647 | Moves in as record notes and citations |
| Settings, identity and secrets outside the Wiki | 24 | 232 | Moves in; secrets encrypted, device signing keys stay on the device (S1) |
| Working copies (may stay) | 10 | 17,756 | May stay; the Wiki holds the record and it can be rebuilt |
| Leftover backup copies | 0 | 0 | 19 tables (887 rows) removed 13 Nov on the owner's yes; a dump is kept |
| Database bookkeeping | 1 | 84 | Stays |

**Outside the Wiki today: 128 tables** (70 knowledge, 34 trail, 24 settings). The rule is met when that number is 0.

| Goes into the Wiki as | Stores (rows on 2026-11-13) |
|---|---|
| Person and company notes (B2) | `person_facets` (1,953), `entities` (1,112), `persons` (974), `entity_links` (224), `user_resolution_aliases` (1) |
| Commitment notes; the item list becomes a view (A2, DEF-450) | `open_items` (614), `delegation_thread_events` (142), `delegation_threads` (10), `delegation_logs` (4) |
| Meeting notes, transcript as the cited source | `meeting_records` (2) |
| Sources: the text of every message | `brain_user_messages` (135,641), `messages` (1,825), `whatsapp_messages` (530), `whatsapp_outbound_messages` (459), `brain_inbox_messages` (249), `conversations` (2) |
| Rule and instruction notes (A3) | `muted_senders` (31), `wa_sender_policy` (12), `gate_rules` (10), `risk_rules` (8), `user_action_rules` (2), `shadow_rules` (2), `delegation_matrix` (0), `gate_rule_overrides` (0), `risk_rule_overrides` (0), `rule_lifecycle` (0), `delegation_authorization_grants` (0) |
| Notes about the user: memories, preferences, what Brain learned | `governed_brain_memories` (46), `thought_entries` (41), `pattern_insights` (37), `user_learning` (11), `user_memories` (9), `pattern_hidden` (3), `user_profile_memory` (0), `clarification_memory` (0), `agent_memory` (0) |
| Document notes and their text as sources | `risk_flag_docs` (106), `brain_docs` (2), `domain_knowledge` (0), `knowledge_items` (0), `documents` (0), `chunks` (0), `personal_documents` (0), `personal_chunks` (0), `integration_source_files` (0) |
| KPI and business-unit notes; kpi_readings stays underneath as the exact figures | `kpi_values` (2,060), `kpi_readings` (192), `kpi_definitions` (1), `okrs` (0) |
| A note per integration (source, mapping, last run) | `integration_suggestions` (13), `integration_mapping_versions` (6), `integration_syncs` (1) |
| Notes of what Brain found or was told about itself | `brain_health_findings` (152), `correlation_incident_candidates` (9), `suzi_gaps` (9), `correlation_incidents` (3), `brain_detected_gaps` (1), `brain_development_requests` (0), `brain_product_proposals` (0), `brain_feedback` (0), `feedback` (0), `retrieval_feedback` (0), `proactive_alerts` (0) |
| Instruction notes: how Brain is told to behave | `action_definitions` (22), `prompt_blocks` (8), `user_prompts` (0), `user_prompt_overlay` (0), `action_dependencies` (0), `capability_registry` (0), `golden_dataset` (0) |
| The trail of a note: its cited sources and state changes | `brain_action_artifacts` (20,369), `integration_run_changes` (1,576), `item_status_history` (398), `decision_logs` (72), `entity_merge_audit` (14), `integration_runs` (5), `meet_event_receipts` (1), `delegation_matrix_history` (0) |
| Record notes: what was done, by whom, when | `agent_actions` (3,428), `self_heal_log` (2,455), `suzi_act_log` (54), `audit_logs` (52), `job_runs` (37), `brain_resets` (4), `self_prune_notice_batches` (2), `audit_log` (0), `agent_runs` (0), `action_idempotency_logs` (0), `action_undo_log` (0), `operator_runs` (0), `index_events` (0) |
| Record notes: usage and cost | `llm_spend` (37,822), `llm_spend_daily` (1,883), `consumption_events` (164), `orchestrator_spend` (118), `token_usage` (0), `token_query_log` (0) |
| Record notes: how Brain reasoned and was scored | `system_logs` (43,396), `gate_rule_firings` (35,748), `brain_interaction_learning_logs` (3,685), `reasoning_traces` (3,260), `brain_response_evaluations` (2,007), `brain_maturity_snapshots` (97), `shadow_scores` (0) |
| Setting notes: the account, licences and configuration | `system_config` (38), `connector_types` (35), `tenant_connector_configs` (22), `users` (2), `tenants` (1), `client_licenses` (1), `brain_configs` (1), `whatsapp_config` (1), `tenant_whatsapp_notifier` (1), `suzi_rules_version` (1), `user_tiers` (0), `licenses` (0), `agents` (0), `operator_settings` (0), `criticality_calibration` (0), `scheduled_tasks` (0) |
| Secrets, kept encrypted in the Wiki and never shown as text | `sessions` (92), `whatsapp_sessions` (20), `user_connectors` (14), `whatsapp_connections` (2), `meet_event_subscriptions` (1), `agent_api_tokens` (0), `approval_tokens` (0), `push_subscriptions` (0) |
| A queue or cache the product runs from; the Wiki holds the record | `criticality_fusion_cache` (8,078), `feed_events` (6,661), `brain_prompt_queue` (1,848), `triage_decision_cache` (1,025), `notification_queue` (101), `brain_pending_actions` (36), `suzi_presence` (3), `job_leases` (2), `suzi_outbox` (1), `ops_health_state` (1) |

Leftover backup copies (19 tables, 887 rows, the `…_wipe_…` and `…_2026_05_2x` tables) were **removed on 13 Nov 2026**: nothing read or restored from them, and a full dump is kept at `/root/nexeo-backups/leftover_backup_tables_2026-11-13.sql.gz`. Brain Reset (`brainResetRoutes.ts`) still creates new ones each time it runs; that stops when the reset is rebuilt on the Wiki's own archive.

Files outside the database that hold anything: the WhatsApp session folder (sign-in state, a secret), uploaded integration files, and the server logs. Suzi's side (the Mac app and her server) keeps a working copy only, by the charter.

### 0.5 How every change follows the rule

1. Before building, the change says which notes and sources it writes and reads. A new table that would hold knowledge
   is not built.
2. Until a store has moved, new work on it writes to the Wiki as well, so the Wiki becomes complete first and the old
   store can then be retired without loss.
3. A change that alters what Suzi receives is agreed with Suzi Master first (`NEXEO_SUZI_AGREEMENT.md`).
4. The three Brain documents record each move (DEF rows, chart rows).

### 0.6 Two kinds of wiki, chosen per user (owner, 2026-11-13)

*"i want everything should be part of wiki, where in future we may have 2 options of wiki: 1. Nexeo Wiki (Currently we
are using it) 2. Obsidian wiki (but next we will add this as an option for each user to select his knoweldge source)"*

1. **Nexeo Wiki:** in Nexeo's database, Obsidian-style. It is in use now and is every user's default.
2. **Obsidian wiki:** the user's own Obsidian vault as his knowledge source, chosen per user in Settings. Coming next;
   not built.

What this requires of everything built now:
- **One door.** Every part reads and writes knowledge only through the Wiki store's interface (`wikiStore`: write note,
  get note, links, backlinks, sources). Nothing reaches into the Nexeo Wiki's tables directly, so the store behind the
  door can be either kind for a given user.
- **Obsidian's own shapes.** A note is Markdown with properties (front matter), `[[links]]` and tags; sources are files
  a note links to. A Nexeo Wiki note must translate to an Obsidian note and back without loss.
- **Per-user choice.** The knowledge source is a setting of each user. Company knowledge (integrations) still reaches
  every user of the client, whichever source each chose.
- **Existing start:** `obsidianVaultService.ts` already exports a vault to the user's Drive (export only).

### 0.7 What "done" means, and the order of work (owner and review, 2026-11-13)

Owner, 13 Nov: *"make sure 100% every feed/incoming knowledge/meetings/discussion anything should be land in wiki (through proper structure, links, and information as per obsidian); make sure 100% that every information will be derived through wiki which will provided to Nexeo or Suzi both; when it is build, tested, verified then we consider it done."*

An outside review of this document the same day (recorded score 57.2 of 100, verdict UNVERIFIED) set the standard below. It is adopted in full. The Wiki must be able to answer: **what do we know, why do we believe it, what changed, and who may see it.**

| # | Standard | Where it stands |
|---|---|---|
| 1 | **One document, no contradictions.** Superseded decisions are marked; the build order follows the latest rules | Reconciled twice on 13 Nov. The second review still found three leftovers, fixed the same day: §7 merged notes on a matching title (against standard 2), §7 archived notes without saying their evidence is kept (against standard 7), and the counts of 12 Nov in §3 and §8 read as current. Not called complete: it stays open to the next read |
| 2 | **A note has a permanent identity; its title is a label.** Aliases and outside identifiers (an email address, a record id) do the matching. A link that could mean two notes stays unresolved. People are merged on evidence, never on a matching name alone | Not met: a note is found by type and title; a link picks the most recent match; the builder merges two addresses that share a name |
| 3 | **Shared and private are designed together.** One note, a shared layer and each reader's private layer. Permissions govern summaries, citations, backlinks, search and exports, not only the note. A shared summary never carries what was learned from one user's private mail | Not met, one part built 13 Nov: a citation is checked where it is written (`wikiSources.mayCite`, `assertCitable`): never across clients, never another user's own source, never a user's own source on a shared note, and the shared note's text is not written either (`tests/wikiCitations.test.ts`). Production had 0 such citations among 4,228 when the check was added. Still missing: the layered note, and permissions over summaries, backlinks, search and exports |
| 4 | **Facts carry their history.** An important property records its source, when it took effect, when it was recorded, and whether it was stated or inferred. A correction supersedes the earlier claim and keeps it. A commitment is completed only on sufficient evidence | Not met |
| 5 | **Everything is in the Wiki, handled by its kind.** Secrets never enter search, embeddings, model context or exports. A receipt keeps its integrity when a note is edited. A note's text, properties, citations and links change together or not at all, with a revision check so one writer cannot overwrite another | Not met: `writeNote` makes its changes in separate steps |
| 6 | **A store is retired on evidence, not on a count.** Its information and permissions were preserved; every reader and writer moved; the replacement survives replay and repeated intake; the derived view is rebuilt from the Wiki; a real user task still works. For commitments this includes state changes, authorisation and dispatch receipts | The ledger (§0.4) counts stores; no store has been retired yet |
| 7 | **Pruning protects useful history.** "Less relevant", "superseded" and "safe to archive" are different. Sources and the user's corrections are kept; merges are reversible; the 30 and 90 day settings live in `behaviorConfig` and are treated as guesses to be checked | Not met: §7 is a plan; retirement of a note is reversible |

**Order of work** (the review's, adopted):

1. Reconcile this document. **Done.**
2. Source durability: every fetched item and its text is a lasting source in the Wiki (§6b A1). **Built 13 Nov; see §8.**
   - **A missed landing recovers by itself** (second review, 13 Nov). The feed lands each item as it stores it, but a failed landing was only logged and a feed never offers an item twice. Now the stored feed items are the checklist: every hour, before the builder, each item's source is looked up by its own id and whatever the Wiki does not hold is landed (`wikiBackfill.reconcileSources`), for every user who has stored items, active or not. Nothing is remembered between runs, so an interrupted run loses nothing.
   - **The feed store lets go only of what the Wiki holds.** The daily feed pruner deletes an email's row only when the source store holds the item and, where an email page has the full text, that text (`wikiBackfill.holdsFeedItem`); it lands what is missing first, and keeps the row if it cannot.
3. Identity, permissions and write consistency (standards 2, 3, 5). The citation check of standard 3 is built (above); identity and all-or-nothing writes are next.
   - **Proof of behaviour before step 4** (second review, 13 Nov). Meaning notes are not added until one test runs the whole chain and passes: take an item in → correct it later → read back the current fact with its citations → another user cannot read what is private → rebuild the derived view and get the same answer. Run through Nexeo's routes and through Suzi's knowledge route (reading only; anything that changes what Suzi receives is agreed with Suzi first).
4. Meaning notes: projects, topics, decisions, commitments, with the history of each claim (standard 4, §6b A2).
5. Move the readers and writers, feature by feature (§6b B and C).
6. Retire the old stores, each on the evidence of standard 6 (§6b D).
7. Pruning (standard 7, §7).

It is done when the ledger shows nothing outside the Wiki **and** every row of the table above reads "met", each with its test and its check on production.

### 0.8 Who the Wiki handshakes with (owner, 2026-11-13)

*"wiki-knowledge should only handshake within this project and Suzi, not other's project, as per functional charter."*

1. **Two parties only.** Nexeo (the portal's signed-in people and Nexeo's own jobs) and Suzi (the charter's knowledge route and day pack, row 1 of the Functional Charter). No other project reads the Wiki, writes to it, or is bound by this document.
2. **Enforced.** The Wiki's routes (`/api/v1/wiki/*`, `/api/v1/brain/wiki*`) refuse a caller holding a machine token (`middleware/wikiHandshake.ts`, `tests/wikiHandshake.test.ts`). Suzi's routes have their own sign-in and are untouched.
3. **Checked on 13 Nov:** no other project on this server (`vm`, `tokr`, `shireme`, `tmcmde`, `qlik-bridge`, `ai-integration`) has code that calls Nexeo's Wiki or reads its tables, and none carries this rule in its instructions. No machine token is issued (0 in `agent_api_tokens`).
4. **Copies that leave Nexeo, for the owner to rule on:** the hourly export of contacts and pages to the user's own Google Drive ("Nexeo Vault", `obsidianVaultService`), which is the planned starting point of §0.6; and the Notion mirror job, which pushes pages to Notion for a user with Notion connected (no user has it connected today).

### 0.9 Rules: one set, everywhere (owner, 2026-11-13)

*"don't do anything by yourself, it should be part of Nexeo rules."* He looked at My Rules, saw "No standing instructions yet", while his Demo VM ignore rule (set through Suzi) was live in `user_action_rules`, which My Rules does not show.

**His decisions (13 Nov, Nexeo-Builder session):**

1. **One rule, one Wiki note** (A3), read by every part: Brain, Suzi's email list (`by_rule`), the brief, the Action Center. My Rules shows every rule, whoever made it (typed by him, set through Suzi, or learned by Brain), and Remove there removes it everywhere.
2. **A rule he types, or says to Suzi, works everywhere.** Nexeo reads his words into the rule (what it applies to, the match, the action) and shows it on My Rules exactly as it will act, so he can correct it. Unsure means it stays an instruction to Brain only.
3. **Learned patterns only propose.** A pattern shows as "Brain suggests: …" and does nothing until he says yes. Checked 13 Nov: already true in code (the miner only moves DRAFT to SHADOW; ACTIVE only through his Activate, `shadowRoutes.ts` promote).
4. **A rule prepares; his yes acts.** Ignore marks the item "ignored by your rule" and sends nothing; delegate prepares the forward and holds it for his one yes (as Suzi's email rules already do, F-2.4).
   **Superseded by his ruling of 13 Nov, 17:10 PKT:** *"what i do or ask to do is learning patterns for Suzi/Nexeo so it can suggest next time accordingly but not to do; Suzi/Nexeo will do all those which has become part of Rules, Delegation or Standing Instruction by itself."* So: **a learned pattern only suggests and never acts; whatever has become a rule, a delegation or a standing instruction, Nexeo and Suzi do by themselves.** (The Wiki session's reading: pressing Activate on a pattern is how it becomes a rule; until then it suggests.)
5. **Exact duplicates cleaned:** his Demo VM ignore rule existed 4 times (saved on 12 and 13 Nov); 3 copies turned off (not deleted), the oldest kept. A repeated save now folds into the existing rule (DEF-454, D-222).

**Until A3 lands, interim (Nexeo-Builder):** My Rules lists Suzi's email rules beside the standing instructions, with Remove = `rule.remove`; a typed instruction that is an email rule also becomes the email rule Suzi's list applies, linked to the instruction (pause or archive carries over). This is DEF-457, **live since D-224 (13 Nov 13:04 PKT)**; paused rules are listed too (DEF-460, D-227, 13:41 PKT). Details in `Rules.md` §2.4 and §8.

### 0.10 Rules are Wiki knowledge, so Nexeo thinks with them (owner, 2026-11-13, Wiki session)

*"read rules.md. this should also be part of wiki so Nexeo can improve its thinking, reasoning, proactiveness, alertness etc."*

Read as: every rule `docs/Rules.md` describes is a **rule note** in the Wiki, linked to the people, companies and topics it names, so the thinking part is given a person's rules with everything else known about that person, can say which rule made it alert him, and can see rules that repeat or contradict each other. This is A3 of the ledger and builds on §0.9 (one rule, one note).

**Three conditions, from the review he pasted with it, adopted as requirements:**

1. **Complete and current. No rule is dropped silently.** Two drops existed on 13 Nov:
   - The hourly wiki linter relabelled every standing instruction `orphan` (an instruction has no links), and the reader accepts only `active`. All 12 instructions on production were unread: Brain followed none and My Rules showed "No standing instructions yet". The same job had turned every deleted or retired page back into a live one (0 of 16,204 pages were left deleted or retired). **Fixed as DEF-458, live as D-225 (13 Nov, 13:21 PKT):** the linter labels only pages whose status is its to set (`linterOwns`); one run on production left all 12 instructions and all 367 notes alone, and 6 retired duplicate notes stayed retired. **Restored on the owner's word (13 Nov, 13:30 PKT):** 5 of his 8 are active and read by Brain again (chasing delegated tasks, following up on non-responders and on tasks, communication tracking, communication channels); 3 are paused by his decision (the two "don't ask for confirmation" orders, which conflict with §0.9.4, and a stale one-off to-do). A full linter run afterwards left all 8 as they were set. User 3's 4 were left untouched. Detail in `docs/Rules.md` §2.4.
   - `getActiveInstructions` reads at most 30 rules and says nothing when there are more. Not reached today (8). To be closed when rule notes are read instead.
2. **What kind of rule it is stays visible.** A rule note says who made it and what it is: an instruction in his words, a learned pattern (proposes only, §0.9.3), a permission (what may be done without asking), or a system rule. They are never merged into one list without that mark.
3. **Private stays private.** A personal rule and its evidence are the user's alone; a client rule is shared inside the client and nowhere else; a client rule winning over a personal one never opens a private note. The citation rule of §0.7 standard 3 (`mayCite`) applies to rule notes as to any note.

**The rule stores on production, counted 13 Nov:**

| Store | Rows | What it is |
|---|---|---|
| Standing instructions (`wiki_pages`, type `instruction`) | 12 (8 of user 2, 4 of user 3) | His typed orders. In the Wiki's table, but not linked notes |
| `user_action_rules` | 4 | Action rules, including the email rules set through Suzi |
| `shadow_rules` | 2 | Patterns learned from his decisions |
| `user_prompt_overlay` | 0 | Learned preferences on how to answer him |
| `risk_rules` | 8 | Risk Radar checks |
| `gate_rules` | 10 | What may become an action item |
| `muted_senders` | 31 | Senders he silenced |
| `wa_sender_policy` | 12 | Who Nexeo may read or message on WhatsApp |
| `delegation_matrix`, `delegation_authorization_grants`, `risk_rule_overrides`, `gate_rule_overrides`, `rule_lifecycle` | 0 each | Empty today |

**Build, first slice (not built yet):** one `rule` note per row of every store above, facts only, no model: his words, what it applies to, what it does, who made it, its state; `[[links]]` to the person and company notes it names; the store and row id kept on the note as its outside identifier (§0.7 standard 2), so a rule typed as an instruction and applied as an email rule is one note. Built hourly with the other notes. The stores stay the working copy until each reader moves to the note (§6b); nothing Suzi receives changes without her agreement.

### 0.11 Third outside review (13 Nov): every finding answered, and the proposal (waiting for the owner)

The review read checkout `dadd154c` and scored the Wiki plan 85 of 100 (80 before). Its eight capability scores are carried forward and credit no change. It asked for a proposal first, nothing built. Each finding was checked against the code on 13 Nov.

**APPROVED by the owner, 13 Nov 2026, 13:44 PKT ("approve and doc it").** The whole proposal below is approved to build, in its order. Status of each item is kept in the proposal table.

| # | Finding | Checked against the code | Answer |
|---|---|---|---|
| P1 | Pause and remove are not reliable across every reader of a rule | **True.** `instructionService.updateInstructionStatus` saves the instruction, then switches its email rule in a separate write inside `try { } catch { }`. A failure leaves the email rule on after the instruction was paused. The other direction is missing: removing the email rule (`rule.remove`) does not touch the instruction it came from | Proposal 1 |
| P1 | Confidentiality across the whole path | **Not proven either way.** Spot check: the Wiki list, text search, meaning search and Suzi's knowledge route all filter by client and by `scope = 'tenant' OR user_id = me`; the only use of the admin role on these routes is to manage client rules. No leak found, but no test runs two users and two clients through every path, and about 35 older writers were not read | Proposal 3 |
| P2 | Rules are dropped or lost silently | **True.** `getActiveInstructions` ends in `.catch(() => [])`, so a database error reads as "no rules". Readers ask for different numbers: 30 (both composers), 50 (the matcher and the cognitive engine), 100 (Suzi's rules document). A failure while building Suzi's rules document would publish an empty list | Proposal 2 |
| P2 | Reconcile does not prove a source holds the latest content | **True.** `reconcileSources` asks only whether the source exists and has text; email recovery compares length. A corrected text of the same length, or a newer shorter one, is not noticed when its live landing failed | Proposal 4 |
| P2 | Stable identity, revisions, fact history before meaning notes | Agreed; it is §0.7 step 3 and standard 4 | Proposal 5 |
| P2 | Rule notes without a second rules engine | Agreed. A rule note is the rule's record and links; the reader that acts stays one per kind, and moves to read the note | Proposal 6 |
| P3 | Documents disagree | **True.** `Rules.md` §8 still says the email rules have no screen (DEF-457 added it); §0.9 here still says the interim is not built; §0.4 mixes 161 and 144 tables; `Rules.md` says an ACTIVE pattern "acts without asking" and that audit deletion "cannot be undone", against §0.9.4 and invariant 7; `AGENTS.md` names `Changes_Made.md`, not written since 18 Aug | Proposal 0 and two rulings asked of the owner |
| — | "The paused-rule listing fix is uncommitted" | Committed (`e5358959`, DEF-460) and **deployed as D-227, 13 Nov 13:41 PKT**; My Rules returns his 5 active and 3 paused instructions (Nexeo-Builder's check). An earlier wording of this row said "not deployed": it was written from the deploy list minutes before D-227 was recorded | — |

**The proposal, smallest first within each priority:**

| # | Change | Size | Proof it is done |
|---|---|---|---|
| 0 | **Documents say what is true** (P3): the five places above. **Done 13 Nov:** `Rules.md` §8 and §0.9 here (Nexeo-Builder, `e1c38f46`); the table counts in §0.4; `Rules.md` §4 and §6 now state both what the code does and what his ruling requires. **Open:** `Changes_Made.md` in `AGENTS.md` (his explicit word needed) | Text only | A read finds no statement the code contradicts |
| 1 | **One write for a rule and its email rule** (P1): both rows change in one database transaction, in both directions (pause, resume, archive from the instruction; remove from the email rule). Both tables are in the same database, so no queue or repair job is needed | One function, one reverse hook | Pause, resume, archive, remove through Nexeo and through Suzi; a forced failure of the second write changes neither row; the state survives a restart. **BUILT 13 Nov (Nexeo-Builder, DEF-461):** `updateInstructionStatus` writes the instruction and its email rule in one `$transaction`; `rule.remove` deactivates the email rule and archives the instruction it was read from in one interactive transaction (Suzi's `rule.remove` and My Rules' Remove share it). Tests `reviewRulesItems12.test.ts`, `f2SuziEmailRules.test.ts`. **LIVE as D-228, 13 Nov 13:57 PKT, but NOT atomic until D-239:** the array-form transaction failed on the real database and flipped the email rule anyway (DEF-466); fixed with one interactive transaction on `tx`, re-checked on the real database with forced failures. |
| 2 | **One governed read of rules** (P2): every reader calls one function that returns the rules **or** "could not be read". No reader's own limit. "No rules" and "unavailable" are different answers; when unavailable, Brain is told so, nothing that needs a rule check runs by itself (invariant 6), and Suzi's rules document keeps its last version | One function, seven callers | 31 or more rules all reach every reader; personal and client rules mixed; paused left out; a database failure is reported, not read as empty. **BUILT 13 Nov (Nexeo-Builder, DEF-461):** `getActiveInstructions` has no reader's limit (one ceiling, 1000, logged if reached) and throws `RulesUnavailable` instead of returning `[]`; Brain's prompts (composer, voice) say "could not be read"; the auto-executor HOLDS when its veto check cannot read the rules (it used to execute); the matcher and follow-up observations run nothing; My Rules answers 503; Suzi's pack leaves `rules` out so the desktop keeps its last copy. Tests `reviewRulesItems12.test.ts`, `reviewRulesExecutorHolds.test.ts` (mutation-checked). **LIVE as D-228, 13 Nov 13:57 PKT**; checked: Brain reads his 5 active rules (paused left out), My Rules reads all 8. |
| 3 | **Isolation proven, not assumed** (P1): one acceptance run with two users in one client and one user in another, through notes, sources, citations, links, search, Suzi's knowledge route, rules and the Drive export. Anything that fails becomes a fix with its own row | Tests first; fixes only if found | Every path answers "not visible" for the other user and the other client; an admin sees no other user's private note |
| 4 | **A source knows which version it holds** (P2): the source records when its text was fetched; a later text replaces an earlier one and never the reverse; reconcile compares the text's fingerprint, not its length | One column (migration), two functions | Same-length correction, newer shorter text, replay and out-of-order arrival each end with the latest text |
| 5 | **Identity and all-or-nothing writes** (§0.7 step 3): a permanent id, aliases and outside identifiers; a link that could mean two notes stays unresolved; no merge on a name; text, properties, links and citations change in one transaction with a revision check | The largest item | The first chain below |
| 6 | **Rule notes** (§0.10, A3 first slice), after 5: one note per rule, each marked instruction, learned suggestion, permission or system rule; My Rules stays the place he controls them | After 5 | The second chain below |

**Two chains to demonstrate, with providers mocked:** (a) take in → correct → read back the current fact with its citations → private and client access enforced → rebuild the view; (b) instruction → the event or deadline it is about → a grounded proposal → his approval where required → confirmed outcome → pause or revoke, everywhere. Plus one learning case: a correction improves a later like decision without exposing private evidence or creating a permission.

**The two rulings asked with it, as taken from his approval:** (i) **Activated patterns: still open.** His rulings say a learned pattern only proposes until his yes (§0.9.3) and a rule prepares while his yes acts (§0.9.4). Whether pressing Activate is that yes for every later item, or each prepared action still waits for him, was asked again on 13 Nov and is not built either way (production has no ACTIVE pattern today: 1 SHADOW, 1 DRAFT). (ii) **`Changes_Made.md`:** not settled. `AGENTS.md` still names it as the handoff record and it has not been written since 18 Aug 2026; in practice the change log, the chat log, the evaluation chart, this document and `Rules.md` carry the record. `AGENTS.md` is **not amended**: that file is the working contract and is changed only on his explicit word.

**Who builds:** 1 and 2 are in the rule code (Nexeo-Builder session, told 13 Nov 13:45 PKT); 0 and 3 to 6 are the Wiki's. No capability point is claimed for any of this until the chains pass on production.

### 0.12 Every email lands in the Wiki, marked by the rules; briefs read from the Wiki (owner, 2026-11-13)

*"all emails should be land in wiki and marked with rules (none of email should be msised) morning brief or Suzi will extract emails, actionable items, meetings from wiki"*

1. **Every email lands in the Wiki. None is missed.** The source store (A1) already takes every fetched email's text. The rule now: no email exists only in `feed_events` or only in a triage cache. Proof: for any day, the count of his fetched emails equals the count of email sources in the Wiki.
2. **Each email is marked by the rules.** Each email in the Wiki carries its marks, kept with it rather than recomputed per screen:
   - whether it needs him (DEF-459 `needsYou`);
   - "for your knowledge" with the reason (escalation, risk, own thread, team);
   - which of his rules applied (ignore or delegate by rule, `by_rule`);
   - the action item made from it, if any;
   - the meeting it belongs to, if any.
   Today these marks are computed in the triage cache (`triage_decision_cache`) and the partition, outside the Wiki. Moving them onto the email's Wiki entry is the change.
3. **The morning brief and Suzi read from the Wiki.** Emails needing him, For your knowledge, action items and meetings are read from those marked Wiki entries. Nexeo's WhatsApp brief, the Day Brief page and Suzi's pack all read the same entries, so they cannot disagree.
4. **Who builds:**
   - The Wiki session: landing, the marks' place on the note, completeness proof.
   - Nexeo-Builder: writing the DEF-459 judgement and the rule marks onto the email's Wiki entry, and switching the brief and the pack to read from the Wiki.
   - Suzi Master: agrees the pack reading from the Wiki before it changes what Suzi receives (§0.5 rule 3).
   - Not built yet: the Wiki session proposes the shape first.
5. **Progress (13 Nov):**
   - The marks store is live (Wiki session, D-229).
   - Attention marks are written from each fresh triage judgement (Nexeo-Builder, DEF-462, **live D-230 14:11 PKT**, verified on the reported thread).
   - The daily "none missed" check is live (Nexeo-Builder, DEF-463, D-232 14:19, fixed D-233 14:36 PKT). **Proof met, 13 Nov 15:00 (D-235, one counting unit):** 12 Nov: 20 in the mailbox (17 inbox, 3 sent), 19 distinct held, 0 missing, 19 marked, 0 unmarked. 13 Nov: 27 (23 + 4), 26 held, 0 missing, 26 marked, 0 unmarked. The Wiki's own emails dated those days (23 and 29, which include mail Gmail no longer lists in inbox or sent) are all marked too. Every 3 hours it compares today's and yesterday's inbox and sent ids with the Wiki, lands what is missing (sent mail through `landEmailText`, marked `own`), and keeps the day's counts as one `record` source.
   - **Live (DEF-465, W-1.E agreed by Suzi Master 15:20; D-239 15:45 PKT):**
     - Suzi's pack and spoken brief read emails and For your knowledge from the Wiki's marks;
     - rule marks (key = rule id) are written and swept on rule changes;
     - "mark handled" writes a handled mark;
     - the daily check judges the whole 7-day window (0 of 125 unmarked on 13 Nov).
   - Still to come: the action item and meeting marks; the Day Brief page and the WhatsApp brief reading from the Wiki.

#### 0.12.1 The shape of the marks (Wiki session, 13 Nov 2026: agreed by Nexeo-Builder; the store is LIVE as D-229, 14:04 PKT; see the end of this section)

**No note per email.** An email is a **source** (§7: a source only adds to notes). A note per email is what the old wiki did: half of its 15,800 pages. So the marks sit **on the source**, and the things an email leads to are notes that cite it.

| What the owner asked to see on an email | Where it lives | Why there |
|---|---|---|
| Needs him / for his knowledge (with the reason) / brief only | A **mark** on the email source, kind `attention` | A judgement about the email, made for one reader, that can change |
| Which of his rules applied (ignore, delegate) | A **mark**, kind `rule`, one per rule that matched, holding the rule's id and what it prepared | So "why was this ignored?" is answered by the rule itself (§0.10) |
| He handled it, or said ignore once | A **mark**, kind `handled` | His own act |
| The action item made from it | The **commitment note cites this email** (§0.1.5). Until commitment notes exist (step 4), a mark of kind `action_item` holding the open item's id | The trail is the citations; no second link to keep in step |
| The meeting it belongs to | The **meeting note cites this email**. Until then a mark of kind `meeting` holding the meeting note's id | Same |

**A mark is a row of its own, not a field inside the source** (new table `wiki_source_marks`, part of the Wiki):

- The source stays what was fetched: evidence that never changes. A mark is a judgement and does change, so it is kept apart (§0.7 standard 4).
- Fields: the source; the client and the **user the mark belongs to**; `kind`; a `key` (the rule's id, the open item's id; empty for kinds that have one value); `value`; `set_by` (`triage:v2`, `rule:<id>`, `user`, `suzi`); `set_at`; `superseded_at`.
- **History is kept.** A new mark of the same kind and key supersedes the earlier one and does not erase it, so "it needed me yesterday, and stopped when I replied" can be read back. Writing the same value again changes nothing.
- **Private by construction.** A mark belongs to the user it was made for and is read only by that user, on a source that user may see. One user's judgement of a shared source is never another's.

**One door (`wikiStore`), every call naming the client and user (the lesson of DEF-456):**

- `markSource(writer, sourceId, { kind, key?, value, by })` and `clearMark(writer, sourceId, kind, key, by)`: checks the source is the writer's to mark; supersede and insert in one transaction.
- `marksOf(clientNumber, userId, sourceIds)`: the current marks.
- `listMarkedSources(clientNumber, userId, { kinds, since, until, mark? })`: for the brief and the pack, for example today's emails whose `attention` is `needs_you`. Also the calendar sources of a day, for meetings.
- `countUnmarked(clientNumber, userId, 'email', 'attention', since, until)`: the proof that every email was judged.

**"None is missed", as two counts kept every day, each as a record in the Wiki:**

1. **Fetched = landed.** Already enforced hourly by the reconcile (§0.7 step 2). What it cannot see is an email that the connector never fetched: that needs the mailbox's own list of message ids for the day compared with the sources, and any id not held fetched and landed. That comparison calls the mail provider, so it is a Feed job; the Wiki answers "which of these ids do you hold" (`sourcesHeld`).
2. **Landed = marked.** `countUnmarked` for the day is 0.

**Built 13 Nov 2026 (the store only):** table `wiki_source_marks` (migration `20261113_wiki_source_marks`, applied to production 14:00 PKT, run twice to prove it repeats), `src/services/wiki/wikiMarks.ts`, re-exported by `wikiStore`: `markSource`, `clearMark`, `marksOf`, `markHistory`, `listMarkedSources`, `countUnmarked`. Checked: `tests/wikiMarks.test.ts` (9 tests, 3 of 3 mutants killed) and 16 of 16 checks on the production database with throwaway rows under a client that does not exist (set, no-op, supersede with history, two rules by key, clear, window list with and without a mark filter, unmarked count 2 then 0, another user's source refused, another client refused, each user reading only their own mark on a shared source, two writers at once leaving one current mark), rows removed afterwards. **Live as D-229 (13 Nov, 14:04 PKT):** three files, manifests equal, health 200. **No email carries a mark yet** (0 rows): writing the marks and moving the readers is the next part (Nexeo-Builder), and the mailbox comparison of count 1 is Nexeo-Builder's too (the Nexeo Integration session declined it on 13 Nov: it owns the client-level integrations, not the per-user Gmail connector). Not built.

**Three answers settled with Nexeo-Builder (13 Nov, 14:20 PKT), before it builds the daily check:**

- **His sent mail.** Today it lands only by accident: of 5,282 email sources, 123 carry the SENT label and 505 are from his own address, because the poller reads the inbox only. The daily check lands every sent email through the Wiki's intake (`wikiIntake.landEmailText`, with its full text and its `SENT` label; the label field is live as D-231, 13 Nov 14:14 PKT), with **no feed row**: sent mail has nothing to triage. The builder already counts a message from his own address as "he wrote in this thread". The hourly reconcile works from feed rows, so for sent mail the daily comparison itself is the safety net and must cover sent ids.
- **A sent email is marked `attention = { class: 'own' }`** (by `landing:sent`) as it lands. There is nothing to judge in it, and without the mark "landed = marked" could never reach 0. The attention classes are therefore: `needs_you`, `for_your_knowledge`, `brief`, `own`.
- **The day's counts are a source, not a note.** One source per user per day, kind `record`, id `mailbox-census:gmail:<day>`, saved again when the check re-runs: in mailbox (inbox, sent), held, fetched late (the ids), marked, unmarked. It is what the mail provider said that day, which is what a source is. A note of a new type would be embedded and returned by Brain's and Suzi's knowledge search as if it were knowledge (the search leaves out only three page types); sources are not searched that way. A monthly note citing these sources can come later.
- Not decided: landing his sent mail from before the check exists (DEF-450 needs it). For the owner.

**Order:** the marks store was built **before** item 3 of §0.11 because the other half was waiting for it. Nexeo-Builder then writes the DEF-459 judgement and the rule marks through `markSource` and moves the brief readers; the pack change goes to Suzi Master first.

### 0.13 Structure first; the content is rebuilt by a re-scribe (owner, 2026-11-13, afternoon)

*"I am not much concerned of loss data with old wiki. My concern that wiki should be well structured as discussed. Once wiki is upgraded we can be able to re-scribe the entire feed/external systems etc to rebuild the wiki with new structure."*

**What this changes:**

1. **The goal is the structure, not carrying the old content over.** The old pages are not migrated or repaired. When the structure is ready, the Wiki is rebuilt from what the feeds and the connected systems hold, and the old pages are archived in one step.
2. **No more work to rescue old content.** Not done, and no longer planned: fetching his older sent mail once (the rebuild fetches it), recovering text from old email pages beyond what already runs, any backfill of old page types.
3. **The order of §0.11 changes.** Identity and all-or-nothing writes (item 5) move to the front, because every note type built after them depends on them. The isolation run (item 3) is run on the new structure, before the rebuild.
4. **The readers still have to move.** "Not concerned about old data" does not make the features that read the old pages safe to break: contacts, sender recognition, triage, the briefs and Suzi read old page types by name (§6a). Each moves to the new notes before the old pages are archived.

**"Well structured" means, as agreed across §0 and §4** (this list is the checklist for "upgraded"):

| # | Part of the structure | Today |
|---|---|---|
| 1 | One wiki; who may read follows where it came from (connector = the user's, integration = the company's) | Live |
| 2 | A note per real thing, typed, with properties: person, company, meeting, group | Live (facts only) |
| 3 | Links written in the text as `[[Title]]`; backlinks; a link to a note not yet written waits and connects | Live |
| 4 | Sources kept apart from notes; a note cites its sources; the citations are its trail | Live |
| 5 | Marks on a source (needs him, rule applied, handled), with history | Live since 13 Nov; being filled |
| 6 | A permanent identity per note; aliases and outside ids; no merge on a name; an unclear link stays unresolved | Live 13 Nov (§0.13.2) |
| 7 | A note's text, properties, links and citations change together or not at all | Live 13 Nov (§0.13.2) |
| 8 | A source knows which version of its text it holds | Live 13 Nov (§0.13.3) |
| 9 | Rule notes: one per rule, marked instruction, learned suggestion, permission or system rule (§0.10) | Live 13 Nov (§0.13.6) |
| 10 | Meaning notes: project, topic, decision, commitment (action items), each fact with its history | Not built; needs a model and a cost check |
| 11 | Integration, KPI and business-unit notes; transcripts, attachments and conversations as sources | Partly (records adopted as notes) |
| 12 | Proven private: two users and two clients through every path | Run 13 Nov: 22 of 22; four faults found and fixed (DEF-471 to 473); Drive export and meaning search read from code only (§0.15) |
| 13 | Self-pruning that keeps sources and history (§7) | Not built |

**The rebuild, when 6 to 12 are done:** archive every old page and every note; run Scribe for every user and every integration; the builder writes the notes from the sources. It must give the same wiki when run twice.

**Two things a re-scribe cannot bring back, so they are carried over, not rebuilt:**

- **What he typed or decided himself:** his standing instructions and email rules, muted senders, his corrections, the marks "handled" and "ignore once", and the decisions and delegations log. No feed holds these.
- **What the providers no longer give:** conversations with Brain and Suzi, and meeting minutes whose transcript has expired at the provider. (WhatsApp is not a feed and is not re-read, §0.13.1.)

**One setting decides how much comes back.** A Scribe run today fetches the last 30 days or 500 emails, calendar 30 days back and 60 ahead, WhatsApp 14 days (`historicalFeedPull.ts`). The Wiki holds his email back to April only because the old pages kept it. A rebuild by today's Scribe would therefore hold about one month. How far back a rebuild reaches is **his decision**, and becomes a setting, not a constant. **Decided: the first read takes everything** (§0.13.1).

#### 0.13.1 Decided the same afternoon: the first read, and WhatsApp (owner, 13 Nov 2026, 14:40 PKT)

1. **The first read takes everything.** *"How far back, first time should read entire."* On a rebuild, the whole mailbox (inbox and sent) and all past calendar entries are landed as sources, newest first, resumable. Measured from April to November: 300 to 700 emails and about 1 MB of text a month, so years of mail is tens of megabytes. Landing and the facts-only notes use no model.
2. **Proposed with it, not yet confirmed by him:** the model reads only the recent part. Judging "needs him", action items and project notes for the last 90 days (a setting); older mail is landed, builds people, company and meeting notes, and is marked `attention = { class: 'history' }` without a model, so "landed = marked" still holds. A model reads an old conversation only when something current links to it. Reason: one model call per email over years of mail would break the cost target (Costing Charter) and turn old requests into open action items.
3. **WhatsApp is not a feed.** *"whatsapp will not be part of feed."* It is the line between the user and Nexeo, not a place knowledge is fetched from (his rulings of 4 and 5 Nov say the same of other people's messages). So:
   - A WhatsApp feed row is not landed as a source (`wikiIntake`, live as D-234, 13 Nov 14:47 PKT) and the reconcile does not count it as missing. No WhatsApp row has entered the feed since 7 Aug 2026.
   - A rebuild does not read WhatsApp.
   - **Removed on his word, 13 Nov 16:55 PKT** (§0.13.5): the 876 WhatsApp sources and the 876 WhatsApp feed rows; a copy is kept.
   - **Open:** what he tells Nexeo over WhatsApp (an instruction, a correction) is a conversation with Brain, not a feed item. Whether those conversations are kept in the Wiki, as conversations, is his decision and is not built.

#### 0.13.4 His answers on the rebuild (owner, 13 Nov 2026, given in the Nexeo-Builder session and relayed)

1. **The rebuild is a re-scribe from the connectors.** *"i will scrine or rescribe from connector."* He runs it himself, from the Connectors screen. So Scribe is the door the rebuild goes through, and it has to reach everything (§0.13.1 item 1) and write the new structure.
2. **The 90-day line for the model is still not ruled on** (§0.13.1 item 2). He was asked and answered about how the rebuild is run, not about that line. To be asked again, directly, before meaning notes are built.
3. **W-1, "Wiki first", is agreed by all three** (*"agreed from my side"*, 16:25 PKT): the founder, Nexeo and Suzi Master, with safeguard S1 (a device's signing keys stay on the device). The rule of §0 now binds Suzi's side too. Recorded in `NEXEO_SUZI_AGREEMENT.md`.
4. **Older open items are closed as superseded by the rebuild.** *"leave it we will build new wiki from new feed from connector and rules."* That covers: TMC Context into the Wiki, the 2,000-page limit, KPI notes as a separate item, Suzi's send switch, "fix the brief", and the email-to-item gate. None of them is worked on as its own item; what each needs comes from the new Wiki, built from the connectors' feed and his rules.

#### 0.13.5 His decisions of 13 Nov, late afternoon (owner, directly to the Wiki session)

1. **How far the model reads on a rebuild is chosen in the Connectors screen, at scribe time.** *"this will be available in connector for scribe."* Scribe offers the window for the model (for example the last 90 days); everything is landed whatever is chosen. Building that choice into Scribe is Nexeo-Builder's; the Wiki marks what lies outside the window `attention = { class: 'history' }`.
2. **Everything that came from WhatsApp as a feed is removed.** *"remove all feed comes from whatsapp."* Done 13 Nov 16:55 PKT: 876 WhatsApp rows of the feed store and their 876 Wiki sources deleted in one transaction. Nothing referred to them (no key, no citation, no mark). A copy is kept at `/root/nexeo-backups/whatsapp_feed_2026-11-13.sql.gz` (1,752 rows), so the removal can be undone.
3. **WhatsApp is only for talking with Suzi; instructions given there act.** *"whatsapp will only be used to conversate with Suzi; however through whatsapp instructions can be given like sending/replying email, creating/updating actionable items."* So a WhatsApp message is never knowledge fetched into the Wiki. What an instruction given there does (an email sent, an action item made or changed) reaches the Wiki the same way as when it is done anywhere else.

**Also added the same hour, at Nexeo-Builder's request:**

- `wikiStore.removeSource(writer, id)`: removes a user's own source completely, its text, its marks and every citation of it, in one transaction (identity.delete, safeguard S2 of W-1). A company source is not one user's to remove.
- Two writers marking the same source at once now wait for each other (`markSource` takes a transaction lock per source, user, kind and key), so neither write is lost.

Checked on the production database with throwaway rows, 6 of 6: five markers at once leave one current mark and five history rows with no error; another user and a company source cannot be removed; removal takes 6 marks and 1 citation with it and leaves nothing behind.

#### 0.13.6 Part 9 is LIVE: every rule is a note (Wiki session, 13 Nov 2026; D-250, 18:22 PKT)

`src/services/wiki/wikiRuleNotes.ts`, run with the other notes (after every Scribe and every hour). One note of type `rule` per rule, carried over from the stores that hold rules today, facts only, no model. Each note says:

- **what kind it is:** standing instruction, rule, delegation, permission, learned pattern, or system rule;
- **whether it acts by itself**, by his ruling of 13 Nov 17:10: yes for everything that is on, except a learned pattern, which only suggests;
- what it applies to (`[[linked]]` to the person or company note when there is one), what it does, his own words, who set it and when;
- the store and row it is kept in, as its outside identifier. A typed instruction and the email rule made from it are one note.

Company and system rules are shared notes, written once per client. Removed rules are not notes; a rule that disappears from its store is retired. The stores stay the working copy that acts (`Rules.md`); moving the readers to the notes is the step after.

**On production, 13 Nov 18:40 PKT, for the founder:** 63 rule notes: 8 standing instructions (5 acting, 3 paused), 33 rules (31 muted senders, 2 email rules set through Suzi), 2 learned patterns (suggesting only), 2 WhatsApp permissions, and 18 system rules shared with the company. A second run changes nothing. Checked: `tests/wikiRuleNotes.test.ts` (5 tests; a mutant that lets a pattern act is caught).

Not yet: rules of the integrations, the "how to work with you" note (Nexeo-Builder writes it from Suzi's profile.update), and readers reading the notes instead of the stores.

**Meetings got their permanent identity the same evening:** each meeting note carries its calendar series (`event:<series>`, Google's event id without the instance suffix), and drafts that share a series are one meeting titled as it was last held. On production this folded 11 duplicates (for example "AI Recruiter UAT Session (Wednesday 11th…)" and "(Thursday 12th…)", one series): 96 meeting notes became 85, every one with its series; the next build wrote nothing; 0 links point at a page that is not a live note.

#### 0.13.2 Parts 6 and 7 are LIVE: permanent identity, and all-or-nothing writes (Wiki session, 13 Nov 2026; D-236, D-237, D-238)

**On production after the three deploys (15:38 PKT):** 361 notes of the active user, every one with a revision; 1,222 links, none pointing at a page that is not a live note (50 did before); 0 unresolved and 0 ambiguous links; 4,248 citations, none breaking the citation rule; a second build writes nothing. Not yet seen on real data: a rename (no name changed between builds), a merge, the server's own hourly build with the new writer.

**What a note's identity is now** (`wikiStore.ts`):

- **Its id never changes; its title is a label.** A note carries **outside identifiers** (`metadata.ids`, written `kind:value`: `email:ali@x.com`, `domain:x.com`, `space:spaces/AAA`). A write that carries one of them finds the note whatever its title has become, and a new title **renames** it: same note, same links, same trail.
- **Former names still work.** The old title becomes an **alias** (`metadata.aliases`). A link written with an alias reaches the note, and a note can be read by a former name.
- **A link reaches a note only when exactly one live note answers to the name.** A note titled with the name beats one that only has it as an alias; an integration's record page gives way to any other note; two answers leave the link unresolved and recorded as ambiguous (`metadata.ambiguousLinks`). A link never reaches an old page or a retired note (50 of 1,222 links did, before this).
- **Identifiers that belong to two notes are refused** (`IdentityConflict`); nothing is written until they are merged on evidence.
- **Two notes become one only through `mergeNotes`**, which moves the citations and the links pointing at the folded note, and records exactly what it moved; `unmergeNote` puts it back. A merge made on the user's word is remembered (`confirmedSame`) and holds in every later build.
- **People are no longer merged on a name alone.** The builder merges on the same mailbox name, the same organisation, or the user's word. A work address and a personal one with the same name are two notes that say "Possibly the same person" about each other.

**What a write is now:**

- **One transaction.** A note's text, properties, links and citations are written together or not at all.
- **A revision** (`metadata.rev`) goes up with every write. A second writer who read an older revision is refused (`WriteConflict`); a job looks again once, a person editing what they read is told.
- **A builder states the whole note** (`exact`): its identifiers and its trail become exactly what the build produced, so an address that turns out to be someone else is released and a source no longer used leaves the trail.

**Checked:** `tests/wikiIdentity.test.ts` (13 tests) with 8 of 8 mutants killed; the builder's cases in `tests/wikiBuilder.test.ts`; the store's earlier tests unchanged and passing against a stand-in that really rolls back. A dry run on production gives the same 361 notes as before (252 people, 95 meetings, 12 companies, 2 groups): no person on production depended on the name-alone merge.

**Found while proving it on the real database, and fixed first (DEF-464):** in this project a raw statement inside a transaction ran **outside** it. The logging wrapper on the database client was bound to the main connection and re-installed on every transaction, so a raw write survived a rollback and a raw read did not see its own transaction's rows. The unit tests could not see this (their stand-in rolls back correctly); the production probe did. So "one transaction" above was not true until the client was fixed, and neither was any other transaction in the server that uses raw statements (twelve files, among them the rule and email-rule change of DEF-461, the integration run engine and the job leader lock). Fixed in `src/db/` and deployed before this part (D-236). After it, on production with throwaway rows: the identity checks pass 18 of 18 and the marks checks 16 of 16, including three writers at once ending as one note.

**Not in this part:** meeting notes have no outside identifier yet (a rescheduled or retitled event could otherwise pull two notes into one); a screen for "these two are one person"; typed links (`[[person:Ali]]`) for the ambiguous case.

#### 0.13.3 Part 8 is LIVE: a source knows which version of its text it holds (Wiki session, 13 Nov 2026; D-241, D-242)

**What was wrong** (third review, §0.11 item 4): a source kept its text and a fingerprint, but not when that text was fetched nor whether it was only a preview. The reconcile asked only "is there text?", and email recovery compared lengths. So a correction of the same length was invisible, and an older text arriving late could replace a newer one.

**What a source records now** (migration `20261113_wiki_sources_version`, two columns): `body_as_of`, when the text it holds was fetched, and `body_is_preview`, whether that text is only a preview (an email snippet).

**One rule decides which text stays** (`wikiSources.keepsHeldText`, applied inside the transaction that writes the source):

- a blank never replaces text; anything fills an empty source;
- the same text again changes nothing (the source is only known current as of the later fetch);
- a preview never replaces text, and any full text replaces a preview, whatever their order;
- of two full texts, the one fetched later wins: an older version arriving late, or replayed, never puts the source back.

**The hourly reconcile uses the same rule** (`wikiBackfill.needsLanding`): a stored item is landed when its source is missing, has no text, or holds a different text the item's is newer than. An email's full text is landed wherever the source holds nothing or only a preview; length is no longer looked at.

**Checked:** `tests/wikiSourceVersions.test.ts` and the new cases in `tests/wikiReconcile.test.ts` (same-length correction, newer shorter text, replay, out-of-order arrival; 4 of 4 mutants killed); on the production database with throwaway rows, 11 of 11 (the four cases, a preview and a full text in both orders, an encrypted text, four writers at once ending as one row with the latest text), rows removed. On production the migration dated every text already held and marked 645 email sources as holding only a preview.

**Live as D-241 and D-242 (16:19 and 16:24 PKT).** D-241's reconcile did not converge: it re-landed about 640 email texts on every run, because the old email pages for those emails hold only the same preview the source already has. D-242 makes the reconcile skip a text the source already holds. After it: two runs, both users, 0 missing, 0 texts landed; 640 email sources still say they hold a preview, which is the truth (the full email was never fetched for them; the rebuild's full read brings it). Not yet seen: a real correction arriving on production.

### 0.14 What the Wiki is not: the builders' documents (owner, 2026-11-13, 17:20 PKT)

*"agent.md is builder not knowledge so it should not be part of wiki."*

The Wiki holds what Nexeo knows about its users and their companies. The documents that tell the people and sessions **building** Nexeo how to work are not knowledge and are never put in the Wiki, never read by Brain or Suzi as knowledge, and are not counted by the ledger (§0.4, which counts the database's stores). They live in the code repository:

- `AGENTS.md` (the builders' working contract: product rules, deploy and check rules), the `CLAUDE.md` files, `APP_MENTAL_MODEL.md`, `BRAIN_VISION.md`;
- the builders' records: `brain_change_log.md`, `brain_chat_log.md`, `brain_chat_archive.md`, `brain_evaluation_chart.md`, `Changes_Made.md`, the deploy list;
- the descriptions of how the product works: this document, `Rules.md`, `INTEGRATIONS_DESIGN.md`, the charters and the agreement with Suzi.

Checked 13 Nov: none of them is in the Wiki (no page and no source holds them; three email sources match only by the word "agents"). The code names `AGENTS.md` only in comments.

The line is the one above: a user's own rules (My Rules, delegations, standing instructions) are knowledge and are in the Wiki (§0.10); the rules for builders are not.

### 0.15 Fourth outside review (13 Nov, at `b09da740`): findings answered

Advisory; plan score 88 (85 before); capability scores carried forward, none credited. Checked against the code the same hour.

| # | Finding | Checked | Owner and answer |
|---|---|---|---|
| P1 | The automatic forward (`ruleForwardJob.ts`) decides "internal" from the domains of his own accounts (a shared provider such as gmail.com would count), matches the To list by substring, reopens the daily cap when the count query fails, counts the day in the database's time zone, and can let a waiting email age out after 24 hours | **All true.** The job is committed (`b09da740`) but **not in the live build**, and no email has been forwarded by a rule | Nexeo-Builder, told 17:40 PKT: fix before it is deployed |
| P1 | Releasing a held send does not re-check the rule (paused or removed meanwhile) or the send-off switch | **True** (`suziSend.releaseHeldSend`) | Nexeo-Builder: re-check both at the moment of sending, fail closed, and prove it |
| P2 | Privacy is not proven end to end | True; it is part 12 | **Wiki session: moved first**, before rule notes |
| P2 | Rule reads stop at 1,000 and only log it | True (`RULES_READ_CEILING`) | Nexeo-Builder: return "complete or not"; no automatic action on an incomplete set |
| P2 | Connectors "All" is 20,000 emails and 10 years, not "everything" | True (`connectorRoutes.ts:232`) | Nexeo-Builder: resumable, and say "complete" or "stopped at the cap" |
| P3 | This document's last "Next step" still asked for identity, which is live; `Rules.md` kept the old 30-rule wording | True | Fixed in this commit |

- **First finding of the privacy matrix (part 12), fixed the same hour: DEF-471.** The Wiki screen's single-page and graph routes decided who may read a page by its type, so any user of a client could read another user's private project, decision, pattern, policy and attachment pages, and through the graph their people and topic pages (about 4,300 on production). Nobody read them: no second user of any client could sign in. Now they read by scope and owner only, and a test fails the build if any route shares a page by type again. The rest of the matrix (sources, marks, search, Suzi's knowledge route, the Drive export) is still to run.

- **The privacy matrix, run the same evening (part 12), result:** on the production database with two throwaway users in one client and one in another, **22 of 22** through the Wiki store (notes, backlinks, sources, trails, marks, window lists, citations, marks, removal, merge), Suzi's knowledge search, Brain's planner index and the older page read. Along the way **three more faults of the same class were found and fixed**: DEF-472 (the `/v1/wiki` routes let any user act as a colleague through a header) and DEF-473 (the concept builder, two of Brain's observations and the contacts clean-up read every user of the client). Each now has a test that fails on the old code. **Not covered yet:** the Drive export (read from code: it filters by owner) and the meaning search with real embeddings (throwaway notes have none; the query filters by owner); about 40 maintenance scripts that read across users by design and serve no reader.

The owner's latest ruling stands and the review says to keep it: **learned patterns only suggest; rules, delegations and standing instructions act by themselves within their scope.** The findings above are about enforcing that scope, not about asking him again.

### 0.16 One email, one source row; cards agree with what is known (13 Nov, CL-091, Nexeo-Builder)

- **DEF-476:** the feed kept two or three rows per Gmail message, because its dedupe hash covered the whole payload (a read/unread change or a second reader's shape made a new row). The feed now keeps **one row per Gmail message per user**. A later read fills address fields the first row lacked and calls the Wiki's intake (`landFeedItem`, idempotent), so the message is still in the Wiki even if it arrived only by that later read. Rows already doubled are left as they are (no cleanup without the owner's yes); the Wiki already holds one source per message id.
- **DEF-474 / DEF-475:** the email list that Suzi's pack and the spoken brief read from the Wiki marks, and the web's My Attention, now pass through one step (`triage/cardTruth.ts`). An email with an open task made from it shows the task's priority and line. A calendar invitation he has answered (read from his calendar) leaves the list; an unanswered one says "You haven't replied to this invitation yet." Nothing is written to the Wiki by this step (it is a read-time correction); marking answered invitations in the Wiki is a later step, not built.
- Verified: unit tests (`def474`, `def475`, `def476`) and the full suite. Not verified: the live cards after the deploy.

## 1. Owner direction (2026-11-12)

Brain has three aspects:

1. **Feed**: where information comes from (email, meetings, WhatsApp, external systems, Suzi).
2. **Wiki**: where the information is stored, organized, related and connected, the way Obsidian builds knowledge.
3. **Think**: thinks and reacts as per the wiki.

The Brain Wiki role owns aspect 2 only. In his words:

- "build wiki who contain entire knowledge of brain"
- "wiki should work like obsidian the way obsidian build the knowledge"
- "everything should be derived through wiki like Actionable items, contacts"

On 2026-11-13 he made it the rule for the whole product: "entire knowledge should be retrieve or placed in wiki", "my
strongest recommendation that entire knowledge of brain should be part of wiki (new wiki like obsidian)", "nothing
should be stored or saved outside of wiki", "create/update document of wiki knowledge and entire product including suzi
should follow it", and "create/update one document of wiki, i don't want to see redundant document".

## 2. Boundaries

| Boundary | Feed side | Wiki side | Think side |
|---|---|---|---|
| Feed → Wiki | Fetches the item (email, meeting, message, record) and hands it over once, with its source id | Decides which notes it belongs to, writes or updates them, links them, cites the source | none |
| Wiki → Think | none | Answers "what do we know about X", "what is linked to X", "what is open for X" | Decides what to say or do; writes back only through the same intake as any feed |

The Wiki does not fetch from outside and does not decide what to say or do. Feed and Think do not write notes directly.

## 3. Where the wiki stood when this work began (production, read-only, 2026-11-12)

*A record of the starting point, kept for comparison. These are not current counts; the current state is §8.*

- About 15,800 rows in `wiki_pages` for 5 users. About 7,900 are `email_message` pages: one page per email, not a note about a person, project or topic.
- 34,009 rows in `wiki_page_links`; 33,785 are type `related`. Only 4 pages carry a `[[link]]` in their text.
- About 5,100 pages have no link in or out.
- People (`persons`, 974 rows), entities (`entities`, 1,109 rows) and action items (`open_items`) are separate tables. Pages are written beside them, not above them.
- **No single door.** About 35 runtime files write `wiki_pages` directly (ingest services, scribe, composer, cognitive engine, contact sync, integrations, routes). About 50 read it directly. `wikiStorageService.upsertPage` exists but most writers bypass it.
- `obsidianVaultService` already exports contacts and eight page types to the user's Google Drive as markdown (export only).

So the boundaries in §2 do not exist in the code yet. That is the first thing to build.

## 4. Target: how the wiki works

- **A note per thing.** Person, company, project, topic, meeting, decision, commitment, instruction. One note per real thing per user (or per tenant for shared notes); duplicates are merged.
- **Sources are cited, not stored as notes.** An email or message is a source row a note points to. It is not a page.
- **Links are in the text** as `[[Title]]`. The link table and backlinks are rebuilt from the text on every write, so the text is the truth.
- **Properties** on each note (type, emails, phones, company, due date, state, owner) are the structured part, the same idea as Obsidian properties.
- **Contacts are derived**: a contact is a person note and its properties.
- **Action items are derived**: an action item is a commitment note (or commitment line in a note) linked to the people and project it concerns, with state in its properties.
- **Upkeep jobs** merge duplicates, link orphans and mark stale notes.
- **Its home is the database.** Anything Obsidian shows (backlinks, unlinked notes, the graph) is read from the notes and links stored there.

## 5. Owner decisions (2026-11-12)

1. **The wiki is the master.** Contacts and action items are derived from it.
2. **Rebuild is allowed.** Nexeo is still in testing, so the wiki may be rebuilt in the new structure instead of migrating the old pages one by one.
3. ~~**Feed and Think: leave them.**~~ **Superseded** by decision 6 and §0.6: every reader and writer of knowledge goes through the one door. Kept for the history. *As decided then:* This role does not change the feed code or the thinking code, and does not need to agree anything with them. The wiki is made strong on its own side; the others can move to it later.
4. ~~**Suzi is not involved** in this work.~~ **Superseded** by §0 (13 Nov): Suzi follows the Wiki-first rule; a change to what she receives is agreed with Suzi Master first (§0.5.3).
5. **Obsidian's way of working, inside Nexeo's database.** *Amended by §0.6 (13 Nov): the Nexeo Wiki is the default; the user's own Obsidian vault is a planned per-user option, so a note must translate to an Obsidian note and back.* As decided on the 12th: The wiki behaves like Obsidian (a note per thing, `[[links]]` in the text, backlinks, properties) but its home is the Nexeo database. It is not a vault of files, and opening it in the Obsidian app is not a goal.

~~Because of decision 3, the earlier plan to move the roughly 35 writers and 50 readers behind one door is dropped.~~ **Superseded:** the one door is required (§0.6). Every reader and writer moves behind `wikiStore`, feature by feature (§6b).
6. **The old pages go, completely (2026-11-12).** "Old pages should not be read, nor part of wiki, and should not be updated through scribe or any feed." This lifts decision 3 for whatever reads or writes the old pages: that code may now be changed.
7. **Deploy step 2c.** Done as D-209.
8. **One wiki (2026-11-12).** There is no "my wiki" and "company wiki" for the user to choose between; it is one wiki, like Obsidian. Who may read a note is still enforced underneath: a note built from one user's email, meetings and chat is readable by that user only; a shared note is readable by every user of the company.
9. **Every integration is part of the wiki (2026-11-12).** What an integration brings in becomes notes of this wiki.
10. **What is shared and what is private follows the source (2026-11-12).** An integration is set up for the client, fetched once, and used by every user: everything it brings is company information, readable by all users of that client. A connector belongs to one user: everything it fetches is that user's information and cannot be used by another user. This is the whole rule behind decision 8; no note needs any other visibility choice.

## 6. Build order

| Step | What | State |
|---|---|---|
| 1 | **The wiki's own store**: `writeNote`, `getNote`, `backlinks` in `src/services/wiki/wikiStore.ts`; `[[link]]` reading in `wikiLinks.ts`. Links are rebuilt from the note text on every write; a link to a missing note waits as unresolved and connects when that note is written; properties merge; sources cited once; private notes never linked across users. | **Built 2026-11-12, not deployed; used by the builder script only** |
| 2a | **The builder, facts only** (`src/services/wiki/wikiBuilder.ts`, run with `src/scripts/wikiRebuild.ts`): reads the stored email, calendar and chat items of one user and writes person, company, meeting and group notes, linked with `[[links]]`. No model is used: every line is a fact from a stored item, and a second run gives the same notes. | **Built and run for one user (TMC-0001, user 2) on 2026-11-12. Not deployed, not scheduled, not run for other users** |
| 2c | **The builder runs by itself**: at the end of every Scribe (after the feed pull) and once an hour for every active user. A note that is already current is skipped. The old sender-page rebuild in Scribe is still there until its readers move (§6b). | **Deployed 2026-11-12 16:22 PKT as D-209.** First automatic run 16:38 PKT: user 2, 3 notes rewritten, 321 unchanged. The Scribe path has not been exercised |
| 2d | **The Wiki screen shows the new wiki**: notes only by default (People, Companies, Meetings, Groups), the older pages behind a "Which wiki" switch; a note shows its properties, its `[[links]]` as buttons and its backlinks. Notes carry `metadata.wiki = 2`; `GET /brain/wiki` takes `set=new` or `set=old`. | **Deployed 2026-11-12 17:00 PKT as D-211.** Not yet looked at in a browser |
| 2e | **One wiki; integration records are notes**: the Wiki screen has no private / company switch in the new wiki. A record an integration stores as Context is taken into the wiki after every write (`wikiStore.adoptAsNote`): marked as a note, and linked through `**About:** [[record title]]` to the note with that title (a person, a company), waiting if there is none yet. The integration writer keeps its own identity, hashing, stale and ledger rules; the row stays `org_doc`, scope tenant, shown as "Integration records". | **Deployed 2026-11-12 17:30 PKT as D-213.** No integration has written a record yet, so the adopt step has run only in tests |
| A1 | **The Wiki's source store** (`wiki_sources`, `wiki_note_sources`; `wikiSources.ts`, `wikiIntake.ts`, `wikiBackfill.ts`): every fetched item lands as a source with its own id, conversation, time, people and text; an email's full text replaces its preview and is never overwritten by one; a transcript can be kept encrypted; a note cites its sources and the citations are its trail. The builder reads sources, not the feed queue, so history outlasts the 30-day pruning. | **Deployed 2026-11-13 10:29 PKT as D-218.** User 2: 6,919 sources (5,270 emails back to April, 471 calendar, 665 chat, 510 WhatsApp, 3 tasks), 361 notes citing them. Live check: 8 of 8 items fetched after the restart landed in the same second, emails with full text. Not yet landed as sources: attachments, meeting transcripts (`meeting_records`), integration records, conversations with Brain and Suzi. **Gap found by the second review, 13 Nov:** the first backfill ran for user 2 only, so the other user with stored items (user 3, switched off since May: 2,925 feed items, 1,924 emails with text) had no source at all, and a landing that failed was never retried. Closed by the hourly reconcile and the pruner's check (§0.7 step 2), **deployed 2026-11-13 13:00 PKT as D-223**; counts in §8 |
| 2b | **The builder, meaning**: project, topic, decision and commitment notes, which need a model to read the email and meeting text. Cost per user to be measured against the Costing Charter before it runs. | Next |
| 3 | **Contacts derived** from person notes and their properties. | After 2 |
| 4 | **Action items derived** from commitment notes, keeping the one gate agreed 2026-11-12. | After 3 |
| 5 | **Upkeep**: merge duplicates, link orphans, mark stale. | After 2 |
| 6 | **The user's own Obsidian vault as his knowledge source** (§0.6): a per-user choice in Settings; the store behind `wikiStore` is then the vault. | Not built. The existing Drive export job is the starting point |

No schema change was needed for step 1: notes are rows in `wiki_pages`, links are rows in `wiki_page_links` with `link_type = 'wikilink'`, properties and unresolved links live in `metadata`.

## 6a. Archiving the old wiki: what stands in the way (found 2026-11-12)

The owner agreed to archive the old pages and rebuild through Scribe. Before doing it, the old page types were checked against the code that reads them. They are not only knowledge; running features depend on them by type name:

| Old page type | Runtime files that name it | What depends on it |
|---|---|---|
| `entity_person` | 33 | Contacts screen and routes, WhatsApp sender recognition, the action-item gate, triage priority, day brief, Brain's composer |
| `sender_history`, `sender_topic` | 21, 20 | Triage (reads the page text), Brain's retrieval planner and composer, contacts |
| `observation` | 20 | Brain's cognitive worker, Suzi's knowledge route, prompt replies |
| `attachment_doc` | 14 | Brain's retrieval and composer, meeting digest |
| `email_message` | 11 | Brain's composer, morning brief; the only place email text is stored |
| `meeting_minutes`, `topic`, `project` | 7, 8, 21 | Rules, triage, composer, risk radar |

So archiving these now would not just thin Brain's answers. Contacts would empty, WhatsApp sender recognition and the action-item gate would lose their person records, and triage would lose its sender memory. An archive is safe only for a page type once its readers read the new notes instead. That is work in the thinking code.

**Order that follows from this**

1. New wiki keeps itself current (step 2c), beside the old one.
2. Meaning layer and a home for email text (step 2b).
3. Move readers to the new notes one page type at a time, starting with contacts (`entity_person` → `person`), then archive that type. Each move is reversible on its own.
4. The old feed writers for a type are switched off when its readers have moved.

Nothing has been archived.

## 6b. Retiring the old pages: the plan (owner decision 6)

Measured 2026-11-12: 58 runtime files select old page types by name, on about 250 lines. The heaviest are `routes/entityCatalogRoutes.ts` (23), `brainComposer.ts` (20), `brainCognitiveEngine.ts` (13), `conceptSynthesizerService.ts` (10). The work is done one feature at a time, each a separate deploy with its own evaluation-chart row, so that any one step can be undone without the others.

**A. The wiki must first hold what the old pages hold**

| Step | What | Why first |
|---|---|---|
| A1 | A store for source text (email body, message, attachment, meeting text), cited by notes and never a note itself | Email text exists only in the old `email_message` pages today |
| A1 note | The feed store is a queue, not an archive: `pruneUserFeedEvents` deletes a Gmail item after 30 days (or once decided) when its old `email_message` page exists. The builder reads the feed store today, so a person's older email history drops out of their note as items are pruned. The source store must therefore become the wiki's own lasting copy, the builder must read from it, and the pruner's "safe to delete" test must point at it | Found 2026-11-12 |
| A2 | Meaning notes: project, topic, decision, commitment (step 2b) | Without them Brain can say who and when, not what |
| A3 | Instructions, policies and company documents as notes | Brain's behaviour depends on these |

**B. Readers move to the new notes**

| Step | Feature | Main files |
|---|---|---|
| B1 | What Brain and Suzi retrieve to answer | `wikiEmbeddingService`, `suziKnowledge`, `brainRetrievalPlanner`, `brainComposer`, `brainAskRoutes` |
| B2 | Contacts and recognising a sender | `entityCatalogRoutes`, `personalContactsRoutes`, `scopedContacts`, `personIdentityService`, `senderTriage`, `brainInboxService`, `openItemGate` |
| B3 | Triage and priority | `criticalityEngineService`, `contextEnricher`, readers of the sender pages |
| B4 | Briefs | `dayBrief`, `morningBriefService`, `briefRoutes` |
| B5 | Brain's own working pages (`observation`, `answer`, `gap`, `mind_state`, `feedback`) | ~~They leave `wiki_pages` for a store of their own.~~ **Superseded by §0.3:** they stay in the Wiki, as Brain's own record notes, kept out of what is retrieved as knowledge |

**C. Old writers are switched off**, each when its readers have moved: the ingest hooks in `feedIngestionService` (person page, propagation, WhatsApp body, email body, attachments, sender pages, wiki scribe), Scribe's sender-page rebuild, the nightly scribe backfill, the concept synthesizer, the entity sweep, the meeting digest, and the mirrors that write pages (`odooWikiMirror`, integrations `contextWriter`, folder scribe).

**D. Each old page type is archived** (moved to archive tables, restorable) once nothing reads or writes it.

Order: see §0.7 (the standard and the order, which replaces the order first written here).

## 7. How the wiki prunes itself

Owner, 2026-11-12: once the wiki is built, this role decides how it keeps pruning itself so junk does not build up. The rules below are the starting position; they are fixed after step 2, when the rebuilt wiki shows what junk actually appears.

**Keep junk out at the door**

- No note per email or message. A source only adds to a note about a person, company, project, topic, meeting or commitment.
- No note for senders nobody answers: newsletters, notifications, no-reply addresses, bulk mail.
- A new note needs a reason to exist: the user wrote to or about it, it appears in two or more sources, or another note links to it.

**Every note carries its own evidence**

- How many sources cite it, how many notes link to it, when a source last touched it, and whether the user wrote or confirmed it.

**Daily upkeep job (step 5)**

| Check | Rule | What happens |
|---|---|---|
| Duplicate | Same email address, same phone number or same outside record id. **Never a matching title or name alone** (§0.7 standard 2): two notes that only share a name are listed for the user to decide | Merged into one note; links and citations move to the survivor; the merge is recorded and can be undone |
| Orphan | No links in or out, one source, untouched for 30 days | The note is archived; its source and its citation are kept |
| Stale | No new source for 90 days and nothing open against it | Marked stale; left out of what Think is given by default |
| Empty | No body beyond the title, no properties, no citation | Archived |
| Contradiction | Two notes state different facts for the same property | Flagged for the user, never auto-resolved |

**Never pruned**

- A note the user wrote, edited or confirmed.
- A note with an open commitment linked to it.
- Shared (tenant) notes.
- **Sources and citations.** Pruning acts on notes only. No source is removed by upkeep, and an archived note keeps its trail, so what was believed and why can still be read (§0.7 standard 7).
- The user's corrections, and the earlier claim a correction replaced.

**Three different things, never one flag** (§0.7 standard 7): *less relevant* (stale: left out of what Think is given by default, nothing removed), *superseded* (a later fact replaced it: kept as history), *safe to archive* (orphan or empty by the rules above).

**Archive, not delete.** A pruned note is archived with its citations and can be restored; deletion needs the owner's yes. The job records each day how many notes it merged, archived and marked stale, so the pruning itself can be checked.

The 30-day and 90-day figures are first guesses. They live in `behaviorConfig`, not in code, and are set from the rebuilt data.

## 8. State

**The first build, as it was on 2026-11-12, 09:40 PKT** *(a record of that day; current counts are under "Counted on production" below)*

For TMC-0001 user 2 only, written by the rebuild script (`last_updated_by = 'wiki_builder'`):

| Note type | Notes | Links out | Links in |
|---|---|---|---|
| person | 216 | 588 | 473 |
| meeting | 94 | 381 | 195 |
| company | 12 | 210 | 210 |
| group | 2 | 4 | 4 |

- 324 notes, 1,183 `wikilink` rows, 0 unresolved links, 4 notes with no link at all.
- Built from 3,197 stored items (email, calendar, chat). WhatsApp is not read: it is the user's own line to Nexeo.
- A second run created 0 notes and left the link and source counts unchanged.
- The 15,772 older pages are untouched, and no other user has builder notes.
- The new notes sit in the same table the existing readers use, so the Wiki screen shows them and, once the embedding job has embedded them, Brain and Suzi can retrieve them for this user.

**How the builder decides who gets a note**

- Email: only threads the user wrote in. Calendar: meetings with at least one other person, up to 25 invited. Chat: a direct chat, or two or more messages in a standing space.
- One person across addresses: the same mailbox name at one organisation (`x@tmcltd.com`, `x@tmcltd.ai`), or the same name where the addresses do not place them at two organisations. *The second is a merge on a name alone; it is against §0.7 standard 2 and goes when identity is built (step 3).*
- Left out: no-reply and notification senders, shared mailboxes and lists (`hr@`, `accounts@`, `ph.all@`), chat bots, nameless chat ids, chats opened for a single meeting, calendar invitation emails.
- A recurring meeting is one note; a calendar entry stored twice counts once.

**Known gaps in what was built**

- Integrations: only records mapped as Context become notes. KPI figures are not in the wiki yet (a note per KPI is the next integration step). The TMC Employee Directory has its two Context suggestions set aside, so it writes no record until one is approved in the wizard.
- A shared record links to the note of the user who owns the integration. With a second active user, that user's own note of the same person is not linked; the layered note (one note, a shared layer plus each reader's private layer) is the fix and is not built.
- An employee nobody has dealt with gets a record note but no person note.

- The same person under two different mailbox names is still two notes (for example `malik.irfan@` and `irfan.ahmed@`, or a work and a personal address with different spellings). The user's own personal address appears as a person. Identity (§0.7 step 3) handles these, on evidence and never on the name alone.
- A shared mailbox whose name is not a role word is taken for a person (`vm@`, "Vision Metric").
- Company notes are titled by domain (`tmcltd.com`), not by the company's name.
- Meeting notes with near-identical titles are separate notes.
- No project, topic, decision or commitment notes yet (step 2b), so contacts and action items are not yet derived.

**Verified:** `tests/wikiStore.test.ts`, `tests/wikiLinks.test.ts`, `tests/wikiBuilder.test.ts`; the counts above read back from the database after the write.

**Not verified:** how Brain's and Suzi's answers change with the new notes in retrieval; the Wiki screen showing the new types.

**Live:** steps 1, 2a, 2c (D-209), 2d (D-211, search D-212), 2e (D-213), A1 (D-218), the handshake guard (D-220), and the reconcile, the pruner's check and the citation check (D-223). Only user 2 is active, so only user 2 has notes.

**Counted on production (2026-11-13, 13:02 PKT, after D-223)**

| | User 2 (active) | User 3 (switched off) |
|---|---|---|
| Sources | 6,928: 5,278 email, 666 chat, 510 WhatsApp, 471 calendar, 3 tasks | 2,474: 1,549 email, 366 WhatsApp, 359 calendar, 200 tasks |
| Emails without their text | 0 | 0 |
| Notes | 366: 257 person, 95 meeting, 12 company, 2 group | 0 (the builder runs for active users only) |

- 9,402 sources in all; 4,228 citations; 1,222 `wikilink` rows. Shared (company) notes: 0, because no integration has written a record yet.
- **Every stored feed item has its source**: checked independently of the reconcile, by working each item's source id out in SQL for all five feeds: 0 missing. Before D-223, user 3 had none (1,971 sources and 1,648 email texts landed by the first reconcile) and user 2 lacked one email, fetched at 10:22 PKT between the first backfill and the D-218 restart, and two email texts. A second run found nothing to land.
- 4 emails are still listed by the text query; the difference is invisible trailing whitespace only (the source holds exactly the trimmed text).
- Citations that cross a client, cross a user, or put a private source on a shared note: 0 of 4,228.
- **Not yet seen on production:** the pruner's check on a real run (the daily job first runs 24 hours after a restart); a citation actually refused (none has been attempted; the three queries were run on the production database inside a rolled-back transaction).

**Current state and next step (13 Nov 2026, 17:45 PKT) — this line replaces every earlier "next step" in this document.** Live: structure parts 1 to 8 (§0.13 checklist; identity and all-or-nothing writes §0.13.2, source versions §0.13.3, marks §0.12.1). Not built: rule notes (9), meaning notes (10), the rest of intake (11), the privacy proof (12), pruning (13); the readers have not moved to the Wiki; the rebuild has not run. **Next, in this order:** the privacy matrix (12, moved first by the fourth review, §0.15), then rule notes (9) with the "You" note, then the cost check and meaning notes (10). Sections §3 and §8 above this line are records of their day, not the current state.
