/**
 * Documents and attachments in the Wiki (docs/Wiki-Knowledge.md §0.13 part 11).
 *
 *  - Every attachment whose text was read is an `attachment` source: its own id
 *    is the email's id and the file name, so the same file read twice is one
 *    source, and a new version sent later is a second source of the same note.
 *  - One `document` note per document (by file name): what it is, who sent it
 *    and when, every version, the projects whose conversations it came in, and
 *    its opening lines. It cites its attachments and the emails they came with.
 *  - Calendar invitations, reactions and attachments with almost no text are
 *    not documents.
 *  - Private: an attachment of his mail makes his notes only.
 */
import prisma from '../../db/prisma';
import { listSources, saveSource, sourceId, sourcesHeld, textHash, type Source } from './wikiSources';
import { cleanTitle, titleKey, wikiLink } from './wikiLinks';
import { WIKI_GENERATION } from './wikiStore';
import { syncNotes, withSisterAddresses, type BuiltNote, type SyncResult } from './wikiSync';

export const DOCUMENT_ACTOR = 'wiki_documents';
export const ATTACHMENT_KIND = 'attachment' as const;
const NOT_DOCUMENTS = /^(text\/calendar|application\/ics|text\/vnd\.google\.email-reaction|image\/)/i;
const MIN_TEXT = 80;
const OPENING_CHARS = 700;

export interface AttachmentIn {
  clientNumber: string; userId: number; gmailMessageId: string; feedEventId?: string | null; threadId?: string | null;
  filename: string; mimeType: string; size?: number | null; pageCount?: number | null; truncated?: boolean;
  senderEmail?: string | null; subject?: string | null; receivedAt: Date; text: string; asOf?: Date;
}

/** Is this attachment a document worth a note? */
export function isDocument(a: { filename: string; mimeType: string; text: string }): boolean {
  if (NOT_DOCUMENTS.test(a.mimeType ?? '')) return false;
  if (/\.(ics|vcs|png|jpe?g|gif|bmp|webp)$/i.test(a.filename)) return false;
  return (a.text ?? '').trim().length >= MIN_TEXT;
}

export function attachmentSource(a: AttachmentIn) {
  return {
    clientNumber: a.clientNumber, userId: a.userId, kind: ATTACHMENT_KIND,
    externalId: `${a.gmailMessageId}:${a.filename}`,
    feedEventId: a.feedEventId ?? null, threadKey: a.threadId ?? null,
    title: a.filename, occurredAt: a.receivedAt,
    participants: a.senderEmail ? [a.senderEmail] : [],
    body: a.text, asOf: a.asOf ?? new Date(),
    details: {
      filename: a.filename, mimeType: a.mimeType, size: a.size ?? null, pageCount: a.pageCount ?? null,
      truncated: !!a.truncated, from: a.senderEmail ?? null, subject: a.subject ?? null, gmailMessageId: a.gmailMessageId,
    },
  };
}

/** Land one attachment (called where its text is read). Not a document: nothing is landed. */
export async function landAttachment(a: AttachmentIn): Promise<string | null> {
  if (!isDocument(a)) return null;
  return (await saveSource(attachmentSource(a))).id;
}

/** The text an old attachment page holds, under "## Extracted content". */
export function attachmentPageText(body: string | null): string {
  if (!body) return '';
  const i = body.indexOf('\n## Extracted content\n');
  return i >= 0 ? body.slice(i + '\n## Extracted content\n'.length).trim() : '';
}

/**
 * Land every attachment the attachment reader has read for this user that the Wiki does not hold yet
 * (its pages are the reader's output; the reconcile makes sure each became a source).
 */
export async function landAttachmentsFromPages(clientNumber: string, userId: number): Promise<{ pages: number; landed: number }> {
  const rows = await prisma.$queryRawUnsafe<Array<{ body_markdown: string | null; metadata: any; last_updated_at: Date; thread_key: string | null; message_id: string | null; occurred_at: Date | null }>>(
    `SELECT p.body_markdown, p.metadata, p.last_updated_at, e.thread_key, e.external_id AS message_id, e.occurred_at
       FROM wiki_pages p
       LEFT JOIN wiki_sources e ON e.client_number = p.client_number AND e.user_id = p.user_id AND e.kind = 'email'
        AND (e.external_id = p.metadata->>'gmailMessageId' OR e.feed_event_id = p.metadata->>'feedEventId')
      WHERE p.client_number = $1 AND p.user_id = $2 AND p.page_type = 'attachment_doc'`,
    clientNumber, userId,
  );
  const wanted = new Map<string, AttachmentIn>();
  for (const r of rows) {
    const m = r.metadata ?? {};
    const messageId = m.gmailMessageId ?? r.message_id ?? m.feedEventId;
    if (!messageId || !m.filename) continue;
    const a: AttachmentIn = {
      clientNumber, userId, gmailMessageId: String(messageId), feedEventId: m.feedEventId ?? null, threadId: r.thread_key,
      filename: String(m.filename), mimeType: String(m.mimeType ?? ''), size: m.size ?? null, pageCount: m.pageCount ?? null,
      truncated: !!m.truncated, senderEmail: m.senderEmail ?? null, subject: subjectOf(r.body_markdown),
      receivedAt: r.occurred_at ?? receivedOf(r.body_markdown) ?? r.last_updated_at, text: attachmentPageText(r.body_markdown), asOf: r.last_updated_at,
    };
    if (!isDocument(a)) continue;
    wanted.set(sourceId(clientNumber, userId, ATTACHMENT_KIND, `${a.gmailMessageId}:${a.filename}`), a);
  }
  const held = await sourcesHeld(clientNumber, userId, [...wanted.keys()]);
  let landed = 0;
  for (const [id, a] of wanted) {
    if (held.get(id)?.hash === textHash(a.text.trim())) continue;
    await saveSource(attachmentSource(a));
    landed += 1;
  }
  return { pages: rows.length, landed };
}

function subjectOf(body: string | null): string | null {
  const m = body?.match(/\*\*Email subject:\*\* (.+)/);
  return m ? m[1].trim() : null;
}
function receivedOf(body: string | null): Date | null {
  const m = body?.match(/\*\*Received:\*\* (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
  const d = m ? new Date(`${m[1].replace(' ', 'T')}:00Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

const KIND_NAMES: Array<[RegExp, string]> = [
  [/pdf/i, 'PDF'], [/wordprocessingml|msword/i, 'Word document'], [/spreadsheetml|ms-excel|csv/i, 'Spreadsheet'],
  [/presentationml|powerpoint/i, 'Presentation'], [/markdown/i, 'Markdown text'], [/html/i, 'Web page'], [/text\/plain/i, 'Text'],
];
export function kindName(mime: string): string {
  return KIND_NAMES.find(([re]) => re.test(mime))?.[1] ?? 'File';
}

const emailIn = (v: unknown) => {
  const m = typeof v === 'string' ? v.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/) : null;
  return m ? m[0] : null;
};
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
/** Text from a document is shown, never read as links. */
const plain = (t: string) => t.replace(/\[\[|\]\]/g, '').replace(/\r/g, '');

/** Attachments in, document notes out. Pure. */
export function buildDocumentNotes(
  attachments: Source[],
  ctx: { personByEmail: Map<string, string>; emailIdByMessage: Map<string, string>; projectsByThread: Map<string, string[]>; ownEmails: Set<string> },
): BuiltNote[] {
  // A file name is a label, not an identity (review 16 Nov, P1). Two attachments are versions of one
  // document only when they share the name AND come from the same sender or the same conversation;
  // two unrelated "Invoice.pdf" files are two documents.
  const byName = new Map<string, Source[]>();
  for (const s of attachments) {
    const d = s.details as any;
    if (!isDocument({ filename: String(d?.filename ?? s.title ?? ''), mimeType: String(d?.mimeType ?? ''), text: s.body || 'x'.repeat(MIN_TEXT) })) continue;
    const k = titleKey(String(d?.filename ?? s.title ?? ''));
    if (!k) continue;
    byName.set(k, [...(byName.get(k) ?? []), s]);
  }
  const groups: Array<{ k: string; anchor: string; list: Source[] }> = [];
  for (const [k, all] of byName) {
    const sorted = [...all].sort((a, b) => (a.occurredAt?.getTime() ?? 0) - (b.occurredAt?.getTime() ?? 0) || (a.id < b.id ? -1 : 1));
    const parent = new Map<string, string>(sorted.map((s) => [s.id, s.id]));
    const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
    const firstBy = new Map<string, string>();
    for (const s of sorted) {
      for (const key of [`from:${emailIn((s.details as any)?.from) ?? ''}`, `thread:${s.threadKey ?? ''}`]) {
        if (/:$/.test(key)) continue;
        const prior = firstBy.get(key);
        if (prior) parent.set(find(s.id), find(prior)); else firstBy.set(key, s.id);
      }
    }
    const sets = new Map<string, Source[]>();
    for (const s of sorted) sets.set(find(s.id), [...(sets.get(find(s.id)) ?? []), s]);
    for (const list of sets.values()) {
      const first = list[0];
      groups.push({ k, anchor: emailIn((first.details as any)?.from) ?? first.threadKey ?? first.id, list });
    }
  }
  const titleCount = new Map<string, number>();
  for (const g of groups) titleCount.set(g.k, (titleCount.get(g.k) ?? 0) + 1);
  const notes: BuiltNote[] = [];
  for (const { k, anchor, list } of groups) {
    const versions = [...list].sort((a, b) => (b.occurredAt?.getTime() ?? 0) - (a.occurredAt?.getTime() ?? 0) || (a.id < b.id ? -1 : 1));
    const latest = versions[0];
    const d = latest.details as any;
    const who = (v: unknown) => {
      const e = emailIn(v);
      if (!e) return 'unknown sender';
      if (ctx.ownEmails.has(e)) return 'you';
      return ctx.personByEmail.has(e) ? wikiLink(ctx.personByEmail.get(e)!) : e;
    };
    const projects = [...new Set(versions.flatMap((v) => (v.threadKey ? ctx.projectsByThread.get(v.threadKey) ?? [] : [])))].sort();
    const opening = plain(latest.body ?? '').replace(/\n{3,}/g, '\n\n').trim().slice(0, OPENING_CHARS);
    const lines = [
      `**Kind:** ${kindName(String(d?.mimeType ?? ''))}${d?.pageCount ? `, ${d.pageCount} pages` : ''}${d?.truncated ? ' (text cut at the reader\'s limit)' : ''}`,
      `**Latest from:** ${who(d?.from)} on ${day(latest.occurredAt)}`,
      ...(d?.subject ? [`**Came with:** ${plain(String(d.subject))}`] : []),
      ...(projects.length ? ['', '## Projects', ...projects.map((p) => `- ${wikiLink(p)}`)] : []),
      '', '## Versions',
      ...versions.slice(0, 10).map((v) => `- ${day(v.occurredAt)} from ${who((v.details as any)?.from)}${(v.details as any)?.subject ? `, "${plain(String((v.details as any).subject)).slice(0, 120)}"` : ''}`),
      ...(versions.length > 10 ? [`- …and ${versions.length - 10} more`] : []),
      ...(opening ? ['', '## Opening', opening + (latest.body.length > OPENING_CHARS ? ' …' : '')] : []),
    ];
    const emailIds = versions.map((v) => ctx.emailIdByMessage.get(String((v.details as any)?.gmailMessageId ?? ''))).filter((x): x is string => !!x);
    // One title per document: a name two documents share is told apart by who first sent it.
    const name = String(d?.filename ?? latest.title);
    const firstFrom = emailIn((list[0].details as any)?.from);
    const sender = firstFrom ? (ctx.ownEmails.has(firstFrom) ? 'you' : ctx.personByEmail.get(firstFrom) ?? firstFrom) : null;
    const title = (titleCount.get(k) ?? 0) > 1 ? cleanTitle(`${name} (from ${sender ?? day(list[0].occurredAt)})`) : cleanTitle(name);
    notes.push({
      type: 'document',
      title,
      body: lines.join('\n'),
      properties: {
        filename: d?.filename ?? latest.title, kind: kindName(String(d?.mimeType ?? '')), versions: versions.length,
        lastReceived: day(latest.occurredAt), from: emailIn(d?.from), pages: d?.pageCount ?? null, projects: projects.length,
      },
      ids: [`document:${k.slice(0, 140)}:${anchor}`],
      sourceIds: [...new Set([...versions.map((v) => v.id), ...emailIds])],
    });
  }
  return notes.sort((a, b) => a.title.localeCompare(b.title));
}

/** Write this user's document notes from the attachments the Wiki holds. */
export async function rebuildDocumentsForUser(clientNumber: string, userId: number): Promise<SyncResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const attachments = await listSources(clientNumber, userId, [ATTACHMENT_KIND]);
  const emails = await prisma.$queryRawUnsafe<Array<{ id: string; external_id: string; from_addr: string | null; labels: any }>>(
    `SELECT id, external_id, details->>'from' AS from_addr, details->'labels' AS labels FROM wiki_sources WHERE client_number = $1 AND user_id = $2 AND kind = 'email'`,
    clientNumber, userId,
  );
  const ownEmails = new Set<string>([String(user?.email ?? '').toLowerCase()].filter(Boolean));
  for (const e of emails) if (Array.isArray(e.labels) && e.labels.includes('SENT')) { const x = emailIn(e.from_addr); if (x) ownEmails.add(x); }
  const own = withSisterAddresses(ownEmails, [...emails.map((e) => emailIn(e.from_addr)), ...attachments.map((a) => emailIn((a.details as any)?.from))].filter((x): x is string => !!x));
  const people = await prisma.wikiPage.findMany({
    where: { clientNumber, userId, pageType: 'person', status: 'active', metadata: { path: ['wiki'], equals: WIKI_GENERATION } },
    select: { title: true, metadata: true },
  });
  const personByEmail = new Map<string, string>();
  for (const p of people as any[]) for (const id of p.metadata?.ids ?? []) if (String(id).startsWith('email:')) personByEmail.set(String(id).slice(6), p.title);
  // The projects whose conversations a thread belongs to: project notes citing an email of that thread.
  const proj = await prisma.$queryRawUnsafe<Array<{ title: string; thread_key: string }>>(
    `SELECT DISTINCT p.title, s.thread_key FROM wiki_pages p
       JOIN wiki_note_sources c ON c.note_id = p.id JOIN wiki_sources s ON s.id = c.source_id
      WHERE p.client_number = $1 AND p.user_id = $2 AND p.page_type = 'project' AND p.status = 'active'
        AND s.kind = 'email' AND s.thread_key IS NOT NULL`,
    clientNumber, userId,
  );
  const projectsByThread = new Map<string, string[]>();
  for (const r of proj) projectsByThread.set(r.thread_key, [...(projectsByThread.get(r.thread_key) ?? []), r.title]);
  const emailIdByMessage = new Map(emails.map((e) => [e.external_id, e.id]));
  const notes = buildDocumentNotes(attachments, { personByEmail, emailIdByMessage, projectsByThread, ownEmails: own });
  return syncNotes({ clientNumber, userId }, DOCUMENT_ACTOR, notes);
}
