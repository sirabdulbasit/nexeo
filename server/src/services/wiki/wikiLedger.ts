/**
 * Wiki ledger — the account of every place Nexeo keeps anything
 * (docs/Wiki-Knowledge.md §0: "nothing should be stored or saved outside of wiki").
 *
 * Every table of the database is named here with what it holds and where it
 * goes. `tests/wikiFirstLedger.test.ts` fails when a table exists that is not
 * named here, and when the number of stores still outside the Wiki goes up.
 * So a new store cannot appear unnoticed, and the count can only fall.
 *
 * Kinds:
 *   wiki       the Wiki itself
 *   knowledge  knowledge kept outside the Wiki today; it moves in as notes or sources
 *   trail      the record of what happened (audit, usage, jobs, reasoning); it moves in as record notes
 *   setup      settings, identity and secrets; they move in, secrets encrypted
 *   working    a queue or cache the product runs from; allowed to stay, the Wiki holds the record
 *   leftover   a backup copy from an earlier clean-up; removed on the owner's yes
 *   system     the database's own bookkeeping
 *
 * When a store has moved into the Wiki, its entry here is deleted (the table is
 * dropped) or becomes `working` (it is now only an index rebuilt from the Wiki),
 * and the ceilings in the test are lowered to match.
 */
import prisma from '../../db/prisma';

export type LedgerKind = 'wiki' | 'knowledge' | 'trail' | 'setup' | 'working' | 'leftover' | 'system';

export interface LedgerEntry {
  kind: LedgerKind;
  /** Where it goes in the Wiki, in plain words. */
  to: string;
}

export const WIKI_LEDGER: Record<string, LedgerEntry> = {
  // The Wiki itself
  "wiki_note_sources": { kind: 'wiki', to: "The Wiki itself: which sources a note cites" },
  "wiki_page_links": { kind: 'wiki', to: "The Wiki itself" },
  "wiki_page_sources": { kind: 'wiki', to: "The Wiki itself" },
  "wiki_pages": { kind: 'wiki', to: "The Wiki itself" },
  "wiki_source_marks": { kind: 'wiki', to: "The Wiki itself: what is known about a source beyond its text (needs him, rule applied, handled)" },
  "wiki_sources": { kind: 'wiki', to: "The Wiki itself: the text notes were learned from" },
  // Person and company notes (B2)
  "entities": { kind: 'knowledge', to: "Person and company notes (B2)" },
  "entity_links": { kind: 'knowledge', to: "Person and company notes (B2)" },
  "person_facets": { kind: 'knowledge', to: "Person and company notes (B2)" },
  "persons": { kind: 'knowledge', to: "Person and company notes (B2)" },
  "user_resolution_aliases": { kind: 'knowledge', to: "Person and company notes (B2)" },
  // Commitment notes; the item list becomes a view (A2, DEF-450)
  "delegation_logs": { kind: 'knowledge', to: "Commitment notes; the item list becomes a view (A2, DEF-450)" },
  "delegation_thread_events": { kind: 'knowledge', to: "Commitment notes; the item list becomes a view (A2, DEF-450)" },
  "delegation_threads": { kind: 'knowledge', to: "Commitment notes; the item list becomes a view (A2, DEF-450)" },
  "open_items": { kind: 'knowledge', to: "Commitment notes; the item list becomes a view (A2, DEF-450)" },
  // Meeting notes, transcript as the cited source
  "meeting_records": { kind: 'knowledge', to: "Meeting notes, transcript as the cited source" },
  // Sources: the text of every message
  "brain_inbox_messages": { kind: 'knowledge', to: "Sources: the text of every message" },
  "brain_user_messages": { kind: 'knowledge', to: "Sources: the text of every message" },
  "conversations": { kind: 'knowledge', to: "Sources: the text of every message" },
  "messages": { kind: 'knowledge', to: "Sources: the text of every message" },
  "whatsapp_messages": { kind: 'knowledge', to: "Sources: the text of every message" },
  "whatsapp_outbound_messages": { kind: 'knowledge', to: "Sources: the text of every message" },
  // Rule and instruction notes (A3)
  "delegation_authorization_grants": { kind: 'knowledge', to: "Rule and instruction notes (A3)" },
  "delegation_matrix": { kind: 'knowledge', to: "Rule and instruction notes (A3)" },
  "gate_rule_overrides": { kind: 'knowledge', to: "Rule and instruction notes (A3)" },
  "gate_rules": { kind: 'knowledge', to: "Rule and instruction notes (A3)" },
  "muted_senders": { kind: 'knowledge', to: "Rule and instruction notes (A3)" },
  "risk_rule_overrides": { kind: 'knowledge', to: "Rule and instruction notes (A3)" },
  "risk_rules": { kind: 'knowledge', to: "Rule and instruction notes (A3)" },
  "rule_lifecycle": { kind: 'knowledge', to: "Rule and instruction notes (A3)" },
  "shadow_rules": { kind: 'knowledge', to: "Rule and instruction notes (A3)" },
  "user_action_rules": { kind: 'knowledge', to: "Rule and instruction notes (A3)" },
  "wa_sender_policy": { kind: 'knowledge', to: "Rule and instruction notes (A3)" },
  // Notes about the user: memories, preferences, what Brain learned
  "agent_memory": { kind: 'knowledge', to: "Notes about the user: memories, preferences, what Brain learned" },
  "clarification_memory": { kind: 'knowledge', to: "Notes about the user: memories, preferences, what Brain learned" },
  "governed_brain_memories": { kind: 'knowledge', to: "Notes about the user: memories, preferences, what Brain learned" },
  "pattern_hidden": { kind: 'knowledge', to: "Notes about the user: memories, preferences, what Brain learned" },
  "pattern_insights": { kind: 'knowledge', to: "Notes about the user: memories, preferences, what Brain learned" },
  "thought_entries": { kind: 'knowledge', to: "Notes about the user: memories, preferences, what Brain learned" },
  "user_learning": { kind: 'knowledge', to: "Notes about the user: memories, preferences, what Brain learned" },
  "user_memories": { kind: 'knowledge', to: "Notes about the user: memories, preferences, what Brain learned" },
  "user_profile_memory": { kind: 'knowledge', to: "Notes about the user: memories, preferences, what Brain learned" },
  // Document notes and their text as sources
  "brain_docs": { kind: 'knowledge', to: "Document notes and their text as sources" },
  "chunks": { kind: 'knowledge', to: "Document notes and their text as sources" },
  "documents": { kind: 'knowledge', to: "Document notes and their text as sources" },
  "domain_knowledge": { kind: 'knowledge', to: "Document notes and their text as sources" },
  "integration_source_files": { kind: 'knowledge', to: "Document notes and their text as sources" },
  "knowledge_items": { kind: 'knowledge', to: "Document notes and their text as sources" },
  "personal_chunks": { kind: 'knowledge', to: "Document notes and their text as sources" },
  "personal_documents": { kind: 'knowledge', to: "Document notes and their text as sources" },
  "risk_flag_docs": { kind: 'knowledge', to: "Document notes and their text as sources" },
  // KPI and business-unit notes; kpi_readings stays underneath as the exact figures
  "kpi_definitions": { kind: 'knowledge', to: "KPI and business-unit notes; kpi_readings stays underneath as the exact figures" },
  "kpi_readings": { kind: 'knowledge', to: "KPI and business-unit notes; kpi_readings stays underneath as the exact figures" },
  "kpi_values": { kind: 'knowledge', to: "KPI and business-unit notes; kpi_readings stays underneath as the exact figures" },
  "okrs": { kind: 'knowledge', to: "KPI and business-unit notes; kpi_readings stays underneath as the exact figures" },
  // A note per integration (source, mapping, last run)
  "integration_mapping_versions": { kind: 'knowledge', to: "A note per integration (source, mapping, last run)" },
  "integration_suggestions": { kind: 'knowledge', to: "A note per integration (source, mapping, last run)" },
  "integration_syncs": { kind: 'knowledge', to: "A note per integration (source, mapping, last run)" },
  // Notes of what Brain found or was told about itself
  "brain_detected_gaps": { kind: 'knowledge', to: "Notes of what Brain found or was told about itself" },
  "brain_development_requests": { kind: 'knowledge', to: "Notes of what Brain found or was told about itself" },
  "brain_feedback": { kind: 'knowledge', to: "Notes of what Brain found or was told about itself" },
  "brain_health_findings": { kind: 'knowledge', to: "Notes of what Brain found or was told about itself" },
  "brain_product_proposals": { kind: 'knowledge', to: "Notes of what Brain found or was told about itself" },
  "correlation_incident_candidates": { kind: 'knowledge', to: "Notes of what Brain found or was told about itself" },
  "correlation_incidents": { kind: 'knowledge', to: "Notes of what Brain found or was told about itself" },
  "feedback": { kind: 'knowledge', to: "Notes of what Brain found or was told about itself" },
  "proactive_alerts": { kind: 'knowledge', to: "Notes of what Brain found or was told about itself" },
  "retrieval_feedback": { kind: 'knowledge', to: "Notes of what Brain found or was told about itself" },
  "suzi_gaps": { kind: 'knowledge', to: "Notes of what Brain found or was told about itself" },
  // Instruction notes: how Brain is told to behave
  "action_definitions": { kind: 'knowledge', to: "Instruction notes: how Brain is told to behave" },
  "action_dependencies": { kind: 'knowledge', to: "Instruction notes: how Brain is told to behave" },
  "capability_registry": { kind: 'knowledge', to: "Instruction notes: how Brain is told to behave" },
  "golden_dataset": { kind: 'knowledge', to: "Instruction notes: how Brain is told to behave" },
  "prompt_blocks": { kind: 'knowledge', to: "Instruction notes: how Brain is told to behave" },
  "user_prompt_overlay": { kind: 'knowledge', to: "Instruction notes: how Brain is told to behave" },
  "user_prompts": { kind: 'knowledge', to: "Instruction notes: how Brain is told to behave" },
  // The trail of a note: its cited sources and state changes
  "brain_action_artifacts": { kind: 'trail', to: "The trail of a note: its cited sources and state changes" },
  "decision_logs": { kind: 'trail', to: "The trail of a note: its cited sources and state changes" },
  "delegation_matrix_history": { kind: 'trail', to: "The trail of a note: its cited sources and state changes" },
  "entity_merge_audit": { kind: 'trail', to: "The trail of a note: its cited sources and state changes" },
  "integration_run_changes": { kind: 'trail', to: "The trail of a note: its cited sources and state changes" },
  "integration_runs": { kind: 'trail', to: "The trail of a note: its cited sources and state changes" },
  "item_status_history": { kind: 'trail', to: "The trail of a note: its cited sources and state changes" },
  "meet_event_receipts": { kind: 'trail', to: "The trail of a note: its cited sources and state changes" },
  // Record notes: what was done, by whom, when
  "action_idempotency_logs": { kind: 'trail', to: "Record notes: what was done, by whom, when" },
  "action_undo_log": { kind: 'trail', to: "Record notes: what was done, by whom, when" },
  "agent_actions": { kind: 'trail', to: "Record notes: what was done, by whom, when" },
  "agent_runs": { kind: 'trail', to: "Record notes: what was done, by whom, when" },
  "audit_log": { kind: 'trail', to: "Record notes: what was done, by whom, when" },
  "audit_logs": { kind: 'trail', to: "Record notes: what was done, by whom, when" },
  "brain_resets": { kind: 'trail', to: "Record notes: what was done, by whom, when" },
  "index_events": { kind: 'trail', to: "Record notes: what was done, by whom, when" },
  "job_runs": { kind: 'trail', to: "Record notes: what was done, by whom, when" },
  "operator_runs": { kind: 'trail', to: "Record notes: what was done, by whom, when" },
  "self_heal_log": { kind: 'trail', to: "Record notes: what was done, by whom, when" },
  "self_prune_notice_batches": { kind: 'trail', to: "Record notes: what was done, by whom, when" },
  "suzi_act_log": { kind: 'trail', to: "Record notes: what was done, by whom, when" },
  // Record notes: usage and cost
  "consumption_events": { kind: 'trail', to: "Record notes: usage and cost" },
  "llm_spend": { kind: 'trail', to: "Record notes: usage and cost" },
  "llm_spend_daily": { kind: 'trail', to: "Record notes: usage and cost" },
  "orchestrator_spend": { kind: 'trail', to: "Record notes: usage and cost" },
  "token_query_log": { kind: 'trail', to: "Record notes: usage and cost" },
  "token_usage": { kind: 'trail', to: "Record notes: usage and cost" },
  // Record notes: how Brain reasoned and was scored
  "brain_interaction_learning_logs": { kind: 'trail', to: "Record notes: how Brain reasoned and was scored" },
  "brain_maturity_snapshots": { kind: 'trail', to: "Record notes: how Brain reasoned and was scored" },
  "brain_response_evaluations": { kind: 'trail', to: "Record notes: how Brain reasoned and was scored" },
  "gate_rule_firings": { kind: 'trail', to: "Record notes: how Brain reasoned and was scored" },
  "reasoning_traces": { kind: 'trail', to: "Record notes: how Brain reasoned and was scored" },
  "shadow_scores": { kind: 'trail', to: "Record notes: how Brain reasoned and was scored" },
  "system_logs": { kind: 'trail', to: "Record notes: how Brain reasoned and was scored" },
  // Setting notes: the account, licences and configuration
  "agents": { kind: 'setup', to: "Setting notes: the account, licences and configuration" },
  "brain_configs": { kind: 'setup', to: "Setting notes: the account, licences and configuration" },
  "client_licenses": { kind: 'setup', to: "Setting notes: the account, licences and configuration" },
  "connector_types": { kind: 'setup', to: "Setting notes: the account, licences and configuration" },
  "criticality_calibration": { kind: 'setup', to: "Setting notes: the account, licences and configuration" },
  "licenses": { kind: 'setup', to: "Setting notes: the account, licences and configuration" },
  "operator_settings": { kind: 'setup', to: "Setting notes: the account, licences and configuration" },
  "scheduled_tasks": { kind: 'setup', to: "Setting notes: the account, licences and configuration" },
  "suzi_rules_version": { kind: 'setup', to: "Setting notes: the account, licences and configuration" },
  "system_config": { kind: 'setup', to: "Setting notes: the account, licences and configuration" },
  "tenant_connector_configs": { kind: 'setup', to: "Setting notes: the account, licences and configuration" },
  "tenant_whatsapp_notifier": { kind: 'setup', to: "Setting notes: the account, licences and configuration" },
  "tenants": { kind: 'setup', to: "Setting notes: the account, licences and configuration" },
  "user_tiers": { kind: 'setup', to: "Setting notes: the account, licences and configuration" },
  "users": { kind: 'setup', to: "Setting notes: the account, licences and configuration" },
  "whatsapp_config": { kind: 'setup', to: "Setting notes: the account, licences and configuration" },
  // Secrets, kept encrypted in the Wiki and never shown as text
  "agent_api_tokens": { kind: 'setup', to: "Secrets, kept encrypted in the Wiki and never shown as text" },
  "approval_tokens": { kind: 'setup', to: "Secrets, kept encrypted in the Wiki and never shown as text" },
  "meet_event_subscriptions": { kind: 'setup', to: "Secrets, kept encrypted in the Wiki and never shown as text" },
  "push_subscriptions": { kind: 'setup', to: "Secrets, kept encrypted in the Wiki and never shown as text" },
  "sessions": { kind: 'setup', to: "Secrets, kept encrypted in the Wiki and never shown as text" },
  "user_connectors": { kind: 'setup', to: "Secrets, kept encrypted in the Wiki and never shown as text" },
  "whatsapp_connections": { kind: 'setup', to: "Secrets, kept encrypted in the Wiki and never shown as text" },
  "whatsapp_sessions": { kind: 'setup', to: "Secrets, kept encrypted in the Wiki and never shown as text" },
  // A queue or cache the product runs from; the Wiki holds the record
  "brain_pending_actions": { kind: 'working', to: "A queue or cache the product runs from; the Wiki holds the record" },
  "brain_prompt_queue": { kind: 'working', to: "A queue or cache the product runs from; the Wiki holds the record" },
  "criticality_fusion_cache": { kind: 'working', to: "A queue or cache the product runs from; the Wiki holds the record" },
  "feed_events": { kind: 'working', to: "A queue or cache the product runs from; the Wiki holds the record" },
  "job_leases": { kind: 'working', to: "A queue or cache the product runs from; the Wiki holds the record" },
  "notification_queue": { kind: 'working', to: "A queue or cache the product runs from; the Wiki holds the record" },
  "ops_health_state": { kind: 'working', to: "A queue or cache the product runs from; the Wiki holds the record" },
  "suzi_outbox": { kind: 'working', to: "A queue or cache the product runs from; the Wiki holds the record" },
  "suzi_presence": { kind: 'working', to: "A queue or cache the product runs from; the Wiki holds the record" },
  "triage_decision_cache": { kind: 'working', to: "A queue or cache the product runs from; the Wiki holds the record" },
  // The database's own record of applied migrations
  "_prisma_migrations": { kind: 'system', to: "The database's own record of applied migrations" },
};

/** Backup copies made by Brain Reset and by earlier clean-ups (`…_wipe_…`, `…_2026_05_25`). */
const BACKUP_COPY = /(_wipe_|_wipe$|_\d{4}_\d{2}_\d{2}$)/;

/** What a table is, by the ledger; a backup copy is a leftover by its name. */
export function ledgerEntry(table: string): LedgerEntry | null {
  if (WIKI_LEDGER[table]) return WIKI_LEDGER[table];
  if (BACKUP_COPY.test(table)) return { kind: 'leftover', to: "A backup copy from an earlier clean-up; to be removed on the owner's yes" };
  return null;
}

/** The kinds that are, today, something kept outside the Wiki that must move in. */
export const OUTSIDE_KINDS: LedgerKind[] = ['knowledge', 'trail', 'setup'];

/** Tables in the live database that the ledger does not name. Read-only. */
export async function unclassifiedTables(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  return rows.map((r) => r.tablename).filter((t) => !ledgerEntry(t));
}
