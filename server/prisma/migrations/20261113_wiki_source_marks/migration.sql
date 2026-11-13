-- Wiki first (docs/Wiki-Knowledge.md §0.12, §0.12.1): the marks on a source.
-- Owner, 13 Nov 2026: "all emails should be land in wiki and marked with rules (none of email
-- should be missed); morning brief or Suzi will extract emails, actionable items, meetings from wiki".
--
-- A source is what was fetched and never changes. A mark is a judgement about it, made for one
-- user, that does change: whether it needs him, which of his rules applied, whether he handled
-- it, the action item or meeting it led to. A new mark of the same kind and key supersedes the
-- earlier one and keeps it, so what was believed before can be read back.
--
-- Hand-written and idempotent. Additive: no existing table is changed.

CREATE TABLE IF NOT EXISTS wiki_source_marks (
  id            BIGSERIAL PRIMARY KEY,
  source_id     TEXT NOT NULL,
  client_number VARCHAR(20) NOT NULL,
  -- The user the mark was made for. Only this user reads it.
  user_id       INT NOT NULL,
  -- attention | rule | handled | action_item | meeting
  kind          VARCHAR(30) NOT NULL,
  -- Tells apart several marks of one kind: the rule's id, the open item's id. Empty when a kind has one value.
  mark_key      VARCHAR(200) NOT NULL DEFAULT '',
  value         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Who set it: 'triage:v2', 'rule:<id>', 'user', 'suzi'.
  set_by        VARCHAR(120) NOT NULL,
  set_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set when a newer mark of the same kind and key replaced this one, or when it was cleared.
  superseded_at TIMESTAMPTZ
);

-- One current mark per source, user, kind and key.
CREATE UNIQUE INDEX IF NOT EXISTS wiki_source_marks_current_idx
  ON wiki_source_marks (source_id, user_id, kind, mark_key) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS wiki_source_marks_user_kind_idx
  ON wiki_source_marks (client_number, user_id, kind) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS wiki_source_marks_source_idx
  ON wiki_source_marks (source_id, set_at);
