# Nexeo ↔ Suzi split: target direction

Owner direction, 2026-11-02 / 11-03 (PKT). This is the target, not a description of today's code.
For what Nexeo does today, see the function inventory (DEF-381 found by it) and `APP_MENTAL_MODEL.md`.

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

## The model (LLM)

The model is connected to both sides:
- **Suzi** uses it for all conversation.
- **Nexeo** uses it only for internal jobs: building the wiki from email, mapping proposals, fact extraction.

## Decisions and holds

- **Inbound WhatsApp replies:** in the target, Suzi's always-on server (the Jarvis gateway) writes them. **ON HOLD (owner, 11-02).** Until the hold is lifted, Nexeo Brain keeps answering WhatsApp as it does today.
- **Suzi sending WhatsApp:** goes through Nexeo after the user's voice approval (DEF-380 (3), owner decision 11-02). This is separate from the hold above.
- **Foundations kept, though not one of the five parts:**
  - users, companies and access
  - the tool surface Suzi calls (MCP)
  - approvals and audit trail
  - corrections flowing into the wiki or rules
  - health, alerts and watchdogs
  - wiki privacy and retention
  - wiki search
- **Undecided:** KPIs (a part of their own, or part of Knowledge).
- **Must be fixed before Suzi acts through Nexeo at scale:** DEF-381. MCP `tools/call` runs HIGH/CRITICAL actions with no approval step.

## Simplification (in progress, 11-03)

The owner asked to simplify the Nexeo screens and remove unnecessary front-end, back-end and database parts. Process:
1. A read-only scan classifies every screen, route, job and table as keep, Suzi, hold or remove. Each removal candidate is then checked by a skeptic that tries to prove it is still in use.
2. **The owner approves the removal list.**
3. Removal happens in small deploys, in this order: screens → server → jobs → database. Tables that hold data are renamed to an archive name first and dropped only later.

Nothing is removed before step 2.
