/**
 * Meaning notes — projects, topics, decisions and commitments (action items)
 * read from the conversations the user took part in (docs/Wiki-Knowledge.md
 * §0.13 part 10). The first notes the model writes; everything before this is
 * facts only.
 *
 *  - One model call per conversation the user wrote in, not per email. Its
 *    answer is kept as a `meaning` mark on the conversation's newest email,
 *    with a fingerprint of the conversation: an unchanged conversation is never
 *    read twice, a changed one is read again.
 *  - What the model returns is checked and only then becomes notes: projects,
 *    topics, decisions and commitments, `[[linked]]` to the people and to each
 *    other, each citing the emails it came from.
 *  - A commitment is open only when the conversation did not close it and it is
 *    recent; older open ones are kept as history (owner, 13 Nov 2026: read the
 *    whole history; old requests must not become open action items).
 *  - Private: a user's conversations make that user's notes only.
 */
import crypto from 'crypto';
import prisma from '../../db/prisma';
import { listSources, type Source } from './wikiSources';
import { marksOf, markSource } from './wikiMarks';
import { writeNote, retireNote, WIKI_GENERATION } from './wikiStore';
import { cleanTitle, titleKey, wikiLink } from './wikiLinks';

export const MEANING_ACTOR = 'wiki_meaning';
/** A commitment with no activity for longer than this is history, not open. A first guess, to be set from his data. */
export const OPEN_WINDOW_DAYS = 60;
const MODEL = 'gemini-flash';
const PROMPT_VERSION = 'meaning-v1';
const MAX_MESSAGE_CHARS = 4000;
const MAX_THREAD_CHARS = 20000;
/** Conversations read by the model at once. */
const CONCURRENCY = 6;

export interface Extracted {
  projects: Array<{ name: string; summary: string; status?: string }>;
  topics: Array<{ name: string }>;
  decisions: Array<{ what: string; by?: string | null; date?: string | null }>;
  commitments: Array<{ what: string; owner?: string | null; to?: string | null; due?: string | null; state: 'open' | 'done' | 'dropped'; evidence?: string | null; date?: string | null }>;
}

export interface Conversation {
  key: string;
  subject: string;
  sources: Source[];
  last: Date;
}

const SYSTEM = `You read one email conversation of a business executive and say what it is about, for his knowledge base.
Answer with JSON only, exactly this shape:
{"projects":[{"name":"","summary":"","status":""}],"topics":[{"name":""}],"decisions":[{"what":"","by":"","date":"YYYY-MM-DD"}],"commitments":[{"what":"","owner":"email","to":"email","due":"YYYY-MM-DD","state":"open|done|dropped","evidence":"","date":"YYYY-MM-DD"}]}
Rules:
- A project is a named piece of work with a goal (a client engagement, an implementation, a proposal). Use its usual name, short. Not a person, not a company, not a meeting.
- A topic is a recurring subject that is not a project (pricing, hiring, payroll). At most 3.
- A decision is something that was decided in this conversation, by whom, on which date.
- A commitment is something someone said they would do, or was asked to do and accepted. owner = who owes it (email address from the conversation), to = who it is owed to. state: "done" when a later message shows it was done, "dropped" when it was cancelled, else "open". evidence: the few words that show the state. date: when it was committed.
- Only what the conversation says. Never invent names, dates or emails. Leave a field empty when it is not there.
- Newsletters, notifications and automated mail: return empty lists.`;

/** The conversations the user wrote in, with their emails oldest first. */
export function conversationsOf(sources: Source[], ownEmails: Set<string>): Conversation[] {
  const byThread = new Map<string, Source[]>();
  for (const s of sources) {
    const key = s.threadKey || s.id;
    byThread.set(key, [...(byThread.get(key) ?? []), s]);
  }
  const wrote = (s: Source) => {
    const labels = Array.isArray((s.details as any)?.labels) ? (s.details as any).labels as string[] : [];
    const from = String((s.details as any)?.from ?? '').toLowerCase();
    return labels.includes('SENT') || [...ownEmails].some((e) => from.includes(e));
  };
  const out: Conversation[] = [];
  for (const [key, list] of byThread) {
    if (!list.some(wrote)) continue;
    const sorted = [...list].sort((a, b) => (a.occurredAt?.getTime() ?? 0) - (b.occurredAt?.getTime() ?? 0));
    out.push({ key, subject: sorted[sorted.length - 1].title ?? sorted[0].title ?? '(no subject)', sources: sorted, last: sorted[sorted.length - 1].occurredAt ?? new Date(0) });
  }
  return out.sort((a, b) => b.last.getTime() - a.last.getTime());
}

/** A fingerprint of what the model would read: it changes when an email is added or its text changes. */
export function fingerprint(c: Conversation): string {
  return crypto.createHash('sha256').update(PROMPT_VERSION + c.sources.map((s) => `${s.id}:${s.body.length}:${s.body.slice(0, 200)}`).join('|')).digest('hex').slice(0, 32);
}

/** The conversation as the model reads it. */
export function renderConversation(c: Conversation): string {
  let total = 0;
  const parts: string[] = [`Subject: ${c.subject}`];
  for (const s of [...c.sources].reverse()) {
    const d = s.details as any;
    const text = s.body.replace(/\n{3,}/g, '\n\n').slice(0, MAX_MESSAGE_CHARS);
    const block = `---\nDate: ${s.occurredAt?.toISOString().slice(0, 10) ?? ''}\nFrom: ${d?.from ?? ''}\nTo: ${d?.to ?? ''}${d?.cc ? `\nCc: ${d.cc}` : ''}\n\n${text}`;
    if (total + block.length > MAX_THREAD_CHARS) break;
    parts.splice(1, 0, block); // oldest first, newest kept when cut
    total += block.length;
  }
  return parts.join('\n');
}

const str = (v: unknown, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const dateOrNull = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null);
const emailOrNull = (v: unknown) => {
  const m = typeof v === 'string' ? v.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/) : null;
  return m ? m[0] : null;
};

/** What the model said, checked: anything malformed is dropped, never guessed. */
export function parseExtraction(text: string): Extracted {
  const empty: Extracted = { projects: [], topics: [], decisions: [], commitments: [] };
  const raw = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let j: any;
  try { j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { return empty; }
  if (!j || typeof j !== 'object') return empty;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    projects: arr(j.projects).map((p: any) => ({ name: str(p?.name, 80), summary: str(p?.summary, 500), status: str(p?.status, 80) })).filter((p) => p.name.length >= 3).slice(0, 5),
    topics: arr(j.topics).map((t: any) => ({ name: str(t?.name, 60) })).filter((t) => t.name.length >= 3).slice(0, 3),
    decisions: arr(j.decisions).map((d: any) => ({ what: str(d?.what, 240), by: emailOrNull(d?.by), date: dateOrNull(d?.date) })).filter((d) => d.what.length >= 5).slice(0, 8),
    commitments: arr(j.commitments).map((c: any) => ({
      what: str(c?.what, 200), owner: emailOrNull(c?.owner), to: emailOrNull(c?.to), due: dateOrNull(c?.due),
      state: (['open', 'done', 'dropped'].includes(c?.state) ? c.state : 'open') as 'open' | 'done' | 'dropped',
      evidence: str(c?.evidence, 200) || null, date: dateOrNull(c?.date),
    })).filter((c) => c.what.length >= 5).slice(0, 10),
  };
}

/**
 * A meaning note whose name another kind of note already has (a project called like a person,
 * a topic called like a project) gets its kind in its title, and every link to it is rewritten,
 * so links reach it instead of being ambiguous.
 */
export function renameClashes(notes: Built[], taken: Set<string>): Built[] {
  const keyCount = new Map<string, number>();
  for (const n of notes) keyCount.set(titleKey(n.title), (keyCount.get(titleKey(n.title)) ?? 0) + 1);
  const renamed = new Map<string, string>();
  for (const n of notes) {
    if (n.type !== 'project' && n.type !== 'topic') continue;
    const k = titleKey(n.title);
    if (taken.has(k) || (keyCount.get(k) ?? 0) > 1) renamed.set(`${n.type}|${k}`, cleanTitle(`${n.title} (${n.type})`));
  }
  if (renamed.size === 0) return notes;
  const byKey = new Map([...renamed].map(([tk, t]) => [tk.split('|')[1], t]));
  return notes.map((n) => {
    const own = renamed.get(`${n.type}|${titleKey(n.title)}`);
    const body = n.body.replace(/\[\[([^\]|]+)\]\]/g, (m, t) => (byKey.has(titleKey(t)) ? `[[${byKey.get(titleKey(t))}]]` : m));
    return { ...n, title: own ?? n.title, body };
  });
}

/** Is a commitment open now? Open, and something happened in its conversation within the window. */
export function openNow(state: string, lastActivity: Date, now: Date, windowDays = OPEN_WINDOW_DAYS): boolean {
  return state === 'open' && now.getTime() - lastActivity.getTime() <= windowDays * 86_400_000;
}

type Built = Omit<Parameters<typeof writeNote>[0], 'clientNumber' | 'userId' | 'actor'>;

/** Extractions in, notes out. Pure. */
export function buildMeaningNotes(
  items: Array<{ conv: Conversation; ex: Extracted }>,
  ctx: { personByEmail: Map<string, string>; now: Date; ownEmails?: Set<string> },
): Built[] {
  const own = ctx.ownEmails ?? new Set<string>();
  const person = (e?: string | null) => (e && own.has(e) ? 'you' : e && ctx.personByEmail.get(e) ? wikiLink(ctx.personByEmail.get(e)!) : e ?? null);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const projects = new Map<string, { name: string; summary: string; status: string; last: Date; people: Set<string>; convs: Conversation[]; decisions: string[]; commitments: string[] }>();
  const topics = new Map<string, { name: string; convs: Conversation[]; projects: Set<string> }>();
  const notes: Built[] = [];
  const peopleOf = (c: Conversation) => {
    const out = new Set<string>();
    for (const s of c.sources) for (const p of (s.participants as string[]) ?? []) {
      const e = emailOrNull(p);
      if (e && ctx.personByEmail.has(e)) out.add(ctx.personByEmail.get(e)!);
    }
    return out;
  };

  for (const { conv, ex } of items) {
    const sourceIds = conv.sources.map((s) => s.id);
    const convPeople = peopleOf(conv);
    const projectTitles = ex.projects.map((p) => cleanTitle(p.name));
    for (const p of ex.projects) {
      const k = titleKey(p.name);
      const d = projects.get(k) ?? { name: cleanTitle(p.name), summary: '', status: '', last: new Date(0), people: new Set<string>(), convs: [], decisions: [], commitments: [] };
      if (conv.last >= d.last) { d.summary = p.summary || d.summary; d.status = p.status || d.status; d.last = conv.last; }
      for (const x of convPeople) d.people.add(x);
      d.convs.push(conv);
      projects.set(k, d);
    }
    for (const t of ex.topics) {
      const k = titleKey(t.name);
      if (projects.has(k)) continue;
      const d = topics.get(k) ?? { name: cleanTitle(t.name), convs: [], projects: new Set<string>() };
      d.convs.push(conv);
      for (const pt of projectTitles) d.projects.add(pt);
      topics.set(k, d);
    }
    for (const dec of ex.decisions) {
      const title = cleanTitle(`Decision: ${dec.what}`).slice(0, 180);
      for (const pt of projectTitles) projects.get(titleKey(pt))?.decisions.push(title);
      notes.push({
        type: 'decision', title,
        body: [
          `**Decided:** ${dec.what}`,
          ...(dec.by ? [`**By:** ${person(dec.by)}`] : []),
          `**On:** ${dec.date ?? day(conv.last)}`,
          ...(projectTitles.length ? [`**Project:** ${projectTitles.map((t) => wikiLink(t)).join(', ')}`] : []),
          `**Conversation:** ${conv.subject}`,
        ].join('\n'),
        properties: { by: dec.by ?? null, on: dec.date ?? day(conv.last), conversation: conv.key },
        ids: [`decision:${conv.key}:${titleKey(dec.what).slice(0, 80)}`],
        sourceIds,
      });
    }
    for (const c of ex.commitments) {
      const open = openNow(c.state, conv.last, ctx.now);
      const shownState = c.state === 'open' && !open ? 'history' : c.state;
      const owner = c.owner ? (own.has(c.owner) ? 'you' : ctx.personByEmail.get(c.owner) ?? c.owner) : 'unknown';
      const title = cleanTitle(`${c.what} (${owner})`).slice(0, 180);
      for (const pt of projectTitles) projects.get(titleKey(pt))?.commitments.push(title);
      notes.push({
        type: 'commitment', title,
        body: [
          `**What:** ${c.what}`,
          `**Owed by:** ${person(c.owner) ?? 'not named'}`,
          ...(c.to ? [`**Owed to:** ${person(c.to)}`] : []),
          `**State:** ${shownState === 'history' ? 'open when last discussed, no activity since; kept as history' : shownState}`,
          ...(c.due ? [`**Due:** ${c.due}`] : []),
          ...(c.evidence ? [`**Evidence:** "${c.evidence}"`] : []),
          `**Last activity:** ${day(conv.last)}`,
          ...(projectTitles.length ? [`**Project:** ${projectTitles.map((t) => wikiLink(t)).join(', ')}`] : []),
          `**Conversation:** ${conv.subject}`,
        ].join('\n'),
        properties: { state: shownState, openNow: open, owner: c.owner ?? null, ownedByYou: !!c.owner && own.has(c.owner), to: c.to ?? null, due: c.due, lastActivity: day(conv.last), conversation: conv.key },
        ids: [`commitment:${conv.key}:${titleKey(c.what).slice(0, 80)}`],
        sourceIds,
      });
    }
  }

  for (const p of projects.values()) {
    const sourceIds = [...new Set(p.convs.flatMap((c) => c.sources.map((s) => s.id)))];
    notes.push({
      type: 'project', title: p.name,
      body: [
        p.summary || 'A piece of work discussed in his email.',
        '',
        ...(p.status ? [`**Status:** ${p.status}`] : []),
        `**Last discussed:** ${day(p.last)}`,
        ...(p.people.size ? ['', '## People', ...[...p.people].sort().map((x) => `- ${wikiLink(x)}`)] : []),
        ...(p.decisions.length ? ['', '## Decisions', ...[...new Set(p.decisions)].map((x) => `- ${wikiLink(x)}`)] : []),
        ...(p.commitments.length ? ['', '## Commitments', ...[...new Set(p.commitments)].map((x) => `- ${wikiLink(x)}`)] : []),
        '', '## Conversations', ...p.convs.map((c) => `- ${c.subject} (${day(c.last)})`),
      ].join('\n'),
      properties: { status: p.status || null, lastDiscussed: day(p.last), people: p.people.size, conversations: p.convs.length },
      sourceIds,
    });
  }
  for (const t of topics.values()) {
    notes.push({
      type: 'topic', title: t.name,
      body: [
        `A subject that comes up in ${t.convs.length} conversation${t.convs.length === 1 ? '' : 's'}.`,
        ...(t.projects.size ? ['', '## Projects', ...[...t.projects].sort().map((x) => `- ${wikiLink(x)}`)] : []),
        '', '## Conversations', ...t.convs.map((c) => `- ${c.subject} (${day(c.last)})`),
      ].join('\n'),
      properties: { conversations: t.convs.length },
      sourceIds: [...new Set(t.convs.flatMap((c) => c.sources.map((s) => s.id)))],
    });
  }
  // A topic that is also a project is the project.
  const projectKeys = new Set([...projects.keys()]);
  // One title per type: a repeated decision or commitment title keeps the first. Projects and
  // topics come first, so a link from a decision or commitment finds its project already written.
  const order: Record<string, number> = { project: 0, topic: 1, decision: 2, commitment: 3 };
  notes.sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
  const seen = new Set<string>();
  return notes.filter((n) => {
    if (n.type === 'topic' && projectKeys.has(titleKey(n.title))) return false;
    const k = `${n.type}|${titleKey(n.title)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Read the user's conversations and write their meaning notes. Only
 * conversations not yet read (or changed since) cost a model call; `limit`
 * caps how many are read in this run (newest first). With `dryRun`, no note is
 * written (model answers are still kept, so they are not paid for twice).
 */
export async function rebuildMeaningForUser(
  clientNumber: string,
  userId: number,
  opts: { limit?: number; dryRun?: boolean; now?: Date; call?: (sys: string, user: string) => Promise<string> } = {},
): Promise<{ conversations: number; read: number; cached: number; failed: number; notes: Built[]; written: number; retired: number }> {
  const now = opts.now ?? new Date();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const sources = await listSources(clientNumber, userId, ['email']);
  // listSources leaves the text out of encrypted sources; emails are plain.
  // His own addresses: his account, and every address his sent mail came from.
  const ownEmails = new Set<string>([String(user?.email ?? '').toLowerCase()].filter(Boolean));
  for (const s of sources) {
    const labels = Array.isArray((s.details as any)?.labels) ? (s.details as any).labels : [];
    if (labels.includes('SENT')) { const e = emailOrNull((s.details as any)?.from); if (e) ownEmails.add(e); }
  }
  const convs = conversationsOf(sources, ownEmails);
  const call = opts.call ?? (async (sys: string, msg: string) => {
    const { callLLM } = await import('../llmRouter');
    const r = await callLLM(sys, msg, { providers: [MODEL as any], maxTokens: 2000, timeoutMs: 60_000, userId, clientNumber, purpose: 'wiki_meaning' });
    return r.text;
  });

  const newest = convs.map((c) => c.sources[c.sources.length - 1].id);
  const held = await marksOf(clientNumber, userId, newest);
  const items: Array<{ conv: Conversation; ex: Extracted }> = [];
  let read = 0; let cached = 0; let failed = 0;
  const toRead: Array<{ c: Conversation; anchor: string; fp: string }> = [];
  for (const c of convs) {
    const anchor = c.sources[c.sources.length - 1].id;
    const fp = fingerprint(c);
    const mark = (held.get(anchor) ?? []).find((m) => m.kind === 'meaning');
    if (mark && (mark.value as any).fingerprint === fp) {
      items.push({ conv: c, ex: (mark.value as any).extracted as Extracted });
      cached += 1;
    } else if (opts.limit === undefined || toRead.length < opts.limit) {
      toRead.push({ c, anchor, fp });
    }
  }
  // A few at a time: the model is the slow part.
  for (let i = 0; i < toRead.length; i += CONCURRENCY) {
    await Promise.all(toRead.slice(i, i + CONCURRENCY).map(async ({ c, anchor, fp }) => {
      try {
        const ex = parseExtraction(await call(`${SYSTEM}\nToday is ${now.toISOString().slice(0, 10)}.`, renderConversation(c)));
        await markSource({ clientNumber, userId }, anchor, { kind: 'meaning', value: { fingerprint: fp, model: MODEL, prompt: PROMPT_VERSION, extracted: ex }, by: `model:${MODEL}` });
        items.push({ conv: c, ex });
        read += 1;
      } catch {
        failed += 1;
      }
    }));
  }
  items.sort((a, b) => b.conv.last.getTime() - a.conv.last.getTime());

  const people = await prisma.wikiPage.findMany({
    where: { clientNumber, userId, pageType: 'person', status: 'active', metadata: { path: ['wiki'], equals: WIKI_GENERATION } },
    select: { title: true, metadata: true },
  });
  const personByEmail = new Map<string, string>();
  for (const p of people as any[]) for (const id of p.metadata?.ids ?? []) if (String(id).startsWith('email:')) personByEmail.set(String(id).slice(6), p.title);
  const notes = renameClashes(buildMeaningNotes(items, { personByEmail, now, ownEmails }),
    await prisma.wikiPage.findMany({
      where: { clientNumber, OR: [{ scope: 'tenant' }, { userId }], status: 'active', metadata: { path: ['wiki'], equals: WIKI_GENERATION }, NOT: { lastUpdatedBy: MEANING_ACTOR } },
      select: { title: true },
    }).then((r: any[]) => new Set(r.map((x) => titleKey(x.title)))));

  let written = 0; let retired = 0;
  if (!opts.dryRun) {
    const existing = await prisma.wikiPage.findMany({ where: { clientNumber, userId, lastUpdatedBy: MEANING_ACTOR }, select: { id: true, status: true, pageType: true, title: true, bodyMarkdown: true, metadata: true } });
    const byKey = new Map((existing as any[]).map((e) => [`${e.pageType}|${e.title}`, e]));
    const kept = new Set<string>();
    for (const n of notes) {
      const have: any = byKey.get(`${n.type}|${cleanTitle(n.title)}`);
      // Unchanged, and every link already reaches its note: nothing to write.
      if (have && have.status === 'active' && have.bodyMarkdown === n.body && !(have.metadata?.unresolvedLinks ?? []).length && !(have.metadata?.ambiguousLinks ?? []).length) { kept.add(have.id); continue; }
      const r = await writeNote({ ...n, clientNumber, userId, actor: MEANING_ACTOR, exact: true });
      kept.add(r.id);
      written += 1;
    }
    // Only when every conversation was considered (none left unread) may a note that is no longer produced be retired.
    if (failed === 0 && read + cached === convs.length) {
      for (const e of existing as any[]) {
        if (kept.has(e.id) || e.status === 'superseded') continue;
        await retireNote(e.id, MEANING_ACTOR);
        retired += 1;
      }
    }
  }
  return { conversations: convs.length, read, cached, failed, notes, written, retired };
}
