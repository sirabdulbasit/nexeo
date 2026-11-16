/**
 * The user's conversations with Nexeo, in the Wiki (owner, 16 Nov 2026: "wiki
 * should contain all information"; docs/Wiki-Knowledge.md §0.23).
 *
 *  - One `conversation` source per user per day (his day, Pakistan time): what
 *    he said to Nexeo and what Nexeo answered (`messages`), and what Nexeo sent
 *    him unprompted and really sent (`brain_user_messages`, status sent: briefs,
 *    prompts, alerts), in the order it happened. Private to him.
 *  - One `conversation` note per month, citing its days: a place in the Wiki
 *    for the trail, with counts only. No note per message (§7).
 *  - Left out on purpose: messages Brain suppressed or failed to send (they
 *    never reached him: not a conversation), and other people's WhatsApp
 *    messages (`brain_inbox_messages`; his ruling: others are not read).
 *  - What he asked or decided in these conversations is not yet read into
 *    commitment or learned notes: the sources are here so it can be.
 */
import prisma from '../../db/prisma';
import { saveSource, sourceId, sourcesHeld, textHash, type SourceInput } from './wikiSources';
import { syncNotes, type BuiltNote, type SyncResult } from './wikiSync';

export const CONVERSATION_ACTOR = 'wiki_conversations';
export const CONVERSATION_KIND = 'conversation' as const;

export interface Turn { at: Date; who: 'him' | 'nexeo'; text: string; unprompted?: string | null }

/** His day: Pakistan time. */
export const dayOf = (d: Date) => new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
const timeOf = (d: Date) => new Date(d.getTime() + 5 * 3600_000).toISOString().slice(11, 16);

/** Turns in, one source per day out. Pure. */
export function conversationDays(clientNumber: string, userId: number, turns: Turn[]): SourceInput[] {
  const byDay = new Map<string, Turn[]>();
  for (const t of turns) {
    if (!t.text?.trim() || Number.isNaN(new Date(t.at).getTime())) continue;
    const k = dayOf(new Date(t.at));
    byDay.set(k, [...(byDay.get(k) ?? []), t]);
  }
  const out: SourceInput[] = [];
  for (const [day, list] of [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const sorted = [...list].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || (a.who < b.who ? -1 : a.who > b.who ? 1 : a.text < b.text ? -1 : 1));
    const his = sorted.filter((t) => t.who === 'him').length;
    const unprompted = sorted.filter((t) => t.who === 'nexeo' && t.unprompted).length;
    out.push({
      clientNumber, userId, kind: CONVERSATION_KIND, externalId: `nexeo:${userId}:${day}`,
      threadKey: `nexeo:${userId}`, title: `Conversation with Nexeo, ${day}`,
      occurredAt: new Date(sorted[sorted.length - 1].at), asOf: new Date(sorted[sorted.length - 1].at),
      participants: ['Nexeo'],
      body: sorted.map((t) => `${timeOf(new Date(t.at))} ${t.who === 'him' ? 'He' : t.unprompted ? `Nexeo (${t.unprompted.replace(/_/g, ' ')})` : 'Nexeo'}: ${t.text.replace(/\s+\n/g, '\n').trim()}`).join('\n'),
      details: { with: 'nexeo', day, turns: sorted.length, his, nexeo: sorted.length - his, unprompted },
    });
  }
  return out;
}

/** Month notes from the day sources. Pure. */
export function buildConversationNotes(days: Array<{ id: string; day: string; his: number; nexeo: number; unprompted: number }>): BuiltNote[] {
  const byMonth = new Map<string, typeof days>();
  for (const d of days) byMonth.set(d.day.slice(0, 7), [...(byMonth.get(d.day.slice(0, 7)) ?? []), d]);
  const notes: BuiltNote[] = [];
  for (const [month, list] of [...byMonth.entries()].sort()) {
    const sorted = [...list].sort((a, b) => (a.day < b.day ? -1 : 1));
    const sum = (k: 'his' | 'nexeo' | 'unprompted') => sorted.reduce((s, d) => s + d[k], 0);
    notes.push({
      type: 'conversation', title: `Conversations with Nexeo, ${month}`,
      body: [
        `What he and Nexeo said to each other in ${month}. The words are in the sources this note cites, one per day; private to him.`,
        '', `**Days:** ${sorted.length}`, `**He wrote:** ${sum('his')} messages`, `**Nexeo wrote:** ${sum('nexeo')} (${sum('unprompted')} of them unprompted: briefs, prompts, alerts)`,
        '', '## Days', ...sorted.map((d) => `- ${d.day}: he ${d.his}, Nexeo ${d.nexeo}`),
      ].join('\n'),
      properties: { month, days: sorted.length, his: sum('his'), nexeo: sum('nexeo'), unprompted: sum('unprompted') },
      ids: [`conversation:nexeo:${month}`],
      sourceIds: sorted.map((d) => d.id),
    });
  }
  return notes;
}

/** Everything he and Nexeo really said to each other. */
export async function loadTurns(clientNumber: string, userId: number): Promise<Turn[]> {
  const talk = await prisma.$queryRawUnsafe<Array<{ role: string; content: string; created_at: Date }>>(
    `SELECT m.role, m.content, m.created_at FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.client_number = $1 AND c.user_id = $2 AND m.role IN ('user', 'assistant') AND m.content IS NOT NULL`,
    clientNumber, userId,
  );
  const sent = await prisma.$queryRawUnsafe<Array<{ kind: string; summary: string; created_at: Date }>>(
    `SELECT kind, summary, created_at FROM brain_user_messages
      WHERE client_number = $1 AND user_id = $2 AND status = 'sent' AND summary IS NOT NULL`,
    clientNumber, userId,
  );
  return [
    ...talk.map((m) => ({ at: m.created_at, who: (m.role === 'user' ? 'him' : 'nexeo') as Turn['who'], text: String(m.content) })),
    ...sent.map((m) => ({ at: m.created_at, who: 'nexeo' as const, text: String(m.summary), unprompted: m.kind || 'message' })),
  ];
}

/** Land the days the Wiki does not hold yet, or holds with other text (a day still going on). */
export async function landConversations(clientNumber: string, userId: number): Promise<{ days: number; landed: number }> {
  const days = conversationDays(clientNumber, userId, await loadTurns(clientNumber, userId));
  const ids = days.map((d) => sourceId(clientNumber, userId, CONVERSATION_KIND, d.externalId));
  const held = await sourcesHeld(clientNumber, userId, ids);
  let landed = 0;
  for (let i = 0; i < days.length; i += 1) {
    if (held.get(ids[i])?.hash === textHash(String(days[i].body ?? '').trim())) continue;
    await saveSource(days[i]);
    landed += 1;
  }
  return { days: days.length, landed };
}

/** Write the month notes from the day sources the Wiki holds. */
export async function rebuildConversationsForUser(clientNumber: string, userId: number): Promise<SyncResult> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; details: any }>>(
    `SELECT id, details FROM wiki_sources WHERE client_number = $1 AND user_id = $2 AND kind = $3 AND external_id LIKE 'nexeo:%'`,
    clientNumber, userId, CONVERSATION_KIND,
  );
  const days = rows.filter((r) => r.details?.day).map((r) => ({ id: r.id, day: String(r.details.day), his: Number(r.details.his ?? 0), nexeo: Number(r.details.nexeo ?? 0), unprompted: Number(r.details.unprompted ?? 0) }));
  return syncNotes({ clientNumber, userId }, CONVERSATION_ACTOR, buildConversationNotes(days));
}
