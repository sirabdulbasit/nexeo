-- Actual cost from the Cloud Billing BigQuery export, summarised daily so a page load never scans
-- BigQuery. Lives here because the billing service account is read-only and cannot create views.
-- Contains client project names: read only through super-admin routes.
-- Hand-written and idempotent.
CREATE TABLE IF NOT EXISTS gcp_billing_daily (
  day            DATE           NOT NULL,
  invoice_month  VARCHAR(6)     NOT NULL,
  project_id     VARCHAR(120)   NOT NULL,
  project_name   VARCHAR(200),
  service        VARCHAR(200)   NOT NULL,
  sku            VARCHAR(300)   NOT NULL,
  gross          NUMERIC(18,6)  NOT NULL DEFAULT 0,
  credits        NUMERIC(18,6)  NOT NULL DEFAULT 0,
  PRIMARY KEY (day, invoice_month, project_id, service, sku)
);
CREATE INDEX IF NOT EXISTS gcp_billing_daily_invoice_idx ON gcp_billing_daily (invoice_month, project_id);

CREATE TABLE IF NOT EXISTS gcp_billing_label_daily (
  day            DATE           NOT NULL,
  invoice_month  VARCHAR(6)     NOT NULL,
  project_id     VARCHAR(120)   NOT NULL,
  label_key      VARCHAR(120)   NOT NULL,
  label_value    VARCHAR(300)   NOT NULL,
  gross          NUMERIC(18,6)  NOT NULL DEFAULT 0,
  credits        NUMERIC(18,6)  NOT NULL DEFAULT 0,
  PRIMARY KEY (day, invoice_month, project_id, label_key, label_value)
);
CREATE INDEX IF NOT EXISTS gcp_billing_label_invoice_idx ON gcp_billing_label_daily (invoice_month, label_key);

CREATE TABLE IF NOT EXISTS gcp_billing_sync (
  id             INTEGER        PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_ok_at     TIMESTAMPTZ(6),
  last_try_at    TIMESTAMPTZ(6),
  last_error     VARCHAR(500),
  rows_loaded    INTEGER        NOT NULL DEFAULT 0
);
