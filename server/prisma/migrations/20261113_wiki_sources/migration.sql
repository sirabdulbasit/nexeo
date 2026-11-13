-- Wiki first (docs/Wiki-Knowledge.md §0, §6b A1): the Wiki's own lasting store of source text.
-- Owner, 13 Nov 2026: "nothing should be stored or saved outside of wiki"; every feed, incoming
-- knowledge, meeting and discussion lands in the Wiki.
--
-- A source is the thing a note was learned from: one email, message, calendar entry, transcript,
-- attachment or integration record, with its text. Notes cite sources; a source is never a note.
-- Until now the text of an email lived only in an old `email_message` page and the fetched item
-- in `feed_events`, which is pruned after 30 days. Both are part of the Wiki from here on.
--
-- Hand-written and idempotent. Additive: no existing table is changed.

CREATE TABLE IF NOT EXISTS wiki_sources (
  id            TEXT PRIMARY KEY,
  client_number VARCHAR(20) NOT NULL,
  user_id       INT NOT NULL,
  -- Who may read it follows where it came from: a connector's item is the user's ('user'),
  -- an integration's record is the company's ('tenant').
  scope         VARCHAR(10) NOT NULL DEFAULT 'user',
  -- email | calendar | chat | whatsapp | task | transcript | attachment | document | record | conversation
  kind          VARCHAR(30) NOT NULL,
  -- The source's own id (Gmail message id, calendar event id, chat message name, …).
  external_id   TEXT NOT NULL,
  feed_event_id TEXT,
  -- What ties sources of one conversation together (Gmail thread id, chat thread, meeting key).
  thread_key    TEXT,
  title         TEXT,
  occurred_at   TIMESTAMPTZ,
  participants  JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- The text. Exactly one of the two is set when there is text: plain, or encrypted ('v1:…').
  body_text     TEXT,
  body_enc      TEXT,
  -- The fetched item's other fields, as the feed stored them.
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_hash  VARCHAR(64),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS wiki_sources_identity_idx
  ON wiki_sources (client_number, user_id, kind, external_id);
CREATE INDEX IF NOT EXISTS wiki_sources_user_time_idx
  ON wiki_sources (client_number, user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS wiki_sources_thread_idx
  ON wiki_sources (client_number, user_id, thread_key);
CREATE INDEX IF NOT EXISTS wiki_sources_feed_event_idx
  ON wiki_sources (feed_event_id);

-- Which sources a note cites. The trail of a note is this list, in time order.
CREATE TABLE IF NOT EXISTS wiki_note_sources (
  note_id    TEXT NOT NULL,
  source_id  TEXT NOT NULL,
  cited_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, source_id)
);
CREATE INDEX IF NOT EXISTS wiki_note_sources_source_idx ON wiki_note_sources (source_id);
