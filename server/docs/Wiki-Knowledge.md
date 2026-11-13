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
| Feed (email, calendar, chat, WhatsApp, integrations, Suzi's reports) | Hands each item over once, with its source id; the Wiki decides which notes it belongs to | — |
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

Counted on production on 2026-11-13: **161 tables**. Every one is named in `src/services/wiki/wikiLedger.ts`. `tests/wikiFirstLedger.test.ts` fails when a table exists that the ledger does not name, and when the number of stores outside the Wiki goes up; the hourly wiki job logs any table in the live database that the ledger does not name. So nothing can be added outside the Wiki unnoticed, and the count can only fall.

| Kind | Tables | Rows | Rule |
|---|---|---|---|
| The Wiki | 3 | 54,897 | This is the Wiki |
| Knowledge outside the Wiki | 70 | 146,539 | Moves in as notes or sources |
| Trail outside the Wiki | 34 | 156,647 | Moves in as record notes and citations |
| Settings, identity and secrets outside the Wiki | 24 | 232 | Moves in; secrets encrypted, device signing keys stay on the device (S1) |
| Working copies (may stay) | 10 | 17,756 | May stay; the Wiki holds the record and it can be rebuilt |
| Leftover backup copies | 19 | 887 | Removed on the owner's yes |
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

Leftover backup copies (19 tables, 887 rows) are the `…_wipe_…` and `…_2026_05_2x` tables. Brain Reset (`brainResetRoutes.ts`) still creates new ones each time it runs; that stops when the reset is rebuilt on the Wiki's own archive.

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
| 1 | **One document, no contradictions.** Superseded decisions are marked; the build order follows the latest rules | Done 13 Nov (§5, §6, §6b marked) |
| 2 | **A note has a permanent identity; its title is a label.** Aliases and outside identifiers (an email address, a record id) do the matching. A link that could mean two notes stays unresolved. People are merged on evidence, never on a matching name alone | Not met: a note is found by type and title; a link picks the most recent match; the builder merges two addresses that share a name |
| 3 | **Shared and private are designed together.** One note, a shared layer and each reader's private layer. Permissions govern summaries, citations, backlinks, search and exports, not only the note. A shared summary never carries what was learned from one user's private mail | Not met: required before more company knowledge is added |
| 4 | **Facts carry their history.** An important property records its source, when it took effect, when it was recorded, and whether it was stated or inferred. A correction supersedes the earlier claim and keeps it. A commitment is completed only on sufficient evidence | Not met |
| 5 | **Everything is in the Wiki, handled by its kind.** Secrets never enter search, embeddings, model context or exports. A receipt keeps its integrity when a note is edited. A note's text, properties, citations and links change together or not at all, with a revision check so one writer cannot overwrite another | Not met: `writeNote` makes its changes in separate steps |
| 6 | **A store is retired on evidence, not on a count.** Its information and permissions were preserved; every reader and writer moved; the replacement survives replay and repeated intake; the derived view is rebuilt from the Wiki; a real user task still works. For commitments this includes state changes, authorisation and dispatch receipts | The ledger (§0.4) counts stores; no store has been retired yet |
| 7 | **Pruning protects useful history.** "Less relevant", "superseded" and "safe to archive" are different. Sources and the user's corrections are kept; merges are reversible; the 30 and 90 day settings live in `behaviorConfig` and are treated as guesses to be checked | Not met: §7 is a plan; retirement of a note is reversible |

**Order of work** (the review's, adopted):

1. Reconcile this document. **Done.**
2. Source durability: every fetched item and its text is a lasting source in the Wiki (§6b A1). **Built 13 Nov; see §8.**
3. Identity, permissions and write consistency (standards 2, 3, 5).
4. Meaning notes: projects, topics, decisions, commitments, with the history of each claim (standard 4, §6b A2).
5. Move the readers and writers, feature by feature (§6b B and C).
6. Retire the old stores, each on the evidence of standard 6 (§6b D).
7. Pruning (standard 7, §7).

It is done when the ledger shows nothing outside the Wiki **and** every row of the table above reads "met", each with its test and its check on production.

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

## 3. Where the wiki stands today (production, read-only, 2026-11-12)

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
| A1 | **The Wiki's source store** (`wiki_sources`, `wiki_note_sources`; `wikiSources.ts`, `wikiIntake.ts`, `wikiBackfill.ts`): every fetched item lands as a source with its own id, conversation, time, people and text; an email's full text replaces its preview and is never overwritten by one; a transcript can be kept encrypted; a note cites its sources and the citations are its trail. The builder reads sources, not the feed queue, so history outlasts the 30-day pruning. | See §8 |
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
| Duplicate | Same email, same phone, or same title key within one type | Merged into one note; links and sources move to the survivor |
| Orphan | No links in or out, one source, untouched for 30 days | Archived |
| Stale | No new source for 90 days and nothing open against it | Marked stale; left out of what Think is given by default |
| Empty | No body beyond the title, no properties | Archived |
| Contradiction | Two notes state different facts for the same property | Flagged for the user, never auto-resolved |

**Never pruned**

- A note the user wrote, edited or confirmed.
- A note with an open commitment linked to it.
- Shared (tenant) notes.

**Archive, not delete.** A pruned note is archived and can be restored; deletion needs the owner's yes. The job records each day how many notes it merged, archived and marked stale, so the pruning itself can be checked.

The 30-day and 90-day figures are first guesses, to be set from the rebuilt data.

## 8. State

**What exists in production data (2026-11-12, 09:40 PKT)**

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
- One person across addresses: the same mailbox name at one organisation (`x@tmcltd.com`, `x@tmcltd.ai`), or the same name where the addresses do not place them at two organisations.
- Left out: no-reply and notification senders, shared mailboxes and lists (`hr@`, `accounts@`, `ph.all@`), chat bots, nameless chat ids, chats opened for a single meeting, calendar invitation emails.
- A recurring meeting is one note; a calendar entry stored twice counts once.

**Known gaps in what was built**

- Integrations: only records mapped as Context become notes. KPI figures are not in the wiki yet (a note per KPI is the next integration step). The TMC Employee Directory has its two Context suggestions set aside, so it writes no record until one is approved in the wizard.
- A shared record links to the note of the user who owns the integration. With a second active user, that user's own note of the same person is not linked; the layered note (one note, a shared layer plus each reader's private layer) is the fix and is not built.
- An employee nobody has dealt with gets a record note but no person note.

- The same person under two different mailbox names is still two notes (for example `malik.irfan@` and `irfan.ahmed@`, or a work and a personal address with different spellings). The user's own personal address appears as a person. Step 5 (merge) handles these.
- A shared mailbox whose name is not a role word is taken for a person (`vm@`, "Vision Metric").
- Company notes are titled by domain (`tmcltd.com`), not by the company's name.
- Meeting notes with near-identical titles are separate notes.
- No project, topic, decision or commitment notes yet (step 2b), so contacts and action items are not yet derived.

**Verified:** `tests/wikiStore.test.ts`, `tests/wikiLinks.test.ts`, `tests/wikiBuilder.test.ts`; the counts above read back from the database after the write.

**Not verified:** how Brain's and Suzi's answers change with the new notes in retrieval; the Wiki screen showing the new types.

**Live:** steps 1, 2a, 2c (D-209), 2d (D-211, search D-212) and 2e (D-213). Only user 2 is active, so only user 2 has notes.

**Next step:** §6b A1, the source-text store, then A2, the meaning notes with a cost check for one user. Owner looks at the notes for user 2. Then step 2b: measure what a model pass over the engaged email threads and meeting notes costs for one user, and build project, topic and commitment notes from it.
