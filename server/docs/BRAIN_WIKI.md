# Brain Wiki

Status: **proposal, nothing built.** Written 2026-11-12 by the Brain Wiki session.
Owner direction is in §1. Everything from §4 on is a proposal awaiting his answer to §7.

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
- **The Drive vault** mirrors all of it, so it opens in Obsidian with the graph.

## 5. Proposed build order

1. **The two doors.** One intake function every feed calls; one read interface Think calls. Move the 35 writers and 50 readers behind them, without changing behaviour. A test fails if any other file touches `wiki_pages`.
2. **Links in the text.** Notes carry `[[links]]`; link table rebuilt from text; backlinks returned by the read door.
3. **Notes instead of email pages.** New email goes into person, project and topic notes as a cited source. Existing email pages folded in, then retired (nothing deleted without the owner's yes).
4. **Contacts derived** from person notes.
5. **Action items derived** from commitment notes, keeping the one gate agreed 2026-11-12.
6. **Full vault mirror** to Drive.

Each step ships on its own and leaves the product working.

## 6. Suzi

The charters name the knowledge route and wiki slices in the day pack. Steps 1 to 3 keep what those return unchanged. Before step 4 or 5 changes any field Suzi reads, it is proposed in `NEXEO_SUZI_AGREEMENT.md` first.

## 7. Open decisions (owner)

1. Is the wiki the master for contacts and action items (current tables become derived copies), or a mirror of them? His words point to master.
2. May the roughly 7,900 email pages be folded into notes and retired?
3. Who owns Feed and Think, so the two doors can be agreed with them?

## 8. State

- Live: nothing from this document.
- Next step: owner answers §7; then step 1 of §5 (the two doors), starting with the full list of writers and readers.
