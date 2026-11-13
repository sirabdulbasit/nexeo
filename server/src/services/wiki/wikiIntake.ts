/**
 * Wiki intake — every item a feed fetches lands in the Wiki as a source
 * (docs/Wiki-Knowledge.md §0.1.2: "Placed in the Wiki").
 *
 * `sourceFromFeedItem` is the one place that says how a fetched item (an
 * email, a calendar entry, a chat or WhatsApp message, a task) becomes a
 * source: its own id, its conversation, its title, its time, who was in it,
 * and its text. `landFeedItem` stores it. The feed calls it once per item;
 * calling it again for the same item changes nothing.
 */
import { saveSource, type SourceInput, type SourceKind } from './wikiSources';

export interface FeedItem {
  id: string;
  clientNumber: string;
  userId: number;
  sourceType: string;
  sourceId: string;
  payload: Record<string, any>;
  at: Date;
}

const KIND: Record<string, SourceKind> = {
  gmail: 'email', gcal: 'calendar', gchat: 'chat', whatsapp: 'whatsapp', gtasks: 'task',
};

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return v.split(',').map((x) => x.trim()).filter(Boolean);
  return [];
}

/** How a fetched item becomes a source. Pure. Null when the feed type is not one the Wiki knows. */
export function sourceFromFeedItem(item: FeedItem): SourceInput | null {
  const kind = KIND[item.sourceType];
  if (!kind) return null;
  const p = item.payload ?? {};
  const base = { clientNumber: item.clientNumber, userId: item.userId, kind, feedEventId: item.id, occurredAt: item.at };
  // The fetched fields are kept as they are, minus the text (held once, as the body).
  const { body: _b, text: _t, formattedText: _f, description: _d, threadContext: _c, ...details } = p;
  if (kind === 'email') {
    return {
      ...base,
      externalId: String(p.messageId ?? p.gmailMessageId ?? item.sourceId),
      threadKey: p.threadId ? String(p.threadId) : null,
      title: p.subject ?? null,
      participants: [...list(p.from), ...list(p.to), ...list(p.cc)],
      body: p.snippet ?? null,
      preview: true,
      details,
    };
  }
  if (kind === 'calendar') {
    return {
      ...base,
      externalId: `${p.eventId ?? item.sourceId}@${p.start ?? ''}`,
      threadKey: p.eventId ? String(p.eventId) : null,
      title: p.title ?? null,
      occurredAt: p.start && !Number.isNaN(new Date(p.start).getTime()) ? new Date(p.start) : item.at,
      participants: [...new Set([...list(p.attendees), ...list(p.organizer)])],
      body: p.description ?? null,
      details,
    };
  }
  if (kind === 'chat') {
    return {
      ...base,
      externalId: String(p.messageName ?? item.sourceId),
      threadKey: p.threadName ?? p.spaceName ?? null,
      title: p.spaceDisplayName ?? p.subject ?? null,
      participants: list(p.senderDisplayName),
      body: p.text ?? p.formattedText ?? p.snippet ?? null,
      details,
    };
  }
  if (kind === 'whatsapp') {
    return {
      ...base,
      externalId: String(p.waMessageId ?? item.sourceId),
      threadKey: p.chatId ?? null,
      title: p.senderName ?? null,
      participants: list(p.senderName ?? p.phoneNumber),
      body: p.voiceTranscript ?? p.body ?? null,
      details,
    };
  }
  return {
    ...base,
    externalId: String(p.taskId ?? p.id ?? item.sourceId),
    threadKey: p.listId ?? null,
    title: p.title ?? null,
    participants: [],
    body: p.notes ?? null,
    details,
  };
}

/** Land one fetched item in the Wiki. Returns the source's id, or null when it is not a feed the Wiki knows. */
export async function landFeedItem(item: FeedItem): Promise<string | null> {
  const src = sourceFromFeedItem(item);
  if (!src) return null;
  return (await saveSource(src)).id;
}

/** The full text of an email, fetched after the item itself: it replaces the preview. */
export async function landEmailText(p: {
  clientNumber: string; userId: number; gmailMessageId: string; feedEventId?: string | null;
  threadId?: string | null; subject?: string | null; from?: string | null; to?: string | null; cc?: string | null;
  receivedAt: Date; bodyText: string;
  /** The mailbox's own labels, when known ('SENT', 'INBOX'): an email landed with no feed item keeps them here. */
  labels?: string[];
}): Promise<string> {
  return (await saveSource({
    clientNumber: p.clientNumber, userId: p.userId, kind: 'email', externalId: p.gmailMessageId,
    feedEventId: p.feedEventId ?? null, threadKey: p.threadId ?? null, title: p.subject ?? null,
    occurredAt: p.receivedAt, participants: [...list(p.from), ...list(p.to), ...list(p.cc)],
    body: p.bodyText,
    // The same fields a fetched email carries, so an email whose feed item is gone still reads the same.
    details: {
      ...(p.from ? { from: p.from } : {}), ...(p.to ? { to: p.to } : {}), ...(p.cc ? { cc: p.cc } : {}),
      ...(p.subject ? { subject: p.subject } : {}), ...(p.threadId ? { threadId: p.threadId } : {}),
      ...(p.labels?.length ? { labels: p.labels } : {}),
    },
  })).id;
}
