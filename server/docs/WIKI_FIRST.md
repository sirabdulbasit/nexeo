# Wiki first: the one memory of Nexeo and Suzi

The owner's rule, written 2026-11-13. Every part of the product follows it: Nexeo's Feed, Wiki and Think, the Action
Center, the Meeting Assistant, integrations, the portal, and Suzi through the charter. It is a release blocker
(AGENTS.md §2, invariant 9). The design of the Wiki itself is in `BRAIN_WIKI.md`.

## 1. The owner's words

- 2026-11-12: "build wiki who contain entire knowledge of brain", "wiki should work like obsidian the way obsidian
  build the knowledge", "everything should be derived through wiki like Actionable items, contacts", "one wiki and all
  integration should be part of this wiki".
- 2026-11-13: "entire knowledge should be retrieve or placed in wiki", "my strongest recommendation that entire
  knowledge of brain should be part of wiki (new wiki like obsidian)", "nothing should be stored or saved outside of
  wiki", "create/update document of wiki knowledge and entire product including suzi should follow it".

## 2. The rule

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

## 3. What each part does

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

## 4. What is not knowledge (proposed boundary, owner to confirm)

These are mechanics, not knowledge, and are proposed to stay outside the Wiki: accounts and sign-in, OAuth tokens and
secrets, the audit trail, job and run bookkeeping, idempotency and delivery logs, outbound queues, consumption counters,
and caches or indexes derived from the Wiki. None of them holds a fact about the world that exists nowhere else.

## 5. Where Nexeo stands today, and who moves what

Knowledge still kept outside the new Wiki on 2026-11-13. Each moves in, then its old store is retired or kept only as a
derived index. Owner of each move in brackets.

| Store | Holds | Move |
|---|---|---|
| Old wiki pages (`wiki_pages` of earlier types, ~15,800, half `email_message`) | Email text, person and sender pages, observations | BRAIN_WIKI.md §6b, A1 to C [Brain Wiki] |
| `feed_events` | The fetched items | Stays the intake queue; the source text moves to the Wiki's source store, A1 [Brain Wiki] |
| `open_items` | Action items | Commitment notes, A2; items become a view, DEF-450 [Brain Wiki, then Nexeo-Builder] |
| `persons`, `entities` | Contacts | Person and company notes, B2 [Brain Wiki] |
| `meeting_records` (F-4, built 12 Nov) | Meeting records and transcripts | Meeting notes plus the transcript as a source [Nexeo-Builder, once A1 exists; until then it is the only copy and is not deleted] |
| `user_action_rules`, `delegation_matrix`, instruction pages | Rules, delegations, standing instructions | Rule and instruction notes, A3 [Brain Wiki, then Nexeo-Builder for the Suzi ops] |
| `kpi_readings` | Integration figures | Notes per KPI and business unit, kept as the exact store underneath (owner, 11-12) [Brain Wiki] |
| Suzi's working copy | A read-only, encrypted copy | Already derived from Nexeo (charter); nothing to move |

## 6. How every change follows the rule

1. Before building, the change says which notes and sources it writes and reads. A new table that would hold knowledge
   is not built.
2. Until a store has moved, new work on it writes to the Wiki as well, so the Wiki becomes complete first and the old
   store can then be retired without loss.
3. A change that alters what Suzi receives is agreed with Suzi Master first (`NEXEO_SUZI_AGREEMENT.md`).
4. The three Brain documents record each move (DEF rows, chart rows).
