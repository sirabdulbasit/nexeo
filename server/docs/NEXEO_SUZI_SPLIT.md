# Nexeo ↔ Suzi split: target direction

Owner direction, 2026-11-02 / 11-03 (PKT). This is the target, not a description of today's code.
For what Nexeo does today, see the function inventory (DEF-384 found by it) and `APP_MENTAL_MODEL.md`.

## Who does what

**Nexeo stores the facts and does the work. It never writes the words a person reads.**

1. **Knowledge**: an LLM-maintained wiki covering email, contacts, organisational context, employees and people.
2. **Connectors**: where knowledge is gathered from. Email, plus external systems. Integrations are external systems, so the Integrations wizard belongs here.
3. **Daily jobs**: collect the data from the connectors and feeds, then build, upgrade and prune the wiki.
4. **Action Center**: actionable items.
5. **Rules, delegations, standing instructions.**

**Suzi does the talking and presenting. It stores no facts of its own; it asks Nexeo.**

1. Live communication with the user, answering from Nexeo's knowledge.
2. Follows the rules, delegations and instructions held in Nexeo.
3. Follows up on the Action Center and generates updates.
4. Sends email, invites and changes using Nexeo's connectors.
5. Real-time presentation, like a weather-news presenter. It builds stats, dashboards and reports live on a transparent or lightly transparent background. **This replaces Nexeo's Day Brief page**, which stays until Suzi's version works.

**Suzi is also a feed into Nexeo.** It sends meeting minutes, instructions it is given, and tasks. Nexeo files these into Knowledge or the Action Center like any other feed.

## The Nexeo portal (web app): management only (owner, 2026-11-03)

The portal is used only to **manage**. Using the knowledge, the actions and the brief happens in Suzi.
- **Admin:** settings, creating new clients, users, and the like.
- **User:** connectors; updating rules, delegations and standing instructions.

Everything else in today's menu becomes a candidate to leave the portal: Day Brief, Action Center, Contacts, Wiki and Health Check. This is a direction, not yet a removal list. The per-screen questions are in `SIMPLIFICATION_PLAN.md` §"Portal: management only".

## The model (LLM)

The model is connected to both sides:
- **Suzi** uses it for all conversation.
- **Nexeo** uses it only for internal jobs: building the wiki from email, mapping proposals, fact extraction.

## Decisions and holds

- **Inbound WhatsApp replies:** in the target, Suzi's always-on server (the Jarvis gateway) writes them. **ON HOLD (owner, 11-02).** Until the hold is lifted, Nexeo Brain keeps answering WhatsApp as it does today.
- **Suzi sending WhatsApp:** goes through Nexeo after the user's voice approval (DEF-383 (3), owner decision 11-02). This is separate from the hold above.
- **Foundations kept, though not one of the five parts:**
  - users, companies and access
  - the tool surface Suzi calls (MCP)
  - approvals and audit trail
  - corrections flowing into the wiki or rules
  - health, alerts and watchdogs
  - wiki privacy and retention
  - wiki search
- **KPIs (owner, 11-03):** business KPIs belong to External Systems. They are connected through the Integrations wizard (API, online sheet link, Excel upload) and mapped there. Brain's own daily scorecard stays as it is.
- **Must be fixed before Suzi acts through Nexeo at scale:** DEF-384. MCP `tools/call` runs HIGH/CRITICAL actions with no approval step.

## Integration contract: the Suzi team's spec, 11-03 (DEF-382)

The Suzi team's terms: Nexeo owns the rules and the Action Center; Suzi is the live voice and the presenter.

| # | Spec | Owner | What exists today | Nexeo work |
|---|---|---|---|---|
| 1 | **Rules to Suzi**, carried in `welcome` or a `GET /v1/rules`, versioned so Suzi can refresh. Contents: persona and tone; delegations (who the user is, who Suzi may act for, what each delegate may ask); approval rules ("always ask before sending email", "may accept invites from my team"); quiet hours and do-not-disturb, including during meetings; language. Rules may only make Suzi **stricter**, never looser. Suzi drops its own standing-instructions block once these arrive | Nexeo serves, gateway fetches | The data is spread across `BrainConfig`, `DelegationMatrix` / `DelegationAuthorizationGrant`, standing instructions, automation level and quiet hours. Nothing combines it for Suzi | One read-only, per-user rules document with a version hash. Gateway → Nexeo access is still unwired (see blocker) |
| 2 | **Action Center follow-ups** open an `assistant_start` turn carrying `{kind:"follow_up", action_id, due}`. The user's answer ("done", "Friday", "Rahat hasn't replied") updates the item server-side, and Suzi confirms in one sentence. No interrupting a meeting | Nexeo pushes, gateway speaks and updates | `tellSuzi` → `/admin/proactive` is live for reminders, critical emails and Task Master asks (DEF-377, not yet seen live). It sends no `action_id`/`due`. Gateway-started turns currently have **no tools**, so the answer cannot update anything | Add `follow_up` + `action_id` + `due` to `tellSuzi`. An Action Center update tool is exposed over MCP. The gateway must let the answer reach that tool |
| 3 | **Connector actions** (email, invites, record changes) run server-side, with Suzi's voice-checked `confirm_action` first for anything that sends, invites or changes data | Gateway asks, Nexeo enforces | The gateway confirms its tier-2 tools. Nexeo's MCP runs HIGH/CRITICAL actions **without any approval** (DEF-384). The gateway's send tools are stubbed | Nexeo requires an approval proof on risky MCP calls (closes DEF-384) |
| 4 | **Presentation**: figures, dashboards and reports go through Suzi's `present_report`, with a `say` line per block | Gateway/Mac | Nexeo has `fetch_kpis` and the Integrations KPI data | Data only, as tools. No wording from Nexeo |
| 5 | **Daily-job findings** (an overdue invoice, an important email) become a short `assistant_start` turn now, or are queued for the morning brief that Suzi presents on the board | Nexeo decides and queues, gateway presents | Proactive push exists. There is no morning-brief queue | A queue of "for the morning brief" findings, plus a read tool for it |

**Blocker for 1–3:** Nexeo tools are still not connected to the gateway ("Waiting on Basit 3" in the gateway's STATUS: agent token, id mapping, how sends are gated; `docs/nexeo-adapter-findings.md` §4/§7).

## Simplification (in progress, 11-03)

The owner asked to simplify the Nexeo screens and remove unnecessary front-end, back-end and database parts. Process:
1. A read-only scan classifies every screen, route, job and table as keep, Suzi, hold or remove. Each removal candidate is then checked by a skeptic that tries to prove it is still in use.
2. **The owner approves the removal list.**
3. Removal happens in small deploys, in this order: screens → server → jobs → database. Tables that hold data are renamed to an archive name first and dropped only later.

Nothing is removed before step 2.
