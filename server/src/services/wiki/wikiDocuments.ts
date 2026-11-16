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
import { listSources, removeSource, saveSource, sourceId, sourcesHeld, textHash, type Source } from './wikiSources';
import { cleanTitle, titleKey, wikiLink } from './wikiLinks';
import { WIKI_GENERATION } from './wikiStore';
import { syncNotes, withSisterAddresses, type BuiltNote, type SyncResult } from './wikiSync';
import { isSame, pairOf, loadVerdicts, judgeFrom, judgePairs, retireUnseen, type SameJudge } from './wikiSame';

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
    externalId: attachmentExternalId(a),
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

/**
 * An attachment's own identity: its email, its file name and its content. Two attachments of one name in
 * one email are two sources; the same file read twice is one.
 */
export function attachmentExternalId(a: { gmailMessageId: string; filename: string; text: string }): string {
  return `${a.gmailMessageId}:${a.filename}:${textHash((a.text ?? '').trim()).slice(0, 12)}`;
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
export async function landAttachmentsFromPages(clientNumber: string, userId: number): Promise<{ pages: number; landed: number; removed: number }> {
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
    wanted.set(sourceId(clientNumber, userId, ATTACHMENT_KIND, attachmentExternalId(a)), a);
  }
  const held = await sourcesHeld(clientNumber, userId, [...wanted.keys()]);
  let landed = 0;
  for (const [id, a] of wanted) {
    if (held.get(id)?.hash === textHash(a.text.trim())) continue;
    await saveSource(attachmentSource(a));
    landed += 1;
  }
  // Attachment sources the reader's pages no longer give (an earlier identity form, `<email>:<file>`) are
  // removed with their citations; every attachment the pages hold is landed above under its own identity.
  let removed = 0;
  for (const s of await listSources(clientNumber, userId, [ATTACHMENT_KIND])) {
    if (wanted.has(s.id) || s.externalId.split(':').length >= 3) continue;
    if ((await removeSource({ clientNumber, userId }, s.id)).removed) removed += 1;
  }
  return { pages: rows.length, landed, removed };
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

/**
 * The reference numbers a document carries near its top (invoice, purchase order, contract, quotation,
 * reference), as written: what tells one invoice from another of the same name.
 */
export function references(text: string): string[] {
  const head = String(text ?? '').slice(0, 3000);
  const out = new Set<string>();
  const labelled = /\b(?:invoice|inv|bill|po|purchase\s+order|order|contract|agreement|quotation|quote|ref(?:erence)?)\s*(?:no\.?|number|num|#|id)?\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-\/]*\d[A-Z0-9\-\/]*)/gi;
  for (const m of head.matchAll(labelled)) out.add(m[1].toLowerCase());
  for (const m of head.matchAll(/\b[A-Z]{2,6}-\d{2,}(?:-\d+)?\b/g)) out.add(m[0].toLowerCase());
  return [...out].sort();
}

/** How much two texts share: words in common over words in either (a candidate finder, never a decision). */
export function alike(a: string, b: string): number {
  const words = (t: string) => new Set(String(t ?? '').slice(0, 3000).toLowerCase().split(/[^a-z0-9\u0600-\u06ff]+/).filter((w) => w.length > 2));
  const A = words(a); const B = words(b);
  if (A.size === 0 || B.size === 0) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n += 1;
  return n / (A.size + B.size - n);
}

/** Earlier attachments one attachment is put to the model with, at most. */
const CANDIDATES_PER_ATTACHMENT = 4;
/** Pairs of attachments the model is asked about per user per run, at most. */
const SAME_DOC_PER_RUN = 80;
/** How much of each document's opening, and of the lines only one of the two has, the model is shown. */
const OPENING_SHOWN = 1500;
const DIFF_LIMIT = 8000;
/** A document's text as lines, spaces evened out, empty lines dropped. */
export function textLines(t: string | null | undefined): string[] {
  return plain(String(t ?? '')).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
export const SAME_DOC_PROMPT = 'same-doc-v6';
/** Documents are long and their differences subtle: the second reading is by the stronger model (measured, wikiSameEval). */
export const SAME_DOC_SECOND = 'gemini';
/** The second reading for documents: a revision differs by nature, so it asks which kind of difference this is. */
export const SAME_DOC_CHALLENGE = `A first reader called B the same document as A (a re-send or a revision). Check that claim against the lines each has that the other does not.
A revision changes the SAME document: a corrected figure or wording, an added or removed section, a new draft number, a note that it replaces the earlier copy, while the issuer, the parties, the subject and its own number stay.
It is ANOTHER document when the lines differ in who issued it, who it is for or about (another party, customer, employee), which period, purchase, order or place it covers, or its own number.
If the differing lines show another document, or you cannot tell which it is, answer same=false. Answer same=true, sure=true only for a re-send or a revision.`;
export const SAME_DOC_SYSTEM = `You are given two email attachments (A, then the later B) that have the same file name.
For each you see its facts, its opening, and under "lines_only_in_this_one" every line it has that the other does not: together that is everything in which the two differ.
Decide whether B is the SAME document as A: a re-send of it, or a revised version of that one document.
Different documents: another invoice, order or receipt (another number, amount, period or purchase), another month's or person's report, an agreement with another party, a document issued by another organisation even if it carries the same number.
Answer with JSON only: {"same": true|false, "sure": true|false, "why": ""}
sure = false whenever the two openings do not show it clearly. Never guess.`;

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
  ctx: { personByEmail: Map<string, string>; emailIdByMessage: Map<string, string>; projectsByThread: Map<string, string[]>; ownEmails: Set<string>; same?: SameJudge },
): BuiltNote[] {
  // A file name is a label, not an identity (review 16 Nov, P1). Two attachments are versions of one
  // document only when they share the name AND come from the same sender or the same conversation;
  // two unrelated "Invoice.pdf" files are two documents.
  // All his addresses are one sender: what he sent from either is his.
  const senderKey = (v: unknown) => { const e = emailIn(v); return !e ? '' : ctx.ownEmails.has(e) ? 'you' : e; };
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
    // One document, or two? (tag identity-from-words.) Identical content is the same file. For anything
    // else the same name, sender, conversation, reference number or similar text only make two
    // attachments CANDIDATES (two vendors both number an invoice INV-001; one vendor sends a new invoice
    // every month on one template): the model, shown both, decides, and with no answer they stay two.
    for (let x = 0; x < sorted.length; x += 1) {
      const a = sorted[x];
      let asked = 0;
      for (let y = x - 1; y >= 0 && asked < CANDIDATES_PER_ATTACHMENT; y -= 1) {
        const b = sorted[y];
        if (find(a.id) === find(b.id)) continue;
        const sameThread = !!a.threadKey && a.threadKey === b.threadKey;
        const sameSender = !!senderKey((a.details as any)?.from) && senderKey((a.details as any)?.from) === senderKey((b.details as any)?.from);
        // The same file again: the same text and size, from the same sender or in the same conversation.
        // The same text from another sender elsewhere proves nothing (a scan may read as the same few words).
        const sa = Number((a.details as any)?.size ?? 0); const sb = Number((b.details as any)?.size ?? 0);
        if (textHash((a.body ?? '').trim()) === textHash((b.body ?? '').trim()) && (sameThread || sameSender) && (!sa || !sb || sa === sb)) {
          parent.set(find(a.id), find(b.id));
          continue;
        }
        const ra = references(a.body); const rb = references(b.body);
        const candidate = sameThread || (sameSender && (ra.some((r) => rb.includes(r)) || alike(a.body, b.body) >= 0.5));
        if (!candidate) continue;
        asked += 1;
        // What the model reads of each: its facts, its opening, and EVERY line that is in it and not in the
        // other. If that difference cannot be shown whole, or the reader cut either text, the pair is not
        // judged on a part of it: it stays two documents.
        const la = textLines(a.body); const lb = textLines(b.body);
        const inA = new Set(la); const inB = new Set(lb);
        const onlyA = la.filter((l) => !inB.has(l)).join('\n'); const onlyB = lb.filter((l) => !inA.has(l)).join('\n');
        const complete = !(a.details as any)?.truncated && !(b.details as any)?.truncated && onlyA.length <= DIFF_LIMIT && onlyB.length <= DIFF_LIMIT;
        const shown = (v: Source, refs: string[], only: string) => ({
          file: (v.details as any)?.filename ?? v.title, from: (v.details as any)?.from ?? null, date: day(v.occurredAt),
          came_with: (v.details as any)?.subject ?? null, conversation: v.threadKey ?? null, reference_numbers: refs.join(', ') || null,
          opening: plain(v.body ?? '').slice(0, OPENING_SHOWN),
          lines_only_in_this_one: only.slice(0, DIFF_LIMIT) || '(none: every line of this one is also in the other)',
        });
        // b is the earlier one: shown first, as A.
        if (isSame(ctx.same, pairOf('samedoc:', b.externalId, shown(b, rb, onlyB), a.externalId, shown(a, ra, onlyA), SAME_DOC_PROMPT, a.id, complete))) parent.set(find(a.id), find(b.id));
      }
    }
    const sets = new Map<string, Source[]>();
    for (const s of sorted) sets.set(find(s.id), [...(sets.get(find(s.id)) ?? []), s]);
    for (const list of sets.values()) {
      const first = list[0];
      // Its identity: the name and its first attachment (stable: a later version joins, never renames it).
      groups.push({ k, anchor: first.externalId, list });
    }
  }
  const titleCount = new Map<string, number>();
  for (const g of groups) titleCount.set(g.k, (titleCount.get(g.k) ?? 0) + 1);
  const notes: BuiltNote[] = [];
  const usedTitles = new Set<string>();
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
    let title = (titleCount.get(k) ?? 0) > 1 ? cleanTitle(`${name} (from ${sender ?? day(list[0].occurredAt)})`) : cleanTitle(name);
    // Two documents of one name from one sender in two conversations: told apart by when it first came.
    if (usedTitles.has(titleKey(title))) title = cleanTitle(`${title.replace(/\)$/, '')}, ${day(list[0].occurredAt)})`);
    if (!title.endsWith(')') && usedTitles.has(titleKey(title))) title = cleanTitle(`${name} (${day(list[0].occurredAt)})`);
    const refs = references(list[0].body);
    if (usedTitles.has(titleKey(title)) && refs.length) title = cleanTitle(`${title.replace(/\)$/, '')}, ${refs[0].toUpperCase()})`);
    for (let n = 2; usedTitles.has(titleKey(title)); n += 1) title = cleanTitle(`${title.replace(/ #\d+$/, '')} #${n}`);
    usedTitles.add(titleKey(title));
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
export async function rebuildDocumentsForUser(
  clientNumber: string, userId: number, opts: { judge?: (sys: string, msg: string) => Promise<string>; judgeLimit?: number } = {},
): Promise<SyncResult & { judged: { asked: number; same: number; failed: number; left: number } }> {
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
  // Which attachments are one document is judged first (wikiSame): the build lists its candidate pairs, the
  // model answers each once, and the build runs again with the answers. Unanswered pairs stay two documents.
  const verdicts = await loadVerdicts(clientNumber, userId, 'samedoc:');
  const build = () => { const same: SameJudge = judgeFrom('samedoc:', verdicts); return { same, notes: buildDocumentNotes(attachments, { personByEmail, emailIdByMessage, projectsByThread, ownEmails: own, same }) }; };
  let b = build();
  let left = opts.judgeLimit ?? SAME_DOC_PER_RUN;
  const judged = { asked: 0, same: 0, failed: 0, left: 0 };
  for (let pass = 0; pass < 3 && b.same.pending.length > 0 && left > 0; pass += 1) {
    const r = await judgePairs(clientNumber, userId, b.same.pending, verdicts, { system: SAME_DOC_SYSTEM, promptVersion: SAME_DOC_PROMPT, purpose: 'wiki_same_doc', limit: left, call: opts.judge, challenge: SAME_DOC_CHALLENGE, secondProvider: SAME_DOC_SECOND, secondReadings: 2 });
    judged.asked += r.asked; judged.same += r.same; judged.failed += r.failed;
    left -= r.asked;
    if (r.asked === 0) break;
    b = build();
  }
  judged.left = b.same.pending.length;
  if (judged.failed === 0 && judged.left === 0 && b.same.seen) await retireUnseen(clientNumber, userId, 'samedoc:', b.same.seen).catch(() => 0);
  return { ...(await syncNotes({ clientNumber, userId }, DOCUMENT_ACTOR, b.notes)), judged };
}
