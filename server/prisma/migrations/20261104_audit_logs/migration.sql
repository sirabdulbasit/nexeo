-- DEF-389 — the general audit trail. auditLogService.audit() has always inserted into audit_logs,
-- and this table was never created, so every audit line was lost (the service swallows the error
-- by design). audit_log, singular, is a different table: query analytics.
--
-- Hand-written and idempotent. Columns are exactly what audit() writes and listAuditEntries() reads.
-- Raw SQL only, no Prisma model: the service has always used raw queries on it.
CREATE TABLE IF NOT EXISTS audit_logs (
  id            BIGSERIAL      PRIMARY KEY,
  client_number VARCHAR(20)    NOT NULL,
  actor_id      INTEGER,
  actor_kind    VARCHAR(20)    NOT NULL DEFAULT 'user',
  action        VARCHAR(100)   NOT NULL,
  subject_type  VARCHAR(60),
  subject_id    VARCHAR(200),
  result        VARCHAR(20)    NOT NULL DEFAULT 'success',
  ip            VARCHAR(64),
  user_agent    TEXT,
  request_id    VARCHAR(100),
  details       JSONB          NOT NULL DEFAULT '{}',
  created_at    TIMESTAMP(3)   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_created_idx ON audit_logs (client_number, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_action_idx ON audit_logs (client_number, action, created_at DESC);
