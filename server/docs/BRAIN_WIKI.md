# Brain Wiki

Written 2026-11-12 by the Brain Wiki session. Owner direction is in §1, his decisions in §5, the build order in §6, pruning in §7 and the state in §8.

## 1. Owner direction (2026-11-12)

Brain has three aspects:

1. **Feed**: where information comes from (email, meetings, WhatsApp, external systems, Suzi).
2. **Wiki**: where the information is stored, organized, related and connected, the way Obsidian builds knowledge.
3. **Think**: thinks and reacts as per the wiki.

The Brain Wiki role owns aspect 2 only. In his words:

- "build wiki who contain entire knowledge of brain"
- "wiki should work like obsidian the way obsidian build the knowledge"
- "everything should be derived through wiki like Actionable items, contacts"

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

## 6. Build order

| Step | What | State |
|---|---|---|
| 1 | **The wiki's own store**: `writeNote`, `getNote`, `backlinks` in `src/services/wiki/wikiStore.ts`; `[[link]]` reading in `wikiLinks.ts`. Links are rebuilt from the note text on every write; a link to a missing note waits as unresolved and connects when that note is written; properties merge; sources cited once; private notes never linked across users. | **Built 2026-11-12, not deployed; used by the builder script only** |
| 2a | **The builder, facts only** (`src/services/wiki/wikiBuilder.ts`, run with `src/scripts/wikiRebuild.ts`): reads the stored email, calendar and chat items of one user and writes person, company, meeting and group notes, linked with `[[links]]`. No model is used: every line is a fact from a stored item, and a second run gives the same notes. | **Built and run for one user (TMC-0001, user 2) on 2026-11-12. Not deployed, not scheduled, not run for other users** |
| 2b | **The builder, meaning**: project, topic, decision and commitment notes, which need a model to read the email and meeting text. Cost per user to be measured against the Costing Charter before it runs. | Next |
| 3 | **Contacts derived** from person notes and their properties. | After 2 |
| 4 | **Action items derived** from commitment notes, keeping the one gate agreed 2026-11-12. | After 3 |
| 5 | **Upkeep**: merge duplicates, link orphans, mark stale. | After 2 |
| 6 | ~~Full vault mirror to Drive~~ | Dropped by decision 5. The existing Drive export job is left as it is |

No schema change was needed for step 1: notes are rows in `wiki_pages`, links are rows in `wiki_page_links` with `link_type = 'wikilink'`, properties and unresolved links live in `metadata`.

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

- The same person under two different mailbox names is still two notes (for example `malik.irfan@` and `irfan.ahmed@`, or a work and a personal address with different spellings). The user's own personal address appears as a person. Step 5 (merge) handles these.
- A shared mailbox whose name is not a role word is taken for a person (`vm@`, "Vision Metric").
- Company notes are titled by domain (`tmcltd.com`), not by the company's name.
- Meeting notes with near-identical titles are separate notes.
- No project, topic, decision or commitment notes yet (step 2b), so contacts and action items are not yet derived.

**Verified:** `tests/wikiStore.test.ts`, `tests/wikiLinks.test.ts`, `tests/wikiBuilder.test.ts`; the counts above read back from the database after the write.

**Not verified:** how Brain's and Suzi's answers change with the new notes in retrieval; the Wiki screen showing the new types.

**Next step:** owner looks at the notes for user 2. Then step 2b: measure what a model pass over the engaged email threads and meeting notes costs for one user, and build project, topic and commitment notes from it.
