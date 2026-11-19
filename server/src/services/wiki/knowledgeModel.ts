/**
 * Which knowledge model a user has (founder, 19 Nov 2026; Functional Charter
 * "Obsidian vault: Client Owned Data"; docs/Wiki-Knowledge.md §0.6).
 *
 *  - 'nexeo'    Nexeo Owned Data: the Nexeo wiki. Every user until 19 Nov.
 *  - 'external' Client Owned Data: his knowledge is in his own Obsidian vault.
 *    Nexeo fetches nothing for him, stores nothing in its wiki, reads nothing
 *    from the vault. Only Suzi reads the vault, on his Mac. What stays in
 *    Nexeo: his voiceprint and faceprint, and what Nexeo and Suzi learned
 *    about how he works.
 *
 * The model is chosen when the user is created (`authService.createUser`) and
 * there is no setter afterwards. Every job and route asks THIS guard, so there
 * is one answer.
 *
 * The guard fails closed: a user whose model cannot be read (no row, another
 * client, a database error) is treated as external. Storing nothing by mistake
 * is recoverable; storing a Client Owned Data user's mail is not.
 */
import prisma from '../../db/prisma';

export type KnowledgeModel = 'nexeo' | 'external';
export const KNOWLEDGE_MODELS: readonly KnowledgeModel[] = ['nexeo', 'external'];

/** The word routes and the day pack answer with. */
export const EXTERNAL_KNOWLEDGE = 'external_knowledge';
export const EXTERNAL_KNOWLEDGE_MESSAGE = 'Your knowledge is in your Obsidian vault';

/** The whole answer of a knowledge route for a Client Owned Data user (HTTP 200, no other fields). */
export function externalKnowledgeBody(): { external_knowledge: true; knowledge_model: 'external'; message: string } {
  return { external_knowledge: true, knowledge_model: 'external', message: EXTERNAL_KNOWLEDGE_MESSAGE };
}

export function isKnowledgeModel(v: unknown): v is KnowledgeModel {
  return v === 'nexeo' || v === 'external';
}

/** A user's model, or null when it cannot be read. */
export async function knowledgeModelOf(clientNumber: string, userId: number): Promise<KnowledgeModel | null> {
  if (!clientNumber || !Number.isInteger(userId) || userId <= 0) return null;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ knowledge_model: string }>>(
      `SELECT knowledge_model FROM users WHERE id = $1 AND client_number = $2`, userId, clientNumber,
    );
    const m = rows?.[0]?.knowledge_model;
    return isKnowledgeModel(m) ? m : null;
  } catch {
    return null;
  }
}

/** True when nothing may be fetched or stored for this user. Fails closed. */
export async function isExternalKnowledge(clientNumber: string, userId: number): Promise<boolean> {
  return (await knowledgeModelOf(clientNumber, userId)) !== 'nexeo';
}

/**
 * For the Wiki's own hourly work: true = skip him, false = build. A model that cannot be read is an error
 * here, reported in the run's result, so a database hiccup is never recorded as "he is Client Owned Data".
 */
export async function skipsWikiWork(clientNumber: string, userId: number): Promise<boolean> {
  const model = await knowledgeModelOf(clientNumber, userId);
  if (model === null) throw new Error(`knowledge model of user ${userId} could not be read; nothing was done`);
  return model === 'external';
}

/**
 * The Client Owned Data users, for a job that loops over users: one query a
 * cycle. It throws when the list cannot be read, so the job skips the cycle
 * instead of treating everyone as Nexeo Owned Data.
 */
export async function externalUserIds(clientNumber?: string): Promise<Set<number>> {
  const rows = clientNumber
    ? await prisma.$queryRawUnsafe<Array<{ id: number }>>(`SELECT id FROM users WHERE knowledge_model <> 'nexeo' AND client_number = $1`, clientNumber)
    : await prisma.$queryRawUnsafe<Array<{ id: number }>>(`SELECT id FROM users WHERE knowledge_model <> 'nexeo'`);
  return new Set(rows.map((r) => Number(r.id)));
}

/** Refused at the Wiki's own doors: a write for a Client Owned Data user that is not his identity or learning. */
export class ExternalKnowledgeRefused extends Error {
  readonly code = EXTERNAL_KNOWLEDGE;
  constructor(what: string) {
    super(`${what}: this user's knowledge is in his own vault; nothing is stored in the Nexeo wiki`);
    this.name = 'ExternalKnowledgeRefused';
  }
}

/**
 * What stays in Nexeo for a Client Owned Data user, as sources: his voiceprint
 * and faceprint (identity), what Suzi learned about how he works (profile),
 * and the learned rows of Nexeo's own stores. Everything else is refused.
 */
export function sourceStaysInNexeo(input: { kind: string; externalId?: string | null; details?: Record<string, unknown> | null }): boolean {
  if (input.kind !== 'record') return false;
  const d = input.details ?? {};
  if (d.type === 'identity' || d.type === 'profile') return true;
  return typeof d.store === 'string' && LEARNED_STORES.has(d.store);
}

/** The stores `wikiLearned` reads: what was learned from him. */
export const LEARNED_STORES: ReadonlySet<string> = new Set(['governed_brain_memories', 'user_memories', 'user_learning', 'pattern_insights', 'thought_entries']);

/** The same, as notes: his "How to work with <him>" note and the learned notes. */
export function noteStaysInNexeo(input: { type: string; ids?: unknown; userId: number }): boolean {
  if (input.type === 'learned') return true;
  const ids = Array.isArray(input.ids) ? input.ids.map(String) : [];
  return input.type === 'person' && ids.length === 1 && ids[0] === `profile:user:${input.userId}`;
}

/** The door check for a source. Throws when it may not be stored. */
export async function assertSourceMayBeStored(input: { clientNumber: string; userId: number; kind: string; externalId?: string | null; details?: Record<string, unknown> | null }): Promise<void> {
  if (sourceStaysInNexeo(input)) return;
  if (await isExternalKnowledge(input.clientNumber, input.userId)) throw new ExternalKnowledgeRefused(`source ${input.kind}`);
}

/** The door check for a note. Throws when it may not be stored. */
export async function assertNoteMayBeStored(input: { clientNumber: string; userId: number; type: string; ids?: unknown }): Promise<void> {
  if (noteStaysInNexeo(input)) return;
  if (await isExternalKnowledge(input.clientNumber, input.userId)) throw new ExternalKnowledgeRefused(`note ${input.type}`);
}
