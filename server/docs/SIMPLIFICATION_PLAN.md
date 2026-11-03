# Nexeo simplification: removal list for owner approval

Prepared 2026-11-03, about 01:30 PKT, from read-only scans. Nothing has been removed.

**Method.** Two scans covered 403 items: 126 screens and server routes/services, and 277 jobs, tables, flags and scripts. Each item was checked against the five parts in `NEXEO_SUZI_SPLIT.md`. A separate skeptic pass then tried to prove that each of the 110 removal candidates is still in use. The lead ran production checks, read-only:
- **Flags:** none of the 5 off-by-default flags has an override row.
- **Row counts (exact):** 13 candidate tables are empty, `thought_entries` has 39, `orchestrator_spend` 118, `brain_detected_gaps` 1.
- **AI provider:** set to `vertex`.
- **pm2:** `tmcai-agents` (the Python fleet) is **online but idle**. Its logs have been empty since rotation.

Raw results (scratchpad, this session): `simplify_screens_server.json`, `simplify_jobs_tables.json`, `verify_*.json`.

## A. Safe to remove (passed the skeptic check)

**Screens**
- Old full-page chat `/chat-legacy`, with its 18-file tree and the old rail whose Search button does nothing
- Four page files with no route: ClientConfig, Knowledge, SystemConfig, Tenant
- Top-bar search that is imported but never shown
- "How Nexeo Works" tab. It calls `/me/capabilities`, a route that does not exist, so its live lines never show
- Company OneDrive and Dropbox entries marked "Coming soon"
- OpenAI, OpenRouter and Custom AI-provider buttons, which answer "not implemented". Production uses vertex
- **Partly:**
  - Brain memory page: the page goes; the artifacts and memories endpoints stay
  - Old steering tabs: ActionForms, CustomActionTab and WikiTab go. ActionExecutionTab, the only approval-queue screen ever built, stays
  - Duplicate routes `/settings` and `/open-items` go. `/contacts` stays because contact pages link back to it
  - Floating "thinking" avatar: the component goes; `/brief/cognitive` stays

**Server**
- Legacy `/chat` API and the files only it reaches. **Keep** `controllers/chat/dataRetrieval.ts`, `piiCache.ts` and `types.ts`, which the held agents code imports. Remove the Apache `<Location /api/chat>` block in the same change
- `/conversations` and `/logs`, both used only by the old chat. `/personal-drive`
- Developer portal and external API: keys, spec, branding, marketplace, and the `/query` endpoint that answers 501
- `/analytics`, `/usage`, and `/admin/cost/*`, which duplicates the LLM Spend tab
- `/uploads`, the `/drafts` "Phase 1 stub", `/index`, and the old single-account Drive login `/auth`
- Old action-execution service plus the ADK flags. Edit `adkDispatchStatus.test.ts` rather than deleting it
- Unused code: the drive feed adapter, the SLA monitor, `swallowedError`, the `config` zod schema, the multi-step plan executor (used only by a smoke script), and the `transfer_to_agent` placeholder, which reports success but sends nothing
- Endpoints nothing calls:
  - `/integration/emails`, `/emails/unread` and the calendar and permission reads
  - connector-admin `/org/configure` and the related endpoints
  - brainAsk `/brain/entities`, `/brain/wiki/health`, `/scribe-backfill` and `/wiki/lint`
- `/push` subscribe, devices, prefs and test. The client has no service worker. **Keep** `/push/approval/:token/*`
- **Partly:** about 30 connectors listed with no adapter (Trello, Jira, HubSpot, Zoom, Telegram, BigQuery and others). Also edit briefRoutes options, msGraphHelper types and the Connectors/Guide pages. `notion_org` and `notion_tasks` have an adapter, so decide those separately

**Background jobs**
- Index-event processor and proactive intelligence. Their flag is off everywhere
- Personal Drive sync. Flag off
- Notion mirror and Notion reverse sync. The Notion connector is pending
- Scheduled AI reports (0 rows) and per-user Brain Engine schedules (none set). These go together with the Scheduled Reports page
- Embedding backfill and junk-contact cleanup, which are never scheduled. The build-loop systemd unit, which is not installed
- Scripts:
  - 37 dev smoke scripts
  - one-off May backfills, **except** the two that `def129` reads and `backfillItemEntityLink.ts`. Edit `operatorScriptParity.test.ts` with these
- Flags: `feature_proactive_alerts`, `ff_personal_gdrive`, `feature_notion_reverse_sync`, `feature_knowledge_base`

**Database.** These go last, each in a hand-written migration:
- Empty: `index_events`, `proactive_alerts`, `scheduled_tasks`, `personal_documents`, `personal_chunks`, `domain_knowledge`, `brain_product_proposals`, `brain_development_requests`
- `okrs` (0 rows). **First** remove it from the merge list at `identityResolutionService.ts:64`; otherwise every contact merge fails
- `scheduled_tasks`. Also edit `userContextService.ts:86-91`, `dataManagementService.ts`, `prisma.ts:83`
- `brain_detected_gaps` (1 row): dump to a file, then drop
- 19 May-2026 backup tables (`*_wipe_*`, `*_2026_05_2x`): the statistics show 0 live rows, but get an exact count and dump each to a file before dropping. Delete the dated May SQL scripts together with them

## B. Kept, although they looked unused

**Needed for the target** (Suzi's rules feed, follow-ups, approvals):
- `/admin/delegation-matrix` and `/gate-rules`. These are part 5 and have no screen yet
- Open-items delegate, note, history and transition endpoints. These are the Action Center update surface
- `/decisions`, `/brain/docs` and `/risk-radar` (latest, history, config). These cover audit and the morning brief
- `delegationFollowUpJob`'s chase verdict, with its email writer removed. `openItemFollowUpJob`. `delegation_authorization_grants`. `push_subscriptions`

**Still in use**
- `thought_entries`, still written by the `extract_insight` action. The Thoughts page and its jobs are kept for now
- The "My Team" agents page and its tables, which are tied to inbound WhatsApp (held)
- Disk cleanup, which raises the disk-pressure health finding
- `knowledge_items` and `agent_memory`, which rule actions write

**Held**
- Everything WhatsApp
- Build Pulse and Build Spend, which read state files another session is changing
- **Routes only the Python fleet calls**, pending the owner's fleet decision: `/knowledge`, `/entities`, `/triage/archetype`, `/wiki` (agent API), `pubsubHandler`

## Owner answers, 2026-11-03 ~01:35 PKT

- **Removal list:** APPROVED, in 4 steps (screens → server → jobs → database). Each step is its own deploy. Tables are dumped before they are dropped.
- **Nightly build:** STOP IT, KEEP LEARNING. First move `nexeoLearnSweep` into a server daily job, then remove the 02:30 cron line.
- **Python fleet:** RETIRE. Stop `tmcai-agents` in pm2, and remove its five routes in the server step.
- **KPIs:** ON HOLD. The owner will explain later. Nothing KPI-related is touched.
- **Nexeo ↔ Suzi wiring (item 4):** not asked yet; still open.

## Progress

- **Step 1 (screens):** LIVE, D-147 (client, c342e4a).
- **Server half of step 1, plus learning moved into the server:** LIVE, D-148 (5758cce).
- **Nightly build cron line:** REMOVED 11-03 ~12:10 PKT. The crontab backup is in /root/backups. The first server-run LEARN pass is due 11-04 07:30 PKT.
- **Next:**
  - step 2 (server removals, plus retiring `tmcai-agents`)
  - step 3 (jobs and scripts)
  - step 4 (database)

## Portal: management only (owner, 2026-11-03 ~12:10 PKT)

The owner's direction: the Nexeo portal is used only to manage.
- **Admin:** settings, new clients, users.
- **User:** connectors, rules, delegations, standing instructions.

Today's menu, against that direction:

| Tab | Fits "manage"? | Proposed |
|---|---|---|
| Connectors | yes | keep |
| My Rules (rules, delegations, standing instructions) | yes | keep. The delegation-matrix and gate-rules editors (kept in B) belong here |
| Settings | yes | keep. Brain automation level moves here from the hidden `/brain` page |
| Admin / Client Config | yes | keep |
| Health Check | partly. It is where "reconnect this connector" lives | fold into Connectors |
| Day Brief | no. It moves to Suzi | leaves the menu once Suzi presents the brief |
| Action Center | no. Suzi follows up | leaves the menu once Suzi's follow-ups work (DEF-382 #2) |
| Contacts / Wiki | no. This is knowledge, and Suzi answers from it | leaves the menu once Suzi has matured |

**Owner answer, 11-03:** Day Brief, Action Center, Contacts, Wiki and Health Check **stay in the portal for now**. Ideally Suzi has them and the portal doesn't need them, so each one is removed **once Suzi has matured**. Until then nothing in this table is hidden or removed.

## C. Owner decisions (as asked)

1. **Nightly self-improvement build** (crontab 02:30, `scripts/orchestrator/nightly-iteration.sh`). It ran 78 times since 08-19, never passed its check, and cost about $1,427. Stopping it also stops:
   - the only runner of learning (`nexeoLearnSweep`: interaction distillation and memory self-activation)
   - the chat harvest, `intake.sh` and Grok scoring
   - the regression guard
   - automatic deploys
   - the Steering "heal now" button, which runs the same script

   To stop the build and keep learning, the learning sweep must first move into a server job.
2. **Python agent fleet** (`tmcai-agents`, pm2 online, idle): retire it, or keep it.
3. **KPIs:** part of Knowledge, or a sixth part.
4. **Nexeo ↔ Suzi wiring** (DEF-382 blocker): the agent token, the id mapping, and sends gated by approval proof (DEF-384).

## Order, once approved

Each step is a separate deploy with its own tests and evaluation-chart row:
1. Screens
2. Server
3. Jobs and scripts
4. Database: dump first, then drop
