# Actual GCP cost on the LLM Consumption page

Admin → LLM Consumption shows two things:

1. **LLM Consumption:** our own records, by client, user, service, date or month. Costs are estimates. Tenant admins see their own client; super admins see all.
2. **Actual cost (Google billing):** super admins only, because rows name client projects. Daily net chart, projects, SKUs per project, budget, month against month, labels.

## Source and flow
BigQuery export `ispl-billing-analytics.billing_export.gcp_billing_export_v1_01666C_EB28DA_B98F96`, which starts on 5 Nov 2026 and cannot be backfilled. The service account is read-only, so it cannot create views: the summary is in Postgres (`gcp_billing_daily`, `gcp_billing_label_daily`, `gcp_billing_sync`). The server checks hourly and scans at most once every 6 h, reloading the last 70 days. Pages read only Postgres. Refresh on the page is limited to once every 5 minutes.

## Rules
- Net = cost + credits (credits are negative).
- Days are Pacific time, to match the console. Consumption dates are UTC, so the two sections do not line up day by day.
- The latest 3 Pacific days are marked not final and left out of averages, as is the export's first day.
- Month totals and month comparison use `invoice.month`.
- Tax and adjustment rows are included; rows without a project show as `(no project)`.

## Setup (server environment, never the repo)
- `GCP_BILLING_SA_KEY_FILE` (path) or `GCP_BILLING_SA_JSON` (contents): key for `billing-reader@ispl-billing-analytics.iam.gserviceaccount.com`.
- `GCP_BILLING_MONTHLY_BUDGET_USD`: optional monthly budget.
- Apply migration `20261105_gcp_billing_daily`.

## State, 5 Nov 2026
Built and tested with a stand-in for BigQuery. **Not deployed; never run against the real export.** Next: set the key, deploy, press Refresh, compare with the console to the cent, and report any gap rather than adjusting figures.
