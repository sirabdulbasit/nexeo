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

**Owner, 19 Nov 2026: "can we make it configuration for a user so we can use Nexeo Wiki or he can use obsidian as wiki
(through integration etc)".** Nexeo-Builder's proposal; NOT built, waits on his choices:
- **Setting per user:** `knowledge_source: nexeo | obsidian` (Settings → Knowledge), default `nexeo`.
- **How the vault is reached** (Obsidian is files on his computer; the server cannot read them on its own). Options:
  (a) a Git-backed vault (the Obsidian Git plugin, a private repo Nexeo pulls and pushes); (b) a synced cloud folder
  (Google Drive or Dropbox, through the existing connectors); (c) Suzi on his Mac reads and writes the vault folder and
  syncs it with Nexeo (needs Suzi's agreement). Recommended: (a), it is the only one with history and clean two-way merges.
- **What "Obsidian as wiki" means.** Recommended: two-way mirror. Nexeo keeps its index (search, sources, marks,
  encrypted identity, company knowledge shared by the client's users, Suzi's pack all read it at speed); every note is
  written to his vault as Markdown with front matter and `[[links]]`, and his edits in Obsidian come back as edits
  (his edit wins; a conflict becomes a note for him). The alternative, the vault as the ONLY store, would make every read
  a file read and leaves encrypted sources and company-wide knowledge with nowhere to live.
- **Owner of the build:** the Nexeo Wiki session (it owns the Wiki store); option (c) also needs Suzi Master's AGREE.

**Owner's ruling, 19 Nov 2026: "if wiki is obsedian then nothing should be recorded in Nexeo wiki everything should
read/write on obsedian wiki".** So the mirror above is dropped: for a user on Obsidian, his vault is the ONLY store.
Every read and write goes through the one door (`wikiStore`) to his vault; Nexeo keeps no copy of his notes or sources.
What this needs, still to be decided or built:
- **Reach:** the server must reach the vault at every read (a Git repo or a cloud folder; a vault only on his Mac is
  reachable only while the Mac is on).
- **Speed and search:** no Nexeo index, so search reads his files; slower, and a pack or brief waits on it.
- **Things with no place in a plain vault:** encrypted identity (voiceprint, faceprint), rule marks on emails, company
  knowledge shared by the client's users. Each needs a home in the vault (encrypted files, a folder per company), or
  stays a stated exception.
- **Switching:** moving a user from Nexeo Wiki to Obsidian exports his notes into the vault and then deletes them from
  Nexeo; moving back imports them.

**Owner's ruling, 19 Nov 2026 (settles the above):** two kinds, exactly one configured per user at a time.
1. **Nexeo:** the wiki stays inside Nexeo (today's store).
2. **Obsidian:** kept outside Nexeo, connected to his Obsidian vault; ALL of the user's knowledge and data lives there.
3. **Always in Nexeo, whichever kind:** voiceprint, faceprint and learning (what Nexeo and Suzi learn about how he works:
   the profile note "How to work with <user>", learned preferences, `learned.*`).
**Owner's answers, 19 Nov 2026 (for an Obsidian user):**
- Company knowledge is part of the vault too.
- The search index exists only for a Nexeo wiki. For Obsidian, Nexeo and Suzi fetch directly from the vault every time;
  no index or embeddings are kept in Nexeo.
- Sources (email text, calendar, attachments) are linked with the vault too, not kept in the Nexeo wiki.
- Vault unreachable: Suzi and Nexeo say "Obsidian is unreachable". They do not answer from a copy.
- Where the vault lives: in Obsidian's own cloud (Obsidian Sync, bought by the user).
**Open technical point (Nexeo-Builder, 19 Nov):** as far as we know, Obsidian Sync has no public API, and vaults can
be end-to-end encrypted. So Nexeo can reach the vault in only two ways:
1. a sync client on Nexeo's server, signed in to the user's Obsidian account (it needs his login and the vault
   password, if one is set);
2. through Suzi on his Mac, reading the copy that Obsidian keeps there (unreachable when the Mac is off).
**Owner chose 2, 19 Nov 2026:** no vault files on Nexeo's server. The vault is read and written through Suzi on his Mac.
It is unreachable whenever the Mac is off, for scheduled jobs too. Proposed to Suzi as link T42. **Both sides AGREED, 19 Nov 15:03 PKT (round 2)**:
- notes are identified by the id in their frontmatter;
- the Mac answers list, find, read, write, status, changes, search, get_file and put_file over the live link (10 s, then unreachable);
- his edit wins, and Nexeo writes only inside its marked block;
- delete moves a note to `.trash/` and never destroys it;
- limits: 48 KB per part, 2 MB per note, 10 MB per file;
- search may use macOS Spotlight, which stays on the Mac.

Suzi starts with the read-only calls. Writes, and the Nexeo side, wait for the owner's six scope answers.

**Owner, 19 Nov 2026:** *"for those who has obsedian they already has mechanism to provide information to obsedian over the night so when suzi wakeup it connects obsedian, it will be updated. what suzi do or get any instruction that should be part of Obsedian as an update so Obsedian as a knowledge and brain can work."*

Read as:
- Obsidian users have their own overnight feed into the vault, so the vault is already current when Suzi wakes.
- Everything Suzi does, and every instruction she gets, is written to the vault as an update. The vault is the user's knowledge and brain.

This answers (b): rules and tasks also live in the vault. Voiceprint, faceprint and learning stay in Nexeo (ruled earlier).

**Owner, 19 Nov: two models of Suzi.**
1. **Nexeo Owned Data:** the wiki is the Nexeo wiki. This is how everything works today.
2. **Client Owned Data:** the wiki is the client's Obsidian vault, and Suzi uses it.

The per-user wiki kind is the choice between these two models.
**Owner, 19 Nov: "client owned data model will only run when mac is ON".** So (a) is answered too: anything that reaches
Nexeo for a Client Owned Data user while the Mac is off is not held.

**Owner's answers, 19 Nov, settling Client Owned Data (they supersede the Nexeo-side vault reads above):**
- **(e) Nexeo reads nothing from the vault.** Only Suzi accesses it, locally on the Mac, and answers from it.
  The `vault_*` calls are Suzi's own. Nexeo does not send them.
- **(c) Email and other data are read through the vault.** Nexeo still sends email through its connectors, but a
  Client Owned Data user's connectors are not scribed: the user is created as "external knowledge", so nothing from
  them is written to the Nexeo wiki.
- **(d) Company knowledge** stays outside Nexeo, in the vault.
- **(f) No wiki moves.** Nexeo Owned Data users keep the Nexeo wiki.
- **(h) The user feeds the vault themselves**, for example with scheduled jobs in the Claude desktop app.
- Unchanged: voiceprint, faceprint and learning stay in Nexeo.

**What Nexeo must build:**
1. A per-user "external knowledge" setting, chosen when the user is created.
2. For that user, the wiki intake, scribe and builders are skipped.
3. Connectors stay available for actions such as sending email.

Built by both sessions. The Wiki half is live as D-302: one guard (`services/wiki/knowledgeModel.ts`) and Wiki tables that refuse external rows.
The Nexeo-Builder half is D-303 (3186c2ab):
- every per-user job and poller skips the user, and skips its whole cycle (logged) when the list can't be read;
- the fetch points `ingest`, email body, scribe backfill, cognitive tick, entity, ask side effects and connector scribe return early;
- day-pack and changes answer the agreed body.

`tests/externalKnowledgeGates.test.ts` fails when a new job neither asks the guard nor is listed as exempt with a reason.
Live acceptance is owed: the Nexeo Wiki session runs the agreed test case after D-303.

**Owner, 19 Nov (g): "obviously when mac is off nothing could be run".** For an Obsidian user, Nexeo keeps no working
copy of rules, tasks or contacts. While the Mac is off, no rule runs, no reminder fires, and the Action Center and the
brief say "Obsidian is unreachable".

Still open: what Nexeo itself receives while the Mac is off (a WhatsApp message, a meeting transcript), unless his overnight feed covers those.
Not built; the Nexeo Wiki session builds it after the AGREE.

**Checked by the Wiki session, 19 Nov (web search of Obsidian's help pages and launch coverage; nothing installed or tried):**
- **Still no public Sync API.** But Obsidian has shipped an official headless Sync client, **Obsidian Headless** (npm `obsidian-headless`, command `ob`, open beta since about February 2026, Node.js 22 or later). It signs in with an auth token (`OBSIDIAN_AUTH_TOKEN`), supports end-to-end encrypted vaults (the vault password is given at setup), and is meant for servers, pipelines and agents. So way 1 has an official tool; no reverse-engineered client is needed.
- **It works by replicating the vault's files to the machine it runs on.** On Nexeo's server that is a full file copy of his vault on our disk. His ruling says Nexeo keeps no copy and never answers from one, so way 1 needs his word on that folder: allowed as a working mirror (and then "unreachable" means the sync is stale or signed out), or not allowed (then only way 2, Suzi on the Mac, fits).
- Limits reported, not verified by us: it counts as one of the vault's connected devices; it must not run on a device that also runs the desktop app's Sync; it is beta. Node on this server is 20, so it would need Node 22 beside it.
- Way 2 (Suzi on the Mac) keeps nothing on our server but is a contract change (Suzi's AGREE first), and the Wiki is unreachable whenever the Mac is off or asleep, including for Nexeo's own scheduled jobs.
- Not accepted: community clients (Go `obsidian-headless`, `ob1`, `obsync`): unsupported by Obsidian, and they would hold his account and vault password.

**The Wiki session's changes to the T42 shape, sent to Nexeo-Builder 19 Nov while the contract is open (PROPOSAL; nothing agreed or built):**
1. **Identity is the note's id in its frontmatter, never its path.** He can rename or move a note in Obsidian; the path is a label (standard 2). So a lookup by id is needed: `vault.find {id | ids | type}`. The Mac may keep its own in-memory map; Nexeo keeps none.
2. **`vault.list` must carry what a rebuild compares**: path, content hash, modified time, frontmatter id and type, recursive, paged with a cursor. Without it "a repeat run writes 0" would mean reading every note every hour.
3. **Frames are small (parts under 14 KB today).** `vault.read` and `vault.write` need parts, and `vault.put_file` / `vault.get_file` for attachments, with a stated size ceiling.
4. **Missing verbs:** `vault.move` (retire to an archive folder), `vault.delete` (forget: profile key, a conversation, a source), `vault.status` (reachable, vault name, note count, Obsidian running), `vault.changes {cursor}` (what he edited since, so his corrections are read).
5. **Writes:** `if_match` on the content hash, `if_none_match` to create only; the answer returns the new hash; a mismatch returns the current text. Proposed conflict rule: **his edit wins.** Nexeo owns only a marked block in a note it wrote and never touches text outside it.
6. **Errors are named:** unreachable, vault_missing, conflict, too_large, denied, not_found. Paths are relative to the vault; `..` and `.obsidian/` are refused on the Mac.
7. **Suzi answers her own knowledge questions from the vault on the Mac**, without a round trip to Nexeo (today's knowledge route would go Mac → Nexeo → Mac).
8. **Search is by words and links only** (no index, his ruling); results give path, id, title, the matching lines.

**For the founder before any build (asked through Nexeo-Builder):**
- **What arrives once while the Mac is off** (a WhatsApp message, a meeting transcript, a Suzi turn): "nothing queued on Nexeo" means it is lost. Gmail and Calendar can be fetched again later; these cannot. Allow a short encrypted waiting box with an expiry, or accept the loss.
- **The working stores**: rules, tasks (Action Center), contacts. If they too live only in the vault, a rule cannot forward and the Action Center is empty whenever the Mac is asleep. Proposed: they stay in Nexeo as working copies, like learning.
- **Sources**: the text of about 7,000 emails and 500 attachments written into the vault through the Mac, or a link back to Gmail and Drive only.
- **Company knowledge** in one user's vault is invisible to the client's other users.
- **Sensitive records** kept encrypted in Nexeo today would be plain files in the vault.
- **Moving over**: his existing Wiki (about 1,600 notes, 9,700 sources) is exported to the vault and then deleted from Nexeo, or he starts empty.

**Suzi's AMEND round 1 on T42 (19 Nov 15:00 PKT; agreed in principle, nothing built), and the Wiki session's reading:** Suzi proposes the existing link (`tool_call`/`tool_result`, 10 s then `vault_unreachable`), `.md` only, 200 KB a note, list 500, search 20, a side copy on conflict, `written_by`/`written_at`, folders People/Projects/Meetings/Company/Sources/Inbox, never a delete or a rename. Nexeo-Builder accepted these. Four of them break what the Wiki must do, sent back through Nexeo-Builder the same hour: (1) no delete means **forget does not exist** for an Obsidian user and no note can be retired: proposed `vault.forget` only on notes written by Nexeo, into Obsidian's own trash, and retirement as a frontmatter status; (2) a side copy on every conflict multiplies hourly and gives two notes one id: proposed no write on conflict, the current text returned, his text kept, Nexeo's marked block rewritten; (3) list of 500 without a cursor cannot cover the vault; (4) the layout has no folder for tasks, decisions, topics, documents, rules, conversations. Not agreed yet.

**Built by the Wiki session, 19 Nov 2026 (Nexeo side of Client Owned Data; BUILT, not deployed at this commit):**
- **The flag:** `users.knowledge_model` (`'nexeo'` default, `'external'`; CHECK constraint). Migration `20261119_users_knowledge_model`, hand-written, additive, **applied to production 15:40 PKT and run twice**; both existing users read `nexeo`. No new table.
- **One guard:** `src/services/wiki/knowledgeModel.ts`: `isExternalKnowledge(clientNumber, userId)`, `externalUserIds(clientNumber?)`, `externalKnowledgeBody()`, `EXTERNAL_KNOWLEDGE`. **It fails closed:** no row, another client's user, a bad id, an unknown value or a database error all read as external. `externalUserIds` throws instead, so a job skips its cycle rather than treat everyone as Nexeo Owned Data.
- **Chosen once:** `authService.createUser` takes `knowledgeModel` and writes it in the same transaction as the user row; if it cannot be set the user is not created. The admin create-user route and form carry the choice. There is no setter: a test walks `src` and fails if any other file writes the column.
- **The Wiki's two doors refuse:** `saveSource` and `writeNote` refuse a Client Owned Data user's data before anything is written (`ExternalKnowledgeRefused`), so a writer that forgot to ask the guard still stores nothing. **What stays in Nexeo** goes through: identity records (voiceprint, faceprint), his profile lines and the "How to work with" note, and the learned rows and notes.
- **The hourly work skips him:** the reconcile does not read his feed items; the build runs only the learned step; company notes are never written in his name.
- **Routes:** Suzi's `/knowledge` and every portal Wiki route answer the one agreed body (HTTP 200, `{external_knowledge: true, knowledge_model: "external", message}`), reads and writes alike.
- **Checked:** `tests/knowledgeModel.test.ts` (13) and `tests/knowledgeModelCreateUser.test.ts` (6); seven mutants killed (each door removed, guard failing open, reconcile gate removed, any typed record kept, unset model ignored, a second setter). Tree: tsc clean, 5,514 tests passed, 0 failed.
- **Not built here (Nexeo-Builder's, with the same guard):** the feed poller and the other jobs switched off for him, the day pack and changes routes, the portal line.
- **Not verified:** nothing has run for a real Client Owned Data user: none exists. The agreed acceptance case (create one, connect Gmail, two poll cycles and one hourly build, 0 rows in every store, a send still works, profile and identity still store) is owed after both halves are live.
- **Known gap:** Suzi's `device.report` is stored as a Wiki record and is neither identity nor learning, so for a Client Owned Data user the door refuses it. Whether it is kept is not ruled; told Nexeo-Builder.

**Reviewed before deploy, 19 Nov (five reviewers over `bdbc6135`, each finding checked by a second reader; 21 reported, 14 confirmed), and what changed (DEF-512):**
- **The claim "a writer that forgot to ask the guard still stores nothing" was false.** About a dozen older writers insert into `wiki_pages` directly (the feed hooks, Scribe and its backfill, the cognitive worker, contacts, the ask route's side pages, the Drive and integration documents, the Odoo mirror) and never reach `saveSource` or `writeNote`.
- **Fixed in the structure, not caller by caller: the tables refuse.** Migration `20261119_wiki_refuses_external_knowledge` puts a trigger on `wiki_pages` and `wiki_sources`: no row is inserted, or moved to him, for a user whose model is not `nexeo`, whoever the writer is. Identity, profile and learned rows pass (the same rule as the code doors); a user that does not exist is refused. **Applied to production 19 Nov 16:25 PKT, run twice.** Rehearsed first inside a rolled-back transaction: 13 cases, all as wanted, nothing left behind.
- **Also fixed in code:** documents written in his name (`tenantOrgDoc`, `adoptAsNote`); the shared-note writers (`wikiRuleNotes`, `odooWikiMirror`) never pick him, so a mixed client keeps its shared notes; the portal's real Wiki routes (`/brain/wiki/*`; the first build guarded only the unused `/wiki/*` router) answer the agreed body; a model that cannot be read is an error in the hourly work (`skipsWikiWork`), not "he is Client Owned Data"; the create-user form sent an empty expiry, which the server refuses, for every permanent user (a fault older than this work).
- **Passed to Nexeo-Builder** (its files; the tables now refuse regardless, but these would still fetch his mail and then fail to store it): gate `feedIngestionService.ingest` before the fan-out, `emailBodyIngestService` (it catches the door's refusal and carries on), `backfillUserScribe`, `runCognitiveTick`, `ensureEntityForSender`, the ask route's side effects, the connectors scribe route; callers that omit the user id (`whatsappService`, `feedRoutes`).
- **The triggers do not cover** `feed_events`, `open_items` and other stores outside the two Wiki tables: Nexeo-Builder's gates.
- **Rejected by the second readers** (7): mostly gaps in tests of routes; the route gates have no test of their own yet.
- **Found on the way, not fixed (needs the founder's word):** 40 Wiki rows belong to users that no longer exist (ids 1, 4, 5: 15 sources, 26 pages). The user id counter stood at 4, so the next user created would have been given id 5 and would have read the deleted user's 9 pages. The rehearsal's two rolled-back probe users moved the counter to 6, so ids 5 and 6 are now skipped; the rows are still there.
- **Checked after the fixes:** tsc clean; 5,515 tests passed, 0 failed; `git diff --check` clean.

**Both halves live (D-302 Wiki session, D-303 Nexeo-Builder, 19 Nov 16:34 PKT). Probe of the whole path, 16:45 PKT, with a temporary Client Owned Data user (created by `createUser`, removed afterwards):** his email handed to the feed intake is refused (`external_knowledge`); the scribe backfill creates nothing; no contact is created; after reconcile and the hourly build he holds **0** Wiki pages, **0** sources, **0** feed items, **0** open items. **Still NOT run: the agreed acceptance case with a real mailbox** (a Client Owned Data user signs in and connects Gmail, two poll cycles, one hourly build, a send through the connector). It needs a real person and mailbox to sign in; I cannot connect one for him.

**Owner's answers, 19 Nov 2026 (recorded by Nexeo-Builder):**
1. **A user may switch models after creation: "yes".** NOT BUILT. Today `knowledge_model` is set only by `createUser` and the triggers treat it as fixed. Owed: a switch on the user (admin only), and what happens to rows already held in the Nexeo Wiki when a user moves to Client Owned Data (his earlier ruling "no wiki moves": they stay, unread and not added to), and the reverse (Nexeo starts from empty). Suzi learns the change through `wiki_kind` in `device.report` (T42), so the switch is a contract change: it is agreed with Suzi before it is built.
2. **The real-mailbox acceptance case runs "through Nexeo connector":** the test user connects Gmail in Nexeo's own connector, and the send goes through that connector. Nothing outside Nexeo is used.

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
| 10 | Meaning notes: project, topic, decision, commitment (action items), each fact with its history | Live 13 Nov (§0.13.7); $0.34 for his whole history |
| 11 | Integration, KPI and business-unit notes; transcripts, attachments and conversations as sources | Live 16 Nov (§0.13.8, D-268 to D-271); conversations with Nexeo or Suzi wait on his word |
| 12 | Proven private: two users and two clients through every path | Run 13 Nov: 22 of 22; four faults found and fixed (DEF-471 to 473); Drive export and meaning search read from code only (§0.15) |
| 13 | Self-pruning that keeps sources and history (§7) | Live 16 Nov (§0.13.8); first run archived 13, marked 367 stale |

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

#### 0.13.8 Parts 11 and 13 LIVE (D-268 13:51 to D-271 14:19 PKT): transcripts, documents, systems, KPIs, business units, company names, upkeep (Wiki session, 16 Nov 2026)

Owner, 16 Nov: *"complete entire wiki at once."* Built in one change, run inside the hourly Wiki job (reconcile, then build):

- **Meeting transcripts** (`wikiTranscripts.ts`). Every Meeting Assistant record (F-4) that holds a transcript is one `transcript` source, keyed by the record, text **encrypted at rest** (F-4.10), with the minutes, decisions and action items in its details. A record he deletes takes its source with it (`removeSource`). The meeting's note (by its calendar series, else its title; a recorded meeting with no calendar entry gets a note of its own) cites the transcript and shows **Meeting notes** per occurrence: minutes, what was decided, action items with their state. The decisions and action items become **decision and commitment notes** with no second model reading: his *skipped* is dropped, his *accepted* is his task (also read from his Action Center), a *proposed* item is open and says it is not yet accepted. Text from a transcript is shown, never read as `[[links]]`.
- **Documents** (`wikiDocuments.ts`). Every attachment whose text was read is an `attachment` source, its id the email and the file name (read twice = one source; a later version = a second source). It is landed where the attachment is read (`attachmentWikiService`) and, as a catch-up, by the hourly reconcile from the reader's pages. One **`document` note per file name**: kind and pages, who sent the latest and when, the email it came with, every version, the **projects** whose conversations it came in, and its opening lines; it cites its attachments and their emails. Not documents: calendar invitations, reactions, images, text under 80 characters.
- **Systems, KPIs and business units** (`wikiSystems.ts`), the company's, so **shared (tenant) notes**, written by the client's first active user like the rule notes. A `system` note per integration (what it is, its state, its last run, its KPIs); a `kpi` note per KPI (unit, period, direction, latest figure, the last 12 periods, a table by business unit); a `business_unit` note per unit the figures name, with its figures. Each KPI's readings are one company `record` source, cited by its KPI and unit notes. A name another note already has gets its kind added ("TMC Arabia (business unit)"). The integrations' own Context pages stay theirs (`contextWriter`), already taken in as notes. Facts only, no model.
- **Company names** (`wikiCompanyNames.ts`). A company note is titled by the organisation's name, read once per company by Gemini Flash from the ends of its people's emails (signatures), kept as a `meaning` mark keyed `company:<domain>` so it is never paid for twice (at most 10 per user per run). When the model is not sure, the domain stays the title. The domain stays the note's identity and an alias, so the rename keeps the note and its links; people's notes link to the name.
- **Closing across conversations** (`wikiMeaning.ts`). A later conversation that says a task was done (without naming who) closes the open task of the same words (75% of the shorter one's words), citing both and saying so, unless he keeps it open in his Action Center.
- **Daily upkeep, part 13** (`wikiUpkeep.ts`), once a day after the day's first build, as §7 says, with the thresholds in `behaviorConfig` (`wiki.orphan_days` 30, `wiki.stale_days` 90, first guesses):
  - *archived* (restorable): an orphan (no links either way, at most one source, newest source older than 30 days) or an empty note. The builders leave an archived note archived until they have something new to say of it; then it comes back and its archive mark is cleared;
  - *stale*: no new source for 90 days and nothing open: marked (`metadata.upkeep.stale`), nothing removed;
  - *for him, never resolved by itself*: two people with the same phone, people the build found possibly the same, two readings of one task in one conversation that disagree;
  - never touched: shared notes, rule notes, commitments, a note he wrote or confirmed, a note linked to an open commitment; never a source or a citation;
  - every run is recorded as a `record` source, "Wiki upkeep, <day>", with its counts and lists.
- **Tests:** `tests/wikiPart11and13.test.ts` (18), `tests/wikiReconcile.test.ts` (part 11 landers stubbed there).
- **Read-only trial on production before the deploy (founder, 16 Nov 13:45 PKT):** 2 of 7 meeting records hold a transcript; 316 of 496 attachment pages are documents, giving 150 document notes; 2 system notes (TMC Context, TMC Employee Directory), 1 KPI note (New Hires by Business Unit), 9 business-unit notes; the upkeep would archive 13 orphans (3 people, 4 topics, 4 meetings, 2 projects) and mark 277 notes stale, with 2 disagreeing task readings for him.
- **Live on production, 16 Nov (founder):** 2 transcript sources (encrypted), 186 attachment sources, **150 document notes**, **2 system, 1 KPI, 9 business-unit shared notes** (192 readings), meeting notes with their minutes, decisions and action items from the recorded meetings; the first upkeep archived 13 notes and marked 367 stale ("Wiki upkeep, 2026-11-16"). Company names: TMC is named; for 9 others the model was not sure and for 10 there is no email of their own, so they keep their domain (by design: never guess). Cost of the day's model reading: about $0.03.
- **Run twice, it writes nothing** (verified 14:19 to 14:21 PKT, three runs after D-271): 0 written, 0 read, 0 retired for people, companies, meetings, rules, meaning, documents and systems. Getting there found DEF-481 (`rebuild-not-idempotent`): emails of one moment came back in any order and changed a conversation's fingerprint (a paid re-read every run since 13 Nov), one ask put to two people shared one identity, a key-order compare, and a dropped company name. All fixed; the store now refuses to let a former name override a note's own identifiers.
- **Private, checked live:** a document, a meeting and a transcript are read by their owner only; systems, KPIs and business units by every user of the client; nothing by another client; transcript text is encrypted at rest.
- **Not built, and why:** "stale" is marked but readers (Think, Suzi's pack) do not yet leave stale notes out: that is the readers' step. Conversations with Nexeo or Suzi as sources wait on his decision (§0.13.1). A graph view and a "these two are one person" screen are screens, not structure: the lists they need are in each day's upkeep record. Two documents with one generic file name ("Invoice.pdf") from different people are one note.

#### 0.13.7 Part 10 is LIVE (D-255, 19:51 PKT): projects, topics, decisions and commitments (Wiki session, 13 Nov 2026, evening)

`src/services/wiki/wikiMeaning.ts`, run with the other notes. The first notes the model writes.

- **One model call per conversation he wrote in**, not per email, on Gemini Flash. The answer is kept as a `meaning` mark on the conversation's newest email with a fingerprint of the conversation, so an unchanged conversation is never paid for twice; a changed one is read again. At most 60 conversations are read per user per run.
- **What the model says is checked before it becomes notes:** malformed answers, one-letter names, unknown states and dates that are not dates are dropped, never guessed. It is told to use only what the conversation says.
- **Four note types, linked to each other and to the people:** `project` (summary, status, people, decisions, commitments, conversations), `topic`, `decision` (what, by whom, when, which project), `commitment` (what, owed by, owed to, state, due, evidence, last activity). Each cites the emails of its conversation. A commitment he owes says "you".
- **Old requests are not open items** (his ruling: read the whole history). A commitment is open only when the conversation did not close it and it had activity in the last 60 days (`OPEN_WINDOW_DAYS`, a first guess); otherwise it is kept as history.
- **Names that clash** with another note (a project named like a person or a mailbox) get their kind in the title, so links are not ambiguous.

**On production, 13 Nov 19:33–19:50 PKT, for the founder, his whole history:** 371 conversations read, **$0.34 in all** (402 calls, 0 failed). **72 projects, 155 topics, 48 decisions, 341 commitments**: 160 open (60 of them his own), 74 done, 7 dropped, 100 kept as history. 1 link of 616 notes still waits for its note. Checked: `tests/wikiMeaning.test.ts` (7 tests, model mocked).

**Checked against his own word the same evening, and corrected (meaning-v2).** He went through his Action Center at 19:00 (with Nexeo-Builder): 13 tasks his, 8 someone else's ("watch"), 10 closed at his yes. The first build matched only 6 of his 13, gave him 4 of the 8 that are not his, kept 7 closed ones open, and listed 50 more "his" open items. Four causes, all fixed:

1. **Brain's own mail was read as his conversations:** the Day Brief, "Intervention needed" prompts and alerts are sent from his address to himself (244 threads). They are no longer conversations.
2. **Who owes a task:** the model now gives a task to the person it is put to (named, or the To recipient), never to someone only in Cc; a delegation he gives is his follow-through, with the delegate named.
3. **His word wins over the model:** his Action Center rulings are read with the conversation each came from (`loadRulings`): his own open tasks stay open and his, a "watch" goes to the person he named, a task he closed is done. A task he confirmed that the model did not find becomes a commitment note from his list. A rebuild cannot bring back what he ruled.
4. **One task in several conversations is one commitment**, citing them all.

After the fixes, against his rulings: **13 of 13** of his tasks are open notes owned by him; none of the 8 "watch" tasks is his; every task he closed is closed (two he named as open, Green Belt sponsor and the Vision Metric feeds, stay open). 31 further open asks to him were found that are not in his Action Center; each note says whether he ruled on it (`ruledBy`), so readers can tell confirmed from new. Re-reading everything with the corrected prompt cost $0.26; meaning notes have cost $0.60 in all.

**Not yet:** the Action Center, the brief and Suzi still read action items from `open_items`, not from commitment notes (moving them is the readers' step, Nexeo-Builder's); a commitment's open or done state is the model's reading of one conversation, not yet joined with replies in other conversations; meetings' transcripts are not read yet (part 11).

#### 0.13.6 Part 9 is LIVE: every rule is a note (Wiki session, 13 Nov 2026; D-250, 18:22 PKT)

`src/services/wiki/wikiRuleNotes.ts`, run with the other notes (after every Scribe and every hour). One note of type `rule` per rule, carried over from the stores that hold rules today, facts only, no model. Each note says:

- **what kind it is:** standing instruction, rule, delegation, permission, learned pattern, or system rule;
- **whether it acts by itself**, by his ruling of 13 Nov 17:10: yes for everything that is on, except a learned pattern, which only suggests;
- what it applies to (`[[linked]]` to the person or company note when there is one), what it does, his own words, who set it and when;
- the store and row it is kept in, as its outside identifier. A typed instruction and the email rule made from it are one note.

Company and system rules are shared notes, written once per client. Removed rules are not notes; a rule that disappears from its store is retired. The stores stay the working copy that acts (`Rules.md`); moving the readers to the notes is the step after.

**On production, 13 Nov 18:40 PKT, for the founder:** 63 rule notes: 8 standing instructions (5 acting, 3 paused), 33 rules (31 muted senders, 2 email rules set through Suzi), 2 learned patterns (suggesting only), 2 WhatsApp permissions, and 18 system rules shared with the company. A second run changes nothing. Checked: `tests/wikiRuleNotes.test.ts` (5 tests; a mutant that lets a pattern act is caught).

Not yet: rules of the integrations, the "how to work with you" note (Nexeo-Builder writes it from Suzi's profile.update), and readers reading the notes instead of the stores.

**Company notes got their trail the same evening:** a company cites every source its people's notes cite (on production tmcltd.com cites 950); only 1 note of the builder's is left without a citation. Lists inside a note are now in a stable order (newest first, then by name), so a build that changes nothing writes nothing: three runs in a row wrote 0.

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

### 0.17 Where a task came from, read from the Wiki (14 Nov, F-2.5a, Nexeo-Builder)

- Suzi's pack `actions[].source` (charter F-2.5a, agreed 13 Nov) is `{kind, from?, subject?, at?, thread_id?, meeting_id?}`, and Suzi shows it on the task card as "From". Built in `suzi/actionSource.ts`.
- **Read order, Wiki first:**
  1. the Wiki's email source (`wiki_sources` kind 'email') for the exact message, found by its feed row id or by the task's message id. This gives from (display name, else the address), subject (120 characters at most, with byte-order marks removed), at (with his offset), and the thread;
  2. else the feed row, which retention removes after a while;
  3. else a Wiki email of the same thread: subject and thread only, with no from and no at, because which message asked is not known.
- Meeting tasks give the meeting id and when it was held. Suzi and manual tasks give the kind and when the task was made. Body text is never included. An unknown origin, or a read that fails, leaves `source` out and the action unchanged.
- When actions move to commitment notes, the source becomes the note's first citation. That move is not built yet.
- **Meeting rules (F-4.2, 14 Nov):** a `meeting_attend` rule set through Suzi becomes a rule note at once: `rebuildRuleNotesForUser` runs after rule.set and after rule.remove (email rules included), not only at the hourly build. *(Correction, 16 Nov: for email rules it ran only after rule.remove until DEF-492 fixed rule.set.)* The note says what the rule applies to (the organizer's or attendee's email, the title words, or every meeting with a join link) and what it does (take notes, or never). See `Rules.md` §8.
- Verified: `f25aActionSource.test.ts` (8 tests) and the full suite. A read-only run on his real list gave 13 of 13 tasks a source, all from the exact message in the Wiki; the 3 oldest have no feed row any more. Not verified: Suzi's card showing "From".

### 0.18 Fifth outside review (16 Nov, at `53d24ff6`): every finding answered

Advisory; its verdict: progressive structure, material correctness findings, end-to-end Wiki-first behaviour PARTIAL. **Agreed.** Each finding was checked against the code before it was acted on.

| Finding | Checked | What was done | Evidence |
|---|---|---|---|
| P1 Unrelated tasks merged or falsely closed (word overlap) | Confirmed in code; the reviewer's Alpha/Beta case reproduced; a second path found (two tasks sharing only a title were folded by the one-title filter) | DEF-482, D-272: words only find a candidate; one task only with shared context (conversation, project, or a person other than him in both); a later "done" closes only with a shared project and the owner present, else `possiblyDoneIn` for him; same-title tasks stay two notes | Negative tests (Alpha/Beta, no shared person, owner absent, two projects one title), mutation-checked; live 341 tasks (7 split again), 0 closed across conversations |
| P1 Same-name files treated as one document | Confirmed (`document:<name>`) | DEF-483, D-272/D-274: versions only with the same name and the same sender (his addresses count as one) or the same conversation; titles told apart by sender, then date | Tests: two invoices stay two, a revised invoice keeps one identity; live 152 documents |
| P1 Unchanged summary leaves provenance outdated | Confirmed; and a live instance of the same class: whole-note writes merged old properties (a task kept `ruling: closed`) | DEF-484, D-272/D-273: "unchanged" = text, properties, ids, scope and the exact set of cited sources, in every builder and for archived notes; whole-note writes set properties exactly | Tests: new source = change, property-only correction = change, unchanged = no write; repeat runs write 0 |
| P1 Connect the structure to its consumers before calling Wiki-first complete | Agreed: my "all 13 parts live" was true of the structure and read as more | Wording corrected below and in §8: the STRUCTURE is built; **Wiki-first behaviour is PARTIAL** until each reader moves, one at a time, with parity evidence, and the old authority is retired only after that. Readers are Nexeo-Builder's; told the same day | — |
| P2 Rule reads stop at 1,000 and only log | Confirmed (`instructionService.ts`, RULES_READ_CEILING) | Not mine (the rules reader); passed to Nexeo-Builder: report the read as incomplete and fail closed for automatic actions. His rules today: 63 | Not built |
| P2 Connector "All" = 20,000 emails / ten years | Not re-checked by me (Scribe, Nexeo-Builder's) | Passed on: a capped read must say so, and dependent automatic actions fail closed | Not built |
| P2 Drive export and semantic search not proven private live | Agreed (§0.15 said "read from code only") | Probed live on production, 16 Nov 15:45 PKT, read-only | **Semantic search (real embeddings, `searchWikiByVector`):** a document, a commitment and a meeting are found by their owner only; a KPI and a business unit by a colleague too; another client finds none; 0 private hits of another user in any result. **Drive export:** its selection (`exportVaultForUser`, the same query) gives a colleague 32 pages, 0 of them private. Not run: the Drive write itself (needs a signed-in Google account for a second user) |
| P2 Company-domain authorization from users' addresses | Agreed: stronger than before, not verified ownership | Recorded as a limit; verified domain ownership is a product decision for him | Open |
| P2 Seven-day forward window | Agreed: bounded, not a durable backlog | Nexeo-Builder's (F-2.4) | Open |

Kept from the review as standing rules for the Wiki: words, names and file names only find candidates and never decide identity or completion; every builder has a repeat-run check (a second run writes 0) **and** negative tests for false merges; "unchanged" is the whole note. Personal connector knowledge stays the owner's alone; a client's systems stay inside the client; rules may act, learned patterns only suggest.

**Owed, in order:** (1) the readers move to the notes with parity evidence (Nexeo-Builder); (2) the Drive write by a second signed-in user (semantic search and the export's selection are proven, above); (3) the end-to-end case the review asks for: source → correction → connected knowledge → applicable rule → authorized action → confirmed receipt → later learning.

### 0.19 Sixth outside review (16 Nov, at `9e8401cf`): answered

Its verdict: the first examples and the provenance defect are fixed; task and document identity were fixed only for the examples, not the class. **Agreed:** my earlier fixes let shared context, sender or conversation decide identity. The rule now, for every Wiki builder: **separate by default; one thing only on positive evidence; signals only find candidates** (tag `identity-from-words`, 5th, chart §3).

| Finding | What was done (D-276, 16:09 PKT) | Evidence |
|---|---|---|
| P1 Task identity collapses distinct obligations (November and December payroll reports) | One obligation only with the same owner, no conflicting recipient or due date, the same period and numbers, and wording the same both ways; rulings never cross periods; closing across conversations needs the same test (DEF-485) | Negative tests: Nov/Dec, month only, invoice numbers, recipients, due dates, December done never closes November, a November ruling never applies to December; grounded same obligation still one. Live 430 tasks; repeat runs write 0 |
| P1 Document identity collapses separate transactions (two invoices of one vendor) | Every attachment its own identity (email, file, content); versions only on identical content, the same reference number, or a same-sender revision in one conversation with no conflicting reference (DEF-486) | Negative tests incl. two invoices in one thread and two same-name attachments in one email. Live: user 2 162 documents (20 with versions), user 3 282; older-form sources replaced, 0 dangling citations |
| P1 Complete the reader migration | Unchanged from §0.18: Nexeo-Builder's, on its backlog, one reader at a time with parity evidence | Not started |
| P2 Completeness limits (rule ceiling, connector reach, forward window, domain ownership) | Unchanged from §0.18: the first three on Nexeo-Builder's backlog; domain ownership is a decision for the owner | Not built |
| P2 Acceptance chain and the second-user Drive write | Owed by the Wiki session; the live chain sends a real email and waits for the owner's go-ahead; the Drive write needs a second signed-in user | Not run |

Also seen: the server's own hourly job landed a second user's attachments (user 3, 14:34 PKT) unattended, so the scheduled run works for other users.

**End-to-end acceptance test, in progress (founder's go-ahead 16 Nov; recipient Muhammad.Rafay@tmcltd.com, founder sends the trigger):**
- Done 16 Nov 17:30 PKT: Muhammad Rafay added as a person (`persons` cmwj8rg450000rt6uin7aif1j, by hand: no contact path exists, DEF-487); rule `uar_7768fe543151` set (email_delegate, subject contains "nexeo chain test", forward to Rafay); its rule note is in the Wiki. A read-only chain map (six agents and a critic) proved the scope: only this rule, only that subject (0 of his 1,899 stored emails match), only Rafay, no other mailbox.
- Waiting: the founder's email "Nexeo chain test 1" (from a personal address, To basit.ahmed@tmcltd.com, no attachment). It did not arrive before office hours closed (18:00 PKT), so the forward goes at the first rule-forward tick after 09:00 PKT.
- Then: observe the forward (agent_actions `rule_fwd:%`, output.send state sent, his Sent folder), Rafay's task, the Wiki marks and notes; remove the rule; the founder sends "Nexeo chain test 2" inside office hours; it must not be forwarded; then close Rafay's task.
- Gaps found and logged before the send: DEF-487 (no contact path), DEF-488 (attachments not forwarded although agreed), DEF-489 (a forward is learned as a reply), DEF-490 (the colleague's task reads as his), DEF-491 ("delivered" means only in his Sent folder), DEF-492 (rule note only hourly; fixed, D-277).

### 0.20 Seventh outside review (16 Nov, at `e6846826`): identity is judged, not computed

Its verdict: small progress, no score change; identity errors remain; Wiki-first behaviour PARTIAL. **Agreed, and the identity finding is the important one:** it broke the D-276 rule ("separate unless proven the same") with "Approve payroll release" / "Reject payroll release" and with two vendors' INV-001. That was the seventh time for one class (`identity-from-words`), and the third fix in one day to be broken by the next variant. The lesson: **a rule in code cannot judge meaning**, so the decision was taken out of code.

**The rule now (`wiki/wikiSame.ts`, live D-278/D-279):**

- Words, numbers, sender, project and conversation only **find** two readings that might be one thing.
- Whether they are one is **the model's answer**: it is shown both readings and must say *same* and *sure* *(as built in D-278 this cut long fields and asked once; corrected in §0.21: whole or not asked, and two agreeing readings)*. The answer is kept as a `meaning` mark for the pair (`same:` for tasks, `samedoc:` for documents), so a pair is asked once and a rebuild gives the same Wiki.
- **No answer, an unsure answer or a failed call means separate.** *("Never a false merge", written here on 16 Nov, was too strong and is withdrawn: the model itself can be wrong; see §0.21 for the measurement.)*
- Asked for: one task across conversations; a later conversation closing a task; applying an Action Center entry to a reading; whether two attachments are one document.
- The exact rules left in code: an outside id; the same file (same text and size, from the same sender or in the same conversation); and hard facts that rule a pair **out** (two named owners, two due dates, two recipients, clashing periods or numbers). Two readings the model gave from one conversation are never merged.

| Finding | What was done | Evidence |
|---|---|---|
| HIGH 1 Semantic identity (approve / reject; issuers' INV-001) | DEF-493, as above | Class tests: a battery of near-identical wordings never merges without an answer and is put to the model; a *no* keeps them apart, a *yes* joins a paraphrase; issuers' INV-001 is never even asked; six mutations each turn tests red. Live: 62 task pairs (32 same), 30 document pairs (17 same), $0.04; 447 tasks; documents 159 and 282; repeat runs write 0, ask 0 |
| (found while checking) His Action Center entries | DEF-494: every entry is a note (applied to the reading the model says it is, else a note from his list); "August" no longer clashes with "August 2026" | Against his real list: 24 of 24 his, 8 of 8 someone else's, 10 of 10 closed; 0 unruled open tasks of his where he closed or handed one off. The earlier "13/13, 0/8" figure (§0.13.7) was partly the word-matcher spreading his word over neighbouring tasks; it is withdrawn as evidence |
| HIGH 2 Delegation teaches the wrong lesson (DEF-489) | Not fixed: the forward path and the learners are Nexeo-Builder's; its session was not running | Open |
| HIGH 3 Task ownership and origin (DEF-490), contact path (DEF-487) | Not fixed: Nexeo-Builder's | Open |
| HIGH 4 Attachments left out of agreed forwards (DEF-488) | Not fixed: Nexeo-Builder's; an agreed term with Suzi | Open |
| HIGH 5 "Delivered" overstates the receipt (DEF-491) | Not fixed: Nexeo-Builder's; wording shared with Suzi | Open |
| MEDIUM 6 Rule-note sync is best effort | DEF-496: a failed rebuild is logged; the hourly build rebuilds every rule note from the stores (also after a restart); rule.set never claims the Wiki is in step | Unit test with an injected failure; live injected failure plus restart not run |
| HIGH 7 Wiki-first behaviour partial | Unchanged: the readers have not moved; the end-to-end test waits for the founder's test email | Open |

**Withdrawn:** the statement in §0.19 and the D-276 chart row that the identity class was "closed by rule". Whether it is closed now is for the next review to say.
### 0.22 Suzi's Wiki search reads the text, not only titles (16 Nov, founder, Nexeo-Builder)

Founder: *"when i ask suzi to see anything it always read the subject, where subject is one step to search and other
to search through content (wiki should help this)"*. `/v1/knowledge` (`suzi/suziKnowledge.ts`) matched his words only in
note TITLES (plus the meaning search). Body text was searched only for codes like `R-26-00081`. Asked about "yellow
columns business owner technical owner", words from the catalogue email itself, it returned "Book of business" and
"Yellow Belt Course".

- **Built:** a text pass. Notes whose text holds all of his words, or failing that most of them, join the candidates.
  Every candidate scores `0.6 × (share of his words in its text)²` on top of the title bonus, so a note holding all
  of them beats a title sharing one. Scoped as before (tenant, or his own pages).
- **Verified live, read-only, on his account:** that query now returns Enterprise Data Implementation, TMC Systems
  Catalogue (project), and the 13 Nov, 30 Oct and 27 Oct catalogue emails. Six other queries were unchanged or better.
  Time is unchanged at 2.5 to 4.4 s; the meaning search dominates.
- **Test:** `suziKnowledge.test.ts`, "his words in the TEXT beat a title". The mutation with the text bonus at 0 turns
  it red.
- **Not done:** no full-text index. The pass is `ILIKE` over about 18,800 notes; the index is owed if the Wiki grows.


### 0.21 Eighth outside review (16 Nov, at `0d7a1db3`): what an identity answer rests on, and how good the judge is

Score 91 (+1) for moving identity from computed rules to a judgement. Its three findings on that judgement were all right, and are fixed in D-283 (20:22 PKT):

| Finding | What was wrong | What it is now | Evidence |
|---|---|---|---|
| HIGH 1 A kept answer can outlive its evidence | The answer was keyed on ids and task wording; the model had also been shown owner, dates, state, evidence | The key is a fingerprint of the whole payload shown for both sides, the prompt and the model; an answer no build asks about is retired (history kept) (DEF-497) | Tests: changed evidence or due date under one title asks again; identical inputs ask nothing |
| HIGH 2 "Both in full" was not what the code sent | Fields cut at 1,600 characters; documents shown by their first 1,200 | Nothing cut silently. Documents: facts, opening, and **every line one has and the other has not**; if that cannot be shown whole, or the reader cut the text, the pair is never judged and stays two documents. Each answer records the ids and a fingerprint of the text read (DEF-498) | Tests: a decisive later clause is shown; an unshowable pair never merges even on a yes |
| HIGH 3 "Never a wrong merge" is too strong | Only the gate was tested, not the judge | **Withdrawn.** The judge was measured (`tests/eval/wikiSameEval.ts`): one reading gave false merges (1 of 20 task pairs, 1 of 8 document pairs) and unstable answers. Now a merge needs a second, challenging reading to agree (documents: the stronger model, twice); his own word on a pair overrides the model; merges are recomputed from kept answers, so undoing one loses nothing (DEF-499) | After, over 5 runs: 0 false merges in 100 answers on different task pairs, 0 in 40 on different document pairs; missed matches (duplicates) 2 of 11 and 2 of 4 in at least one run; 1 unclear document pair merged once |

**What is and is not claimed.** Measured on 47 labelled pairs written by the builder: not a proof, and not his real data. A false merge is still possible; it is now less likely, visible (the answer and what it was given on are kept), and reversible (his word on the pair, `setSameOverride`; no screen calls it yet). The set grows with every case a review or the founder finds.

**Still open from this review, not the Wiki session's code:** HIGH 4, the forwarding and learning defects DEF-487 to DEF-491 (the reviewer recommends the active builder take them; the founder has not yet said who does; Nexeo-Builder was told again at 20:25 PKT, along with a clash of defect numbers: its CL-093/094 rows reuse DEF-482 to 486). HIGH 5, the readers and the live acceptance: the end-to-end test waits for the founder's own test email (it is his to send); a no-attachment email can show forwarding and revocation only, so attachments and correct learning are separate acceptance cases, owed after DEF-488 and DEF-489.

### 0.23 All information is in the Wiki; what Nexeo and Suzi learn from him too (owner, 16 Nov 2026, 20:50 PKT)

*"wiki should contain all informatoin. wiki is central knowledge of brain."* And, the same minute: *"if nexeo/suzi learn anything from me should also be part of wiki."*

**What this decides.** It restates §0.1 and §0.3 (nothing is kept outside the Wiki) after he was shown, plainly, what is still outside (the ledger of §0.4: 128 tables on 13 Nov). It also answers the question left open in §0.13.1: his conversations with Nexeo and Suzi belong in the Wiki, as sources. Unchanged: other people's WhatsApp messages are not read; secrets stay encrypted; the builders' own documents stay out (§0.14); what came from his connectors or his own conversations is his alone, what an integration brings is the company's.

**Built the same hour: what was learned from him (`wiki/wikiLearned.ts`, D-285 20:46, D-286 20:52 PKT).** Every learned thing is one `learned` note, private to the user it was learned from, citing a `record` source that holds the stored row (a sensitive one encrypted):

| Store | Becomes | State shown |
|---|---|---|
| `governed_brain_memories` | preference | in use (he approved or said it); waiting for his approval; rejected |
| `user_memories` | preference | in use (he said it) or observed (Brain inferred it) |
| `user_learning` | habit (when he is active, what he reads, how he writes) | observed, with how many times |
| `pattern_insights` | pattern | a suggestion only |
| `thought_entries` | weekly review | draft or in use |

Each note says how it was learned and **"Acts by itself: no"**: a learned thing suggests or shapes an answer; only rules, delegations and standing instructions act (§0.9.4, his ruling of 13 Nov). The stores stay where they are until their readers move; the notes are rebuilt from them every hour, with the other notes.

**On production:** 110 learned notes for the founder (55 preferences: 6 in use, 44 waiting for his approval, 5 observed; 11 habits; 14 pattern suggestions; 30 weekly reviews), 19 and 15 for the two other users. A repeat run writes 0. Private, checked live: read by the owner; refused to a colleague and to another client. Tests in `tests/wikiPart11and13.test.ts`.

**Not yet:** learned patterns in `shadow_rules` were already rule notes (§0.13.6); what Suzi learns on her own side reaches Nexeo only through these stores (anything she keeps only on the Mac is not here: to be asked of Suzi). Nexeo and Suzi do not yet READ these notes: they still read the stores.

**What Suzi learns on her own side (asked through Nexeo-Suzi, answered by Suzi Master, 16 Nov ~21:00 PKT).**

- *Already in the Wiki* (checked in `suziW1.ts` and on production): `profile.update` keys (his conversational memory `memory.<slug>` since Suzi 1.2.89, his brief habits `brief.<part>`) are lines of his private note "How to work with <name>"; `device.report` is a private record source per device per day; voiceprint and faceprint are private encrypted record sources. On production the note holds `brief.*` keys; no `memory.*` key seen yet.
- *Only on Suzi's side today, and agreed to carry (Wiki session AGREE, to be written into the charter's W-1 key list and the agreement file by Nexeo-Suzi before Suzi builds):* (1) how he speaks Urdu, as weekly `profile.update` keys `speech.english_share` and `speech.urdu_words` (top words, within 2,000 characters a key); (2) her settings the device report did not carry (his name as she uses it, her name, sleep and wake phrases, voice, accent, speed, chat and board style) as extra `device.report.settings` keys. Neither needs Nexeo code.
- *The founder's decision, not agreed:* the 8-second voice sample (the gateway's 16 KB cap refuses it today); copies of his requests to the builder (`request.G-n`).
- *Stays on the device as working state:* alert snoozes, permissions he answered "later".
- *Done on Nexeo's side (D-288, 21:09 PKT):* each `profile.update` key is also kept as a private `record` source (`profile:<key>`, the latest value) and the profile note cites it; an empty value (the charter's "forgotten") removes the line from the note and removes its source with every citation. Proven live with a throwaway user (learned: 2 lines, 2 sources, 2 citations; forgotten: 1, 1, 1; test rows removed). Keys learned before this have no source until Suzi sends them again. *Still owed:* no reader uses `speech.*` or the new settings yet.

**His conversations with Nexeo are in (`wiki/wikiConversations.ts`, D-289, 21:16 PKT).** One private `conversation` source per day of his own time (Pakistan), holding what he said, what Nexeo answered (`messages`) and what Nexeo sent him unprompted and really sent (`brain_user_messages`, status sent: briefs, prompts, alerts), in order; one `conversation` note per month citing its days, with counts only (no note per message). Landed by the hourly reconcile; a day still going on is landed again when its text changes. **Left out on purpose:** the 136,000 notifications Brain suppressed or failed to send (they never reached him), and other people's WhatsApp messages (`brain_inbox_messages`; his ruling that others are not read). **On production:** 118 days from 4 May to 16 Nov for the founder (911 messages of his, 1,647 of Nexeo's, 736 of them unprompted), 7 month notes; 1 day for user 3. A repeat run lands 0 and writes 0. Private, checked live for a note and a source: the owner reads; a colleague and another client are refused. **Not yet:** what he asked or decided in these conversations is not read into commitment or learned notes; his conversations with SUZI are kept on Suzi's side, not in Nexeo (asked of Suzi the same evening: where, and how they reach the Wiki).

**His conversations with Suzi: kept nowhere today; a shape is proposed, NOT agreed and NOT built (Suzi Master through Nexeo-Suzi, 16 Nov ~21:30 PKT).** On the Mac a conversation lives in memory only while it lasts (gone after 20 minutes of quiet, a goodbye or a restart); her logs hold word counts and timings, never his words; with her AI on the Mac his words go to the model provider and the gateway never sees them; no audio is ever kept. Since Suzi 1.2.89 the only lasting trace is the distilled `memory.*` (one sentence per item). Proposed, to be agreed only after the founder says in his own words that his Suzi conversations are kept: a new op `conversation.add {conversation_id, day, started, ended, part, turns[{at, who, text}]}` sent when each conversation ends (in parts under 14 KB, the gateway's cap), his own turns and her answers only (not others in the room, not training turns, not turns he marks off the record), and `conversation.forget {conversation_id | day | all}`; text only, private to him. On Nexeo's side these would land as `conversation` sources like his Nexeo conversations. Waiting for: his word, then Nexeo's AGREE, then charter text by Suzi Master.

**Order for the rest of what is outside (largest gain first):** (1) his conversations with Suzi (Nexeo's are in, above; Suzi's wait on his word); (2) the decisions and delegation history, as the trail of commitment notes; (3) Brain's own documents and risk flags; (4) what Brain found about itself; (5) how Brain is told to behave; (6) settings and the account. Each is landed as sources first, notes second, and checked for privacy and for a repeat run that writes nothing.

### 0.24 Ninth outside note (17 Nov): a route to 98%, measured on whole tasks (PROPOSAL, waits on the founder; nothing built)

The reviewer puts readiness at 92/100 and says the Wiki alone cannot give 98%: that needs a separate measure, the share of agreed assistant scenarios Nexeo completes correctly, with privacy and authorization failures at zero tolerance. Five workflows (understand and remember; handle corrections; delegate and follow up; monitor commitments; learn preferences), a frozen benchmark plus unseen cases, a baseline before further change, failures closed in measured batches, and **Wiki consumption finished before the Wiki grows further**. Next milestone proposed: one demonstrably reliable Wiki-driven workflow.

**The Wiki session's reading (17 Nov, 09:20 PKT):**

- **Agreed, and it matches what is already written here:** Wiki-first behaviour is PARTIAL (§0.18, §8): the Action Center, the brief, Suzi's pack, contacts and triage do not read these notes. More notes change no answer until a reader reads them. The identity eval (§0.21) is the only measured part today; the rest of the score is a judgement.
- **It conflicts with a standing ruling.** The founder ruled on 16 Nov that all information goes into the Wiki (§0.23), and five groups are still outside. The reviewer says stop expanding and connect first. Which comes first is the founder's decision; until he says, §0.23 stands.
- **What the Wiki session would do if he agrees:** (1) the benchmark's "understand and remember" and "handle corrections" cases, built from his real failures (the chat log and DEF rows) with expected answers and sources, held in `tests/eval/`, a part kept unseen; (2) a baseline run before any reader moves; (3) with Nexeo-Builder, one reader moved end to end (proposed: delegate and follow up, since the end-to-end test of §0.19 is already prepared for it and DEF-487 to 491 are its known failures). Readers, forwarding and learning code are Nexeo-Builder's; anything Suzi reads differently is agreed with Suzi first.
- **Not accepted as written:** 500 cases at once. A set that size written by the builders would be mostly invented, not representative. Start with the real failures and requests on record (about 60 to 100), measure, and grow the set from live use.
- **Not decided here:** what counts as a success, who labels the expected answers (the founder's rulings are the only ground truth so far: 24 tasks, 8 watch, 10 closed), and the cost of running the set.

### 0.25 Ninth outside review (17 Nov, at `41f65478`, score 92): answered; the founder's target is 98 or 99

Verdict given: architecture progressing; identity no longer circling but under evaluation; **a second loop named: more sources and notes are built while the assistant's readers still read the old stores.** The Wiki session accepts that: §0.23's expansion made the store bigger and no answer better. The founder said the same morning that his target is 98 or 99.

| Finding | Reading | What was done | Owner |
|---|---|---|---|
| P1 One Wiki-driven workflow, end to end | Agreed (§0.24). Conflicts with the order of §0.23 (all information first); asked the founder which comes first | Nothing built. Proposed first workflow: delegate and follow up | Founder decides; readers are Nexeo-Builder's |
| P1 Forwarding fixes verified through the real path | Agreed. The prepared test (§0.19) has no attachment, so it shows forwarding and removal only | Nothing new. Rule `uar_7768fe543151` still active, fired 0 times, no test email yet (checked 09:02 PKT) | Founder sends; Nexeo-Builder owns D-287's acceptance cases |
| P1 An automatic forward must not count as the user's own decision | Not read in code by this session; passed to Nexeo-Builder as written | Told Nexeo-Builder 17 Nov. **Nexeo-Builder reports it fixed (DEF-506, live D-291, 12:51 PKT):** a rule forward's decision row belongs to the rule (`sessionType 'rule'`, `actionTaken 'rule:<id>'`, no dedup hash), so repeated runs cannot count as his choice. Not checked by this session; not yet seen on a live rule run | Nexeo-Builder |
| P2 Identity on unseen cases | Agreed: 47 pairs written by the builder measure stability, not reliability. A held-out set written by the same builder is not unseen either: it has to be real production pairs labelled by the founder, or by the reviewer | Not built; needs his labels | Wiki session, with the founder |
| P2 Privacy and ingestion limits | Drive write by a second signed-in user still owed; the rest are Nexeo-Builder's and Integration's | Unchanged | Mixed |
| P2 Fixed UTC+5 in conversations | **True** | **Fixed (DEF-505, D-290):** days and hours in the user's own timezone, the zone recorded on each source, an unreal zone refused. No change for user 2 (Asia/Karachi) | Wiki session |

**Nexeo-Builder, 17 Nov 12:55 PKT:** agrees "delegate and follow up" is the first workflow; will write the separate D-287 acceptance cases (plain forward, attachment kept, colleague owner and source, rule removal, sent/bounced wording, learning recorded as the rule's, contact creation DEF-487) and run them when the founder's test email arrives.

**Held until the founder answers §0.24:** no new note type is started. The five groups still outside the Wiki (§0.23) stay listed, not built.

### 0.26 His habits live in the Wiki: Suzi's raw habit data (T36, 18 Nov 2026, founder via Suzi-Builder; Nexeo-Builder)

The founder (18 Nov): when Suzi starts she fetches what she knows of him from Nexeo, and Nexeo keeps building a learning
curve from it. Suzi sends two new `profile.update` keys: `brief.history` (his last 8 answers per brief part: details,
acted, skipped, stopped) and `speech.counts` (utterances, English and Urdu word counts, his most used English words).

- **Built (D-294):** both keys are stored in the note "How to work with <user>" and returned in the pack's `profile{}`
  exactly as sent (objects). They are **not printed as lines** of the note's readable body (`RAW_PROFILE_KEYS`,
  `suziW1.ts`); each still has its own source, so the trail holds them. Other keys are unchanged.
- **Already true, now pinned by a test:** an unknown or malformed key does not refuse the call; it is dropped, and only a
  call with no good key is refused (`bad_notes`).
- **Learning curve: BUILT (D-298), agreed by Suzi 14:33 with her caution.** Counting only, no AI call, so no cost; re-counted
  in the same note whenever `brief.history` or `speech.counts` changes. Keys (Nexeo's only: Suzi cannot write `learned.*`):
  `learned.brief_order` (parts he opens first, skipped or stopped later; **a part is never removed**),
  `learned.brief.<part>` (`more detail` | `shorter` | `as is`), `learned.english_share_by_week` (weekly English share from
  the totals' differences; the weekly totals are kept as raw `learned.speech_weeks`, not printed). Skips sent before
  19 Nov 2026 count half (Suzi counted silence as a skip until then).
- **Verified live:** Suzi's first send stored at 14:32:19; her fetch at a restart, 15:08:57 (Suzi's log). Not yet verified:
  the learned keys on his real note (they appear at her next send).

### 0.27 A standing instruction's page says when it runs (link T41 round 9, 23 Nov 2026; operator session)

Suzi proposed (11:56 PKT), Nexeo agreed (13:06), Suzi agreed the exact shape (13:07). For the computer operator's system
jobs: "clear caches every Friday" says when, and the desktop needs that exactly.

- **Built (D-305):** the instruction's Wiki page (page type `instruction`) may hold `metadata.schedule`
  `{every, on?, at?}` and the visible line `**Schedule:** every week on fri at 09:00 (the computer's own time)`. Both are
  written together, by `createInstructionFromText` (from `instruction.add`) and `setInstructionSchedule` (from the new
  `instruction.update`), and cleared together. Pause, resume and archive keep it (they keep the metadata).
- **What reads it:** the pack's `rules.standing[]` (only where set), `rules_md`, and Brain's standing-instruction block.
  A stored value that does not read as a schedule is treated as none.
- **No new store:** the schedule is part of the instruction's own Wiki page (§0.3). Details: `Rules.md` §9.
- **Not verified:** a real schedule set by Suzi and run on the Mac (Suzi's C5, by 27 Nov).

### 0.28 Wiki rows of deleted users (24 Nov 2026, founder "yes if it safe to delete"; Wiki session)

- **Found 19 Nov:** 41 Wiki rows (26 pages, 15 sources) plus 6 page links and 15 citation rows belonged to users 1, 4 and 5, who no longer exist. None of the live users' pages linked to them.
- **Done 24 Nov 06:55 UTC:** all 62 rows backed up to `/root/backups/wiki_orphans_users_1_4_5_20261124_0655.sql` (one JSON row per line, table name first), then deleted in one transaction. 0 orphans remain; 19,179 pages and 9,854 sources are left.
- **Root cause:** the Wiki tables have no foreign key to `users`, and users were deleted by hand (no code path deletes a user).
- **Prevention:** migration `20261124_wiki_rows_follow_user_delete`, a trigger `users_wiki_rows_follow_delete` (AFTER DELETE ON users) that removes that user's citations, links, pages and sources. Rehearsed in a rolled-back transaction (1 source before, 0 after) and applied to production twice, both clean.
- **Not verified:** a real user deletion, because none has happened.

### 0.29a Directory people get a People note (founder, 25 Nov 2026; Wiki session)

Founder searched People for "rafay" and found no note for the employee: *"integration is not working correct Rafay should be there."*

- **Rule:** every integration record that names someone and carries an email gets a People note. If a note already holds that exact address, the record merges into it (§0.29). Otherwise a new note is created, titled by the record's name. The match is never made on a name (§0.13.2).
- **The note:** address, phone, `## From <integration>` with the allowed facts (sensitive fields left out), `knownFrom: ['integration']`, and a citation of the record source. If another note already has the same name, the title gets the address added: `Name (email)`.
- **Skipped:** the user's own address, role and no-reply addresses, and records without a name or without an email (those stay sources only). A record carrying two addresses gives one note.
- **Code:** `wikiBuilder.ts` `recordOnlyPeople`, `recordName`. Record names link to these notes in the same build, so a repeat build writes 0. Tests: `tests/wikiPersonRecords.test.ts` (13).
- **State: LIVE, D-320w (25 Nov, about 16:00 PKT).** As first deployed it created no notes: `recordName` read only the text after "Integration · ", and since D-313 sources are titled by the name alone. Fixed in `46c9f0fe` (`tests/wikiRecordName.test.ts`, on the real title shape). After the fix, his rebuild created 888 notes, his People count is 1,291, and "Rafay" finds four directory people. A second build wrote 0.
- **Lesson:** a test's data must have the shape the store holds today. Here the fixtures still carried the old prefixed titles.

### 0.29 Integration records merge into People (founder, 24 Nov 2026; Wiki session)

**His words:** *"yes merge directory into people and always do the same where you can updating additional information if comes"* and *"when any integration is being setup it is mentioned in integration setup wizard about it so considering this you will make it part of wiki."*

**Why it was needed:** the Employee Directory landed as separate "Integration records" notes. A search for "Rafay" showed three directory rows and no person note, so the facts he needs about a colleague (role, department, manager, phone) sat apart from the person he deals with.

**The rule (any integration, not only the directory):**
- Every integration set up in the wizard writes its records as `org_doc` notes, with the fields in `metadata.fields`.
- On every hourly build, any record that carries an email address is attached to the People note holding that exact address (`email:` identifier).
- **The match is the exact address, never a name** (§0.13.2, standard 2). "Abdul Rafay", "Rafay Rasheed" and "Muhammad Rafay" are three people until an address says otherwise.
- The person note gets a `## From <integration>` section with every field except the matched address, pictures, empty values and personal fields (§0.31), and cites the row's source. Its properties get the same facts under `records`. Since 25 Nov the rows are read from the Wiki's sources (§0.31), and a field naming a known person or business unit is a `[[link]]`. The record's phone fills the person's phone only when no contact phone is known.
- **"Updating additional information if comes":** the People step rebuilds the note from the current records each hour.
  - A changed record field changes the note.
  - A record that disappears or is marked stale by its integration is removed from the note (`records: null`).
  - Run twice with nothing changed, it writes 0.
- The record note itself stays. It is the client's shared source and the citation. People who are in an integration but whom he has never dealt with keep only their record; no People note is invented for them.
- For a Client Owned Data user nothing changes: the People step does not run for them (§0.6).

**Code:** `wikiBuilder.ts`: `loadPersonRecords` (records by address), `recordsFor` and `recordFacts`, the People step. Tests: `tests/wikiPersonRecords.test.ts` (7), covering match, left-out fields, no name merge, update and clear, contact phone wins, several integrations once and case-insensitive, and identical repeat build.

**Size on 24 Nov:** 107 of his 399 People notes matched a directory record by email. On 25 Nov the directory holds all 1,113 employees (D-310, Integration session), so the number will rise.

**Not built:** a domain match into Companies (a record with a website or domain). Proposed only.

### 0.30 Integrations land in the Wiki on every run (founder, 25 Nov 2026; Integration session)

**His words:** *"every integration should go to wiki as per its run, and which records should go where that should be decided by you (as per wiki standard structure)"*.

**Where integration data goes (decided by the Integration session, following this document):**
- ~~Each record → an `org_doc` **Integration record**~~ **Superseded the same day by §0.31 (standard structure):** each record lands as a Wiki **source** (kind `record`), never a note (every record, DEF-514: the cap is a 5000 safety ceiling, default = ceiling).
- A record with an email → attached to the People note with that exact address (§0.29). No People note is invented.
- The integration → its **system** note; each KPI → its **kpi** note; each unit the figures name → its **business_unit** note (§6b, `wikiSystems.ts`).
- **When:** records on every run (contextWriter); system, KPI and business-unit notes **now also after every real run** (`runJobs.refreshWikiAfterRun`, DEF-515), not only at the Wiki's own build. A test (dry run) never touches the Wiki; a Wiki failure never changes the run's result.
- **Seen:** the Wiki screen lists every note type that has notes (DEF-515); before, a fixed list hid 362 of 2786 notes.

**Not verified at writing:** a live run refreshing the KPI note; the screen showing Integrations / KPIs / Business units. §0.29 (People merge) is committed by the Wiki session (`392c83d5`) but not deployed.

### 0.31 The Wiki's standard structure, and how every feed and integration lands (founder, 25 Nov 2026; Wiki session)

**His words:** *"first make rule that Wiki should have standard structure (like obsedian) and all data will remain recorded/saved as per the structure, all other feeds and integration data will be landed accordingly. can you fix it at once and avoid this happending in future"*

**What went wrong:** 1,114 integration rows (the Employee Directory) were stored as notes of their own type, "Integration records". Measured 25 Nov, each one failed every structural check:
- titled by the source ("TMC Employee Directory · Name") instead of the person's name;
- no outside identifier;
- no properties;
- no note linking to it;
- 919 pointing "About" at a person note that did not exist;
- personal fields shared with every user.

Every other note type passed. Only 4 notes lack an identifier: 2 chat-only people and 2 recorded meetings, which have none to give.

**The rule (also AGENTS.md invariant 10):**
1. **A note is one thing, titled by its name**, of exactly one type from this list: `person`, `company`, `group`, `meeting`, `project`, `topic`, `decision`, `commitment`, `document`, `conversation`, `rule`, `learned`, `system`, `kpi`, `business_unit`.
2. **Identity is outside identifiers** (`email:`, `domain:`, `event:`, `space:`, `business_unit:` …) wherever the source gives one; a name never decides identity (§0.13.2).
3. **Facts are properties; relationships are `[[links]]`** to the note of the related thing (a manager, a business unit, a company). A link to a thing with no note yet stays unresolved, as in Obsidian.
4. **What was fetched is a source, never a note.** Every feed (email, calendar, chat, WhatsApp, transcripts, documents) and every integration row lands in `wiki_sources` through `saveSource`; notes cite their sources. An integration row lands as kind `record`, scope `tenant`, `details.store = 'integration'`, with its integration and fields.
5. **Notes are built from sources by the builder steps.** A row that carries a person's email adds its facts to that person's note (§0.29). The same applies to any integration set up in the wizard. ~~A row about someone the user has never dealt with stays a source; no note is invented for it.~~ **Superseded 25 Nov (founder: "integration is not working correct Rafay should be there"):** a record that names someone and carries an email IS a person and gets a People note of its own (§0.29a). Records without a name or an email stay sources only.
6. **Personal data stays in the source.** Birth date, gender, salary, contract, national id, passport, religion, marital status and bank fields (`SENSITIVE_FIELD`) never reach a note. Showing them to admins needs the founder's word; he has not been asked yet.

**How it is enforced, so it cannot happen again:**
- **Code door:** `assertNoteStructure` in both note doors (`writeNote`, `adoptAsNote`) refuses a type outside `NOTE_TYPES` (`wikiStructure.ts`), telling the writer to land a source instead.
- **Database door:** trigger `wiki_pages_standard_types` refuses any `wiki_pages` row marked as a Wiki note whose type is outside the same list, whoever writes it (migration `20261125_wiki_standard_structure`).
- **Test:** `tests/wikiStructure.test.ts` fails if the code list, the trigger's lists and this section disagree, if a door stops checking, or if the integration writer goes back to adopting notes.
- **Adding a type** means changing all three together, here first.

**The fix for what is there:**
- The integration writer (`contextWriter.landAsSource`) lands every row as a source on every run. The engine keeps its own page for its diff, outside the Wiki.
- `src/scripts/wikiLandIntegrationSources.ts` lands the rows written before today; a second run changes nothing.
- The migration then removes the Wiki marker and links from the 1,114 records and installs the trigger.
- The People step (§0.29) now reads the record sources, cites them, links manager, department head, HR partner and business unit when the Wiki knows them, and leaves the personal fields out.

**State: LIVE since D-313 (25 Nov, about 14:30 PKT; founder's "yes go ahead"), with §0.29 inside it.**
- 1,114 rows are sources (1 stale); 0 `org_doc` notes remain.
- The trigger is installed, and it refused a raw record on production (in a rolled-back transaction).
- 221 of his People notes carry directory facts, each citing its source; 204 have the manager as a link; none shows a personal field.
- A second rebuild wrote 0.
- **Found while deploying and fixed the same hour (62778141):** linking a manager by name when no note existed left 50 notes with links that could never resolve, so each build rewrote them. A field now links only to a note that exists, found by the person's exact email or a business unit or company title (`tests/wikiPersonRecordsLinks.test.ts`).
- **Not verified:** his own screen; the next real integration run landing sources by itself.
- **Still rough:** `directReports` shows as raw JSON (it will be rendered as linked names).

**Not built:** a search over sources from the Wiki screen. Until it exists, an employee the user never dealt with is not found by the Wiki search; Brain and Suzi read sources directly.

### 0.32 Sent mail has the same access as Inbox (founder, 25 Nov 2026; Nexeo-Builder, T46)

The founder's rule: *"Suzi/Nexeo should have same access of Inbox and Sent, because these 2 combine build the
complete trail of information."* Agreed with Suzi-Builder as T46.

- **D-312 (live 25 Nov):**
  - the feed reads Sent at the Inbox cap (100 per poll, was 30);
  - a one-time Sent backfill to 3 Apr 2026 (where Inbox starts in the Wiki) landed his sent mail through the Sent
    intake (`landEmailText`, `class: own`).
  - Measured: Sent in `wiki_sources` went from 225 (oldest 15 Sep) to 537 (oldest 3 Apr). The run read 538, with
    0 errors.
  - The first, unpaced run hit Gmail's per-user quota. D-312b added `gmailDelayMs` pacing and a retry.
- **D-313 (live 25 Nov):** `email.search` (Inbox, Sent or all, read live from Gmail) and two-way thread reads
  (`messages[]` with `direction`).
- **D-314:** sent mail from the last 14 days becomes actions, hourly:
  - his promises become his tasks;
  - his requests to others become watched tasks;
  - one commitment = one task (`sentCommitmentKey`);
  - each sent email is read once (`details.commitmentsChecked` on its `wiki_sources` row).

  Older sent mail stays memory only.
- **Not done yet:**
  - D-315, sent mail in person and task history;
  - mail before 3 Apr (both boxes), which waits on the founder's decision.

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

**Current state and next step (16 Nov 2026) — this line replaces every earlier "next step" in this document.** All 13 parts of the STRUCTURE (§0.13) are live: parts 1 to 10 and 12 since 13 Nov, parts 11 and 13 since 16 Nov (§0.13.8), and a build run twice writes nothing; the fifth to seventh reviews' provenance and identity findings are answered; identity is now judged by the model and never computed (§0.18 to §0.20, D-272 to D-279), unproven until a review fails to break it. **Wiki-first behaviour is PARTIAL:** the assistant's readers do not read these notes yet (§0.18). Left, none of it structure: the readers move to the notes (Action Center, brief, Suzi's pack, contacts, triage; Nexeo-Builder's), the Scribe reach setting (Nexeo-Builder's), then his re-scribe from the Connectors screen and the archiving of the old pages. *Earlier line, kept as the record of its day:* **(13 Nov 2026, 17:45 PKT)** Live: structure parts 1 to 8 (§0.13 checklist; identity and all-or-nothing writes §0.13.2, source versions §0.13.3, marks §0.12.1). Not built: rule notes (9), meaning notes (10), the rest of intake (11), the privacy proof (12), pruning (13); the readers have not moved to the Wiki; the rebuild has not run. **Next, in this order:** the privacy matrix (12, moved first by the fourth review, §0.15), then rule notes (9) with the "You" note, then the cost check and meaning notes (10). Sections §3 and §8 above this line are records of their day, not the current state.
