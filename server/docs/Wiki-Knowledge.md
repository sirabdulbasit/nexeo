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

### 0.4 Knowledge still outside the Wiki, and who moves it

Knowledge still kept outside the new Wiki on 2026-11-13. Each moves in, then its old store is retired or kept only as a
derived index. Owner of each move in brackets.

| Store | Holds | Move |
|---|---|---|
| Old wiki pages (`wiki_pages` of earlier types, ~15,800, half `email_message`) | Email text, person and sender pages, observations | §6b, A1 to C [Brain Wiki] |
| `feed_events` | The fetched items | Stays the intake queue; the source text moves to the Wiki's source store, A1 [Brain Wiki] |
| `open_items` | Action items | Commitment notes, A2; items become a view, DEF-450 [Brain Wiki, then Nexeo-Builder] |
| `persons`, `entities` | Contacts | Person and company notes, B2 [Brain Wiki] |
| `meeting_records` (F-4, built 12 Nov) | Meeting records and transcripts | Meeting notes plus the transcript as a source [Nexeo-Builder, once A1 exists; until then it is the only copy and is not deleted] |
| `user_action_rules`, `delegation_matrix`, instruction pages | Rules, delegations, standing instructions | Rule and instruction notes, A3 [Brain Wiki, then Nexeo-Builder for the Suzi ops] |
| `kpi_readings` | Integration figures | Notes per KPI and business unit, kept as the exact store underneath (owner, 11-12) [Brain Wiki] |
| Suzi's working copy | A read-only, encrypted copy | Already derived from Nexeo (charter); nothing to move |

### 0.5 How every change follows the rule

1. Before building, the change says which notes and sources it writes and reads. A new table that would hold knowledge
   is not built.
2. Until a store has moved, new work on it writes to the Wiki as well, so the Wiki becomes complete first and the old
   store can then be retired without loss.
3. A change that alters what Suzi receives is agreed with Suzi Master first (`NEXEO_SUZI_AGREEMENT.md`).
4. The three Brain documents record each move (DEF rows, chart rows).

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
3. **Feed and Think: leave them.** This role does not change the feed code or the thinking code, and does not need to agree anything with them. The wiki is made strong on its own side; the others can move to it later.
4. **Suzi is not involved** in this work.
5. **Obsidian's way of working, inside Nexeo's database.** The wiki behaves like Obsidian (a note per thing, `[[links]]` in the text, backlinks, properties) but its home is the Nexeo database. It is not a vault of files, and opening it in the Obsidian app is not a goal.

Because of decision 3, the earlier plan to move the roughly 35 writers and 50 readers behind one door is dropped. The wiki builds its notes itself from what the feeds have already stored.
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
| 2b | **The builder, meaning**: project, topic, decision and commitment notes, which need a model to read the email and meeting text. Cost per user to be measured against the Costing Charter before it runs. | Next |
| 3 | **Contacts derived** from person notes and their properties. | After 2 |
| 4 | **Action items derived** from commitment notes, keeping the one gate agreed 2026-11-12. | After 3 |
| 5 | **Upkeep**: merge duplicates, link orphans, mark stale. | After 2 |
| 6 | ~~Full vault mirror to Drive~~ | Dropped by decision 5. The existing Drive export job is left as it is |

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
| B5 | Brain's own working pages (`observation`, `answer`, `gap`, `mind_state`, `feedback`) | These are not knowledge from feeds; they leave `wiki_pages` for a store of their own |

**C. Old writers are switched off**, each when its readers have moved: the ingest hooks in `feedIngestionService` (person page, propagation, WhatsApp body, email body, attachments, sender pages, wiki scribe), Scribe's sender-page rebuild, the nightly scribe backfill, the concept synthesizer, the entity sweep, the meeting digest, and the mirrors that write pages (`odooWikiMirror`, integrations `contextWriter`, folder scribe).

**D. Each old page type is archived** (moved to archive tables, restorable) once nothing reads or writes it.

Order: A1 → A2 → B1 → A3 → B2 → B3 → B4 → B5, with C and D following each B step.

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
