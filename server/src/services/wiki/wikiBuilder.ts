/**
 * Wiki builder — turns what the feeds have already stored into notes
 * (docs/Wiki-Knowledge.md, step 2).
 *
 * It reads `feed_events` (email, calendar, chat) for one user and writes
 * person, company, meeting and group notes through `wikiStore.writeNote`,
 * linked to each other with `[[Title]]`. It does not fetch anything and does
 * not touch the feed code: the feeds store, the wiki builds.
 *
 * No model is used here. Every line in a built note is a fact read straight
 * from a stored item, so a rebuild gives the same notes every time.
 *
 * Junk is kept out at the door (Wiki-Knowledge.md §7):
 *   - no note per email;
 *   - a person gets a note only when the user dealt with them: an email
 *     thread the user wrote in, a meeting they shared, a direct chat, or two
 *     or more messages in a shared chat space;
 *   - no-reply, notification and bulk senders never get a note.
 *
 * `buildNotes` is pure (stored items in, notes out) so it can be tested and
 * dry-run; `rebuildWikiForUser` loads the items and writes the notes.
 */
import prisma from '../../db/prisma';
import { cleanTitle, titleKey, wikiLink } from './wikiLinks';
import { writeNote, retireNote, mergeNotes, citeSources, listSources, normalizeIds, IdentityConflict, WIKI_GENERATION, type NoteInput } from './wikiStore';

export const BUILDER_ACTOR = 'wiki_builder';
const LIST_LIMIT = 15;
const BIG_MEETING = 25;

export interface StoredItem {
  id: string;
  sourceType: string;
  at: Date;
  payload: Record<string, any>;
}

export interface BuildContext {
  userName: string | null;
  userEmail: string | null;
  /** Names already known for an address (from the existing contact records). */
  knownNames?: Map<string, string>;
  /** Phones already known for an address. */
  knownPhones?: Map<string, string>;
  /** The moment of the build; defaults to now. Later dates are upcoming, not contact. */
  now?: Date;
  /** Groups of addresses the user has said are one person (`email:a@x.com`); the only merge that needs no other evidence. */
  confirmedSame?: string[][];
}

export type BuiltNote = Omit<NoteInput, 'clientNumber' | 'userId' | 'actor'>;

const GENERIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
  'live.com', 'aol.com', 'protonmail.com', 'proton.me', 'msn.com', 'me.com',
]);
const JUNK_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|microsoftexchange[a-z0-9]*|bounces?|notifications?|notify|newsletter|news|alerts?|updates?|info|marketing|promo|billing-noreply|calendar-notification|drive-shares-(dm-)?noreply|comments-noreply)([+.\-_].*)?$/i;
const JUNK_DOMAIN = /(^|\.)(resource\.calendar\.google\.com|group\.calendar\.google\.com|calendar\.google\.com|bounces?\..*|noreply\..*|mailchimp\.com|sendgrid\.net|amazonses\.com)$/i;

export interface Address {
  email: string;
  name: string | null;
}

/** Parse `Name <a@b.com>, c@d.com` into addresses. */
export function parseAddresses(raw: unknown): Address[] {
  if (Array.isArray(raw)) return raw.flatMap((r) => parseAddresses(r));
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const out: Address[] = [];
  for (const part of raw.match(/(?:"[^"]*"|[^,])+/g) ?? []) {
    const m = part.match(/^\s*"?([^"<]*?)"?\s*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
    const email = (m ? m[2] : part.match(/[^\s<>"']+@[^\s<>"']+/)?.[0] ?? '').toLowerCase();
    if (!email) continue;
    const name = m ? m[1].trim() : '';
    out.push({ email, name: name && !name.includes('@') ? name : null });
  }
  return out;
}

export function isJunkAddress(email: string): boolean {
  const [local, domain = ''] = email.split('@');
  return JUNK_LOCAL.test(local) || JUNK_DOMAIN.test(domain);
}

function domainOf(email: string): string {
  return email.split('@')[1] ?? '';
}

/** `tmcltd.com` and `tmcltd.ai` are one organisation: the label left of the ending. */
export function orgLabel(domain: string): string {
  const parts = domain.toLowerCase().split('.');
  parts.pop();
  if (parts.length > 1 && ['com', 'co', 'net', 'org', 'edu', 'gov', 'ac'].includes(parts[parts.length - 1])) parts.pop();
  return parts[parts.length - 1] ?? domain;
}

const ROLE_WORDS = new Set([
  'all', 'hr', 'account', 'accounts', 'admin', 'support', 'leadership', 'council', 'exec', 'team', 'info', 'sales',
  'finance', 'helpdesk', 'service', 'services', 'billing', 'office', 'hod', 'func', 'meeting', 'dept', 'careers',
  'jobs', 'contact', 'hello', 'enquiries', 'inquiries', 'procurement', 'payroll', 'recruitment', 'everyone',
]);

/** A shared mailbox or mailing list (hr@, accounts@, ph.all@), not a person. */
export function isRoleAddress(email: string): boolean {
  const local = email.split('@')[0].toLowerCase();
  return /^(entire|all[.\-_]|everyone)/.test(local) || local.split(/[._\-+]+/).some((t) => ROLE_WORDS.has(t));
}

/** A chat sender that is an app or has no name, not a person. */
function isChatNonPerson(name: string): boolean {
  return /^users[ /]\d+$/i.test(name) || /\bbot\b/i.test(name) || /^google /i.test(name);
}

/** `Ali, Shamuel` → `Shamuel Ali`. */
function fixNameOrder(name: string): string {
  const m = name.match(/^([^,]+),\s*([^,]+)$/);
  return m ? `${m[2].trim()} ${m[1].trim()}` : name;
}

function tokens(name: string): string[] {
  return titleKey(name).split(/[^a-z0-9]+/).filter(Boolean);
}

/** `salman.sohail@x.com` → `Salman Sohail`: the last resort when no name is known. */
export function nameFromEmail(email: string): string {
  return email
    .split('@')[0]
    .split(/[._\-+]+/)
    .filter((p) => p && !/^\d+$/.test(p))
    .map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

/** A title that can be linked to: no `[`, `]`, `|` or `#`. */
export function noteTitle(raw: string): string {
  // Quotes around a display name (`'Anil Singh'`) are not part of the name.
  return cleanTitle((raw ?? '').replace(/[\[\]|#^]/g, ' ').replace(/^['"‘’“”\s]+|['"‘’“”\s]+$/g, ''));
}

/** Date in Pakistan time, `YYYY-MM-DD`. */
function day(d: Date): string {
  return new Date(d.getTime() + 5 * 3600 * 1000).toISOString().slice(0, 10);
}

interface PersonDraft {
  title: string;
  emails: Map<string, number>;
  names: Map<string, number>;
  first: Date;
  last: Date;
  reasons: Set<string>;
  threads: Map<string, { subject: string; last: Date; count: number }>;
  meetings: Map<string, { count: number; last: Date }>;
  groups: Map<string, { count: number; last: Date }>;
  directChats: number;
  spaceMessages: number;
  sources: Array<{ id: string; at: Date }>;
  /** Titles of other people with the same name who were NOT merged, for want of evidence. */
  possiblySame: Set<string>;
}

function bump<K>(m: Map<K, number>, k: K, n = 1): void {
  m.set(k, (m.get(k) ?? 0) + n);
}
function top<K>(m: Map<K, number>): K | undefined {
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}
/** Every source a note was learned from, each once, newest first. */
function citedSources(src: Array<{ id: string; at: Date }>): string[] {
  return [...new Set([...src].sort((a, b) => b.at.getTime() - a.at.getTime()).map((s) => s.id))];
}

/** Stored items in, notes out. Pure. */
export function buildNotes(items: StoredItem[], ctx: BuildContext): BuiltNote[] {
  const ownKey = titleKey(ctx.userName ?? '');
  const now = (ctx.now ?? new Date()).getTime();
  const own = new Set<string>();
  if (ctx.userEmail) own.add(ctx.userEmail.toLowerCase());
  for (const it of items) {
    if (it.sourceType !== 'gmail') continue;
    const labels: string[] = Array.isArray(it.payload.labels) ? it.payload.labels : [];
    if (labels.includes('SENT')) for (const a of parseAddresses(it.payload.from)) own.add(a.email);
  }
  const ownIds = new Set([...own].map((e) => `${e.split('@')[0]}@${orgLabel(domainOf(e))}`));
  const isOther = (email: string) =>
    !own.has(email) &&
    !ownIds.has(`${email.split('@')[0]}@${orgLabel(domainOf(email))}`) &&
    !isJunkAddress(email) &&
    !isRoleAddress(email);
  const INVITE = /^(updated invitation|invitation|accepted|declined|tentatively accepted|canceled event|cancelled event|new event)\b.*:/i;

  // ── People, found by address or (chat only) by name ──────────────────
  const byEmail = new Map<string, PersonDraft>();
  const byName = new Map<string, PersonDraft>();
  const seenNames = new Map<string, Map<string, number>>();
  const noteName = (a: Address) => {
    if (!a.name) return;
    if (!seenNames.has(a.email)) seenNames.set(a.email, new Map());
    bump(seenNames.get(a.email)!, a.name);
  };
  const newDraft = (at: Date): PersonDraft => ({
    title: '', emails: new Map(), names: new Map(), first: at, last: at, reasons: new Set(),
    threads: new Map(), meetings: new Map(), groups: new Map(), directChats: 0, spaceMessages: 0, sources: [], possiblySame: new Set(),
  });
  const touch = (p: PersonDraft, it: StoredItem) => {
    if (it.at < p.first) p.first = it.at;
    if (it.at > p.last && it.at.getTime() <= now) p.last = it.at;
    p.sources.push({ id: it.id, at: it.at });
  };
  const personFor = (email: string, at: Date): PersonDraft => {
    let p = byEmail.get(email);
    if (!p) {
      p = newDraft(at);
      byEmail.set(email, p);
    }
    bump(p.emails, email);
    return p;
  };

  // Email: only threads the user wrote in.
  const threads = new Map<string, StoredItem[]>();
  for (const it of items) {
    if (it.sourceType !== 'gmail') continue;
    for (const a of [...parseAddresses(it.payload.from), ...parseAddresses(it.payload.to), ...parseAddresses(it.payload.cc)]) noteName(a);
    if (it.payload.fromName) for (const a of parseAddresses(it.payload.from)) noteName({ email: a.email, name: String(it.payload.fromName) });
    const key = String(it.payload.threadId ?? it.id);
    if (!threads.has(key)) threads.set(key, []);
    threads.get(key)!.push(it);
  }
  for (const [threadId, msgs] of threads) {
    const engaged = msgs.some((m) => {
      const labels: string[] = Array.isArray(m.payload.labels) ? m.payload.labels : [];
      return m.payload.userRepliedThread === true || labels.includes('SENT') || parseAddresses(m.payload.from).some((a) => own.has(a.email));
    });
    if (!engaged) continue;
    const last = msgs.reduce((a, b) => (a.at > b.at ? a : b));
    const subject = cleanTitle(String(last.payload.subject ?? '').replace(/^((re|fwd?|fw)\s*:\s*)+/i, '')) || '(no subject)';
    if (INVITE.test(subject)) continue; // calendar mail: the meeting note covers it
    for (const m of msgs) {
      const people = [...parseAddresses(m.payload.from), ...parseAddresses(m.payload.to), ...parseAddresses(m.payload.cc)];
      for (const email of new Set(people.map((a) => a.email).filter(isOther))) {
        const p = personFor(email, m.at);
        touch(p, m);
        p.reasons.add('email');
        const t = p.threads.get(threadId) ?? { subject, last: m.at, count: 0 };
        t.count += 1;
        if (m.at > t.last) t.last = m.at;
        p.threads.set(threadId, t);
      }
    }
  }

  // Calendar: one meeting note per title (a recurring meeting is one note).
  interface MeetingDraft {
    title: string; dates: Date[]; attendees: Set<string>; organizers: Set<string>;
    link: string | null; description: string | null; big: boolean; sources: Array<{ id: string; at: Date }>;
  }
  const meetings = new Map<string, MeetingDraft>();
  const seenOccurrences = new Set<string>();
  for (const it of items) {
    if (it.sourceType !== 'gcal') continue;
    const title = noteTitle(String(it.payload.title ?? ''));
    if (!title) continue;
    const organizer = parseAddresses(it.payload.organizer).map((a) => a.email);
    const others = [...new Set([...parseAddresses(it.payload.attendees).map((a) => a.email), ...organizer])].filter(isOther);
    if (others.length === 0) continue;
    const start = new Date(it.payload.start ?? it.at);
    const when = Number.isNaN(start.getTime()) ? it.at : start;
    const key = titleKey(title);
    const occurrence = `${key}|${it.payload.eventId ?? ''}|${when.toISOString()}`;
    const repeat = seenOccurrences.has(occurrence);
    seenOccurrences.add(occurrence);
    const m = meetings.get(key) ?? { title, dates: [], attendees: new Set<string>(), organizers: new Set<string>(), link: null, description: null, big: false, sources: [] };
    if (!repeat) m.dates.push(when);
    m.sources.push({ id: it.id, at: when });
    if (it.payload.link) m.link = String(it.payload.link);
    if (it.payload.description) m.description = String(it.payload.description).slice(0, 1500);
    if (others.length > BIG_MEETING) m.big = true;
    else for (const e of others) m.attendees.add(e);
    for (const e of organizer.filter(isOther)) m.organizers.add(e);
    meetings.set(key, m);
    if (others.length > BIG_MEETING) continue;
    for (const email of others) {
      const p = personFor(email, when);
      touch(p, { ...it, at: when });
      p.reasons.add('meeting');
      const pm = p.meetings.get(key) ?? { count: 0, last: when };
      if (!repeat) pm.count += 1;
      if (when > pm.last) pm.last = when;
      p.meetings.set(key, pm);
    }
  }

  // Chat: a group note per shared space; people by name (chat carries no address).
  interface GroupDraft { title: string; space: string; members: Map<string, number>; messages: number; last: Date; sources: Array<{ id: string; at: Date }> }
  const groups = new Map<string, GroupDraft>();
  const chatPeople = new Map<string, { name: string; items: StoredItem[]; direct: number; spaces: Map<string, { count: number; last: Date }> }>();
  for (const it of items) {
    if (it.sourceType !== 'gchat') continue;
    const sender = noteTitle(String(it.payload.senderDisplayName ?? ''));
    const isSpace = it.payload.spaceType === 'SPACE';
    const spaceTitle = isSpace ? noteTitle(String(it.payload.spaceDisplayName ?? '')) : '';
    const gKey = titleKey(spaceTitle);
    // A chat opened for one meeting (`Title - Aug 7`) is not a standing group.
    const standing = isSpace && spaceTitle && !/ - [A-Z][a-z]{2} \d{1,2}$/.test(spaceTitle);
    if (standing) {
      const g = groups.get(gKey) ?? { title: spaceTitle, space: String(it.payload.spaceName ?? ''), members: new Map<string, number>(), messages: 0, last: it.at, sources: [] };
      g.messages += 1;
      if (it.at > g.last) g.last = it.at;
      g.sources.push({ id: it.id, at: it.at });
      if (sender && titleKey(sender) !== ownKey && !isChatNonPerson(sender)) bump(g.members, titleKey(sender));
      groups.set(gKey, g);
    }
    if (!sender || titleKey(sender) === ownKey || isChatNonPerson(sender)) continue;
    const c = chatPeople.get(titleKey(sender)) ?? { name: sender, items: [], direct: 0, spaces: new Map<string, { count: number; last: Date }>() };
    c.items.push(it);
    if (standing) {
      const s = c.spaces.get(gKey) ?? { count: 0, last: it.at };
      s.count += 1;
      if (it.at > s.last) s.last = it.at;
      c.spaces.set(gKey, s);
    } else if (!isSpace) c.direct += 1;
    chatPeople.set(titleKey(sender), c);
  }

  const chatTitle = new Map<string, string>();
  const mergeInto = (into: PersonDraft, p: PersonDraft) => {
    for (const [e, n] of p.emails) bump(into.emails, e, n);
    for (const r of p.reasons) into.reasons.add(r);
    for (const [k, v] of p.threads) {
      const cur = into.threads.get(k);
      into.threads.set(k, cur ? { ...cur, count: Math.max(cur.count, v.count), last: cur.last > v.last ? cur.last : v.last } : v);
    }
    for (const [k, v] of p.meetings) {
      const cur = into.meetings.get(k);
      into.meetings.set(k, cur ? { count: Math.max(cur.count, v.count), last: cur.last > v.last ? cur.last : v.last } : v);
    }
    if (p.first < into.first) into.first = p.first;
    if (p.last > into.last) into.last = p.last;
    into.sources.push(...p.sources);
  };

  // One person, several addresses: the same mailbox name at one organisation
  // (umair.wasim@tmcltd.com and umair.wasim@tmcltd.ai).
  const byMailbox = new Map<string, PersonDraft>();
  for (const [email, p] of byEmail) {
    const d = domainOf(email);
    const id = GENERIC_DOMAINS.has(d) ? email : `${email.split('@')[0]}@${orgLabel(d)}`;
    const into = byMailbox.get(id);
    if (into) mergeInto(into, p);
    else byMailbox.set(id, p);
  }

  // One person because the user said so: the addresses he confirmed are one.
  for (const group of ctx.confirmedSame ?? []) {
    const emails = new Set(group.filter((x) => x.startsWith('email:')).map((x) => x.slice(6)));
    const keys = [...byMailbox.entries()].filter(([, d]) => [...d.emails.keys()].some((e) => emails.has(e))).map(([k]) => k);
    for (const k of keys.slice(1)) {
      mergeInto(byMailbox.get(keys[0])!, byMailbox.get(k)!);
      byMailbox.delete(k);
    }
  }

  // Name each person: the name they are most often written with; a one-word
  // name gives way to a fuller one read from the address.
  const orgsOf = (p: PersonDraft) =>
    new Set([...p.emails.keys()].map(domainOf).filter((d) => !GENERIC_DOMAINS.has(d)).map(orgLabel));
  for (const p of byMailbox.values()) {
    const emails = [...p.emails.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e);
    const seen = new Map<string, number>();
    for (const e of emails) for (const [n, c] of seenNames.get(e) ?? []) bump(seen, fixNameOrder(n), c);
    const fromAddress = emails.map(nameFromEmail).sort((a, b) => tokens(b).length - tokens(a).length)[0] ?? '';
    let name = top(seen) ?? emails.map((e) => ctx.knownNames?.get(e)).find(Boolean) ?? fromAddress;
    if (tokens(name).length < 2 && tokens(fromAddress).length >= 2) name = fromAddress;
    let title = noteTitle(fixNameOrder(name)) || emails[0];
    if (titleKey(title) === ownKey) continue; // the user's own other address
    // Same name: one person only on evidence, which is the same mailbox name or the same
    // organisation. A matching name alone (a work address and a personal one, say) is not
    // evidence: they stay two notes that point at each other until the user says they are one
    // (docs/Wiki-Knowledge.md §0.7 standard 2).
    const into = byName.get(titleKey(title));
    if (into) {
      const a = orgsOf(into);
      const b = orgsOf(p);
      const locals = new Set([...into.emails.keys()].map((e) => e.split('@')[0]));
      const sameMailbox = emails.some((e) => locals.has(e.split('@')[0]));
      if (sameMailbox || [...a].some((o) => b.has(o))) {
        mergeInto(into, p);
        continue;
      }
      let second = noteTitle(`${title} (${domainOf(emails[0])})`);
      if (byName.has(titleKey(second))) second = noteTitle(`${title} (${emails[0]})`);
      title = second;
      p.possiblySame.add(into.title);
      into.possiblySame.add(title);
    }
    p.title = title;
    byName.set(titleKey(title), p);
  }

  // Chat gives a name and no address. Join it to the person with that name;
  // failing that, to the only person whose name contains it (two words or more).
  for (const [key, c] of chatPeople) {
    const spaceTotal = [...c.spaces.values()].reduce((n, s) => n + s.count, 0);
    const qualifies = c.direct > 0 || spaceTotal >= 2;
    let p = byName.get(key);
    if (!p) {
      const mine = tokens(c.name);
      if (mine.length >= 2) {
        const close = [...byName.values()].filter((x) => {
          const theirs = tokens(x.title);
          return mine.every((t) => theirs.includes(t)) || theirs.every((t) => mine.includes(t));
        });
        if (close.length === 1) p = close[0];
      }
    }
    if (!p && !qualifies) continue;
    if (!p) {
      p = newDraft(c.items[0].at);
      p.title = c.name;
      byName.set(key, p);
    }
    for (const it of c.items) touch(p, it);
    p.reasons.add('chat');
    p.directChats += c.direct;
    p.spaceMessages += spaceTotal;
    for (const [k, v] of c.spaces) p.groups.set(k, v);
    chatTitle.set(key, p.title);
  }
  const people = [...byName.values()].filter((p) => p.reasons.size > 0);
  const personTitleByEmail = new Map<string, string>();
  for (const p of people) for (const e of p.emails.keys()) personTitleByEmail.set(e, p.title);
  const personTitleByKey = new Map([...people.map((p) => [titleKey(p.title), p.title] as [string, string]), ...chatTitle]);

  // ── Notes ────────────────────────────────────────────────────────────
  const notes: BuiltNote[] = [];
  const recent = <T extends { last: Date }>(m: Map<string, T>) =>
    [...m.entries()].sort((a, b) => b[1].last.getTime() - a[1].last.getTime());
  const more = (total: number) => (total > LIST_LIMIT ? [`- …and ${total - LIST_LIMIT} more`] : []);

  // Companies: the organisations behind the addresses of the people kept.
  // `tmcltd.com` and `tmcltd.ai` are one company, titled by its most used domain.
  const orgDomains = new Map<string, Map<string, number>>();
  for (const p of people) {
    for (const [e, n] of p.emails) {
      const d = domainOf(e);
      if (GENERIC_DOMAINS.has(d)) continue;
      if (!orgDomains.has(orgLabel(d))) orgDomains.set(orgLabel(d), new Map());
      bump(orgDomains.get(orgLabel(d))!, d, n);
    }
  }
  const companyOf = (p: PersonDraft): string | null => {
    const work = [...p.emails.entries()].filter(([e]) => !GENERIC_DOMAINS.has(domainOf(e))).sort((a, b) => b[1] - a[1])[0];
    return work ? top(orgDomains.get(orgLabel(domainOf(work[0])))!)! : null;
  };
  const companies = new Map<string, Set<string>>();
  for (const p of people) {
    const d = companyOf(p);
    if (!d) continue;
    if (!companies.has(d)) companies.set(d, new Set());
    companies.get(d)!.add(p.title);
  }
  for (const [domain, members] of companies) {
    const names = [...members].sort((a, b) => a.localeCompare(b));
    const domains = [...orgDomains.get(orgLabel(domain))!.keys()].sort();
    notes.push({
      type: 'company',
      title: domain,
      body: [`Organisation behind the address ${domains.length === 1 ? 'domain' : 'domains'} ${domains.map((d) => `\`${d}\``).join(', ')}.`, '', '## People', ...names.map((n) => `- ${wikiLink(n)}`)].join('\n'),
      properties: { domains, people: names.length },
      ids: domains.map((d) => `domain:${d}`),
    });
  }

  for (const p of people) {
    const emails = [...p.emails.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e);
    const phone = emails.map((e) => ctx.knownPhones?.get(e)).find(Boolean) ?? null;
    const company = companyOf(p);
    const lines: string[] = [];
    if (company) lines.push(`**Company:** ${wikiLink(company)}`);
    if (emails.length) lines.push(`**Email:** ${emails.join(', ')}`);
    if (phone) lines.push(`**Phone:** ${phone}`);
    lines.push(`**Last contact:** ${day(p.last)}`);
    if (p.possiblySame.size) lines.push(`**Possibly the same person:** ${[...p.possiblySame].sort().map((t) => wikiLink(t)).join(', ')}`);
    if (p.meetings.size) {
      lines.push('', '## Meetings');
      for (const [k, v] of recent(p.meetings).slice(0, LIST_LIMIT)) {
        lines.push(`- ${wikiLink(meetings.get(k)!.title)} — ${v.count === 1 ? 'once' : `${v.count} times`}, latest ${day(v.last)}`);
      }
      lines.push(...more(p.meetings.size));
    }
    if (p.threads.size) {
      lines.push('', '## Email conversations');
      for (const [, v] of recent(p.threads).slice(0, LIST_LIMIT)) {
        lines.push(`- ${day(v.last)} — ${v.subject} (${v.count} ${v.count === 1 ? 'message' : 'messages'})`);
      }
      lines.push(...more(p.threads.size));
    }
    if (p.groups.size || p.directChats) {
      lines.push('', '## Chat');
      if (p.directChats) lines.push(`- Direct chat — ${p.directChats} ${p.directChats === 1 ? 'message' : 'messages'}`);
      for (const [k, v] of recent(p.groups).slice(0, LIST_LIMIT)) {
        lines.push(`- ${wikiLink(groups.get(k)!.title)} — ${v.count} ${v.count === 1 ? 'message' : 'messages'}, last ${day(v.last)}`);
      }
    }
    notes.push({
      type: 'person',
      title: p.title,
      body: lines.join('\n'),
      properties: {
        emails, phone, company,
        firstSeen: day(p.first), lastSeen: day(p.last),
        emailThreads: p.threads.size, meetings: p.meetings.size,
        chatMessages: p.directChats + p.spaceMessages,
        knownFrom: [...p.reasons].sort(),
      },
      ids: emails.map((e) => `email:${e}`),
      sourceIds: citedSources(p.sources),
    });
  }

  for (const g of groups.values()) {
    const members = [...g.members.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => ({ title: personTitleByKey.get(k), n }))
      .filter((m): m is { title: string; n: number } => Boolean(m.title));
    if (members.length === 0) continue;
    notes.push({
      type: 'group',
      title: g.title,
      body: [`Chat space. ${g.messages} messages stored, last on ${day(g.last)}.`, '', '## People who write here',
        ...members.map((m) => `- ${wikiLink(m.title)} — ${m.n} ${m.n === 1 ? 'message' : 'messages'}`)].join('\n'),
      properties: { space: g.space, messages: g.messages, lastOn: day(g.last) },
      ...(g.space ? { ids: [`space:${g.space}`] } : {}),
      sourceIds: citedSources(g.sources),
    });
  }

  for (const m of meetings.values()) {
    const dates = [...m.dates].sort((a, b) => a.getTime() - b.getTime());
    const past = dates.filter((d) => d.getTime() <= now);
    const next = dates.find((d) => d.getTime() > now);
    const link = (emailsIn: Iterable<string>) =>
      [...new Set([...emailsIn].map((e) => personTitleByEmail.get(e)).filter((t): t is string => Boolean(t)))].sort((a, b) => a.localeCompare(b));
    const attendees = link(m.attendees);
    const organizers = link(m.organizers);
    const lines = [
      dates.length === 1 ? `Held on ${day(dates[0])}.` : `Recurring: ${dates.length} occurrences from ${day(dates[0])} to ${day(dates[dates.length - 1])}.`,
    ];
    if (past.length) lines.push(`**Last held:** ${day(past[past.length - 1])}`);
    if (next) lines.push(`**Next:** ${day(next)}`);
    if (organizers.length) lines.push(`**Organizer:** ${organizers.map((t) => wikiLink(t)).join(', ')}`);
    if (m.link) lines.push(`**Link:** ${m.link}`);
    if (m.big) lines.push(`A large meeting (more than ${BIG_MEETING} invited); attendees are not listed.`);
    if (attendees.length) lines.push('', '## Attendees', ...attendees.map((t) => `- ${wikiLink(t)}`));
    if (m.description) lines.push('', '## Description', m.description);
    notes.push({
      type: 'meeting',
      title: m.title,
      body: lines.join('\n'),
      properties: {
        occurrences: dates.length, firstOn: day(dates[0]), lastOn: day(dates[dates.length - 1]),
        nextOn: next ? day(next) : null, link: m.link, attendees: attendees.length,
      },
      sourceIds: citedSources(m.sources),
    });
  }

  // Two things of different kinds can share a name; the title must still be one per kind.
  const order = { company: 0, person: 1, group: 2, meeting: 3 } as Record<string, number>;
  return notes.sort((a, b) => order[a.type] - order[b.type] || a.title.localeCompare(b.title));
}

/** The kind of a source, as the feed type the builder reads. */
const FEED_TYPE: Record<string, string> = { email: 'gmail', calendar: 'gcal', chat: 'gchat' };

/**
 * Load what the Wiki holds for one user: its sources, which outlast the feed
 * queue (a fetched item is pruned after 30 days; its source stays).
 */
export async function loadStoredItems(clientNumber: string, userId: number): Promise<StoredItem[]> {
  const sources = await listSources(clientNumber, userId, ['email', 'calendar', 'chat']);
  return sources.map((s) => ({
    id: s.id,
    sourceType: FEED_TYPE[s.kind],
    at: s.occurredAt ?? new Date(0),
    payload: {
      ...s.details,
      ...(s.kind === 'email' ? { threadId: s.threadKey ?? s.details.threadId, subject: s.title ?? s.details.subject } : {}),
    },
  }));
}

async function loadContext(clientNumber: string, userId: number): Promise<BuildContext> {
  const user = await (prisma as any).user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  const known = await (prisma as any).entity.findMany({
    where: { clientNumber, email: { not: null }, OR: [{ scope: 'tenant' }, { ownerUserId: userId }] },
    select: { email: true, name: true, phone: true },
  });
  const knownNames = new Map<string, string>();
  const knownPhones = new Map<string, string>();
  for (const k of known) {
    const email = String(k.email).toLowerCase();
    if (k.name && !String(k.name).includes('@')) knownNames.set(email, k.name);
    if (k.phone) knownPhones.set(email, k.phone);
  }
  // What the user has said is one person stays one person in every build.
  const people = await (prisma as any).wikiPage.findMany({
    where: { clientNumber, userId, pageType: 'person', status: 'active' },
    select: { metadata: true },
  });
  const confirmedSame: string[][] = [];
  for (const p of people) {
    const groups = (p.metadata as any)?.confirmedSame;
    if (Array.isArray(groups)) for (const g of groups) if (Array.isArray(g) && g.length > 1) confirmedSame.push(g.map(String));
  }
  return { userName: user?.name ?? null, userEmail: user?.email ?? null, knownNames, knownPhones, confirmedSame };
}

export interface RebuildResult {
  items: number;
  notes: BuiltNote[];
  written: number;
  created: number;
  /** Notes whose text and properties were already what the build produced. */
  unchanged: number;
  /** Notes the build no longer produces, taken out of the wiki (restorable). */
  retired: number;
  /** Notes found by their identifier and given a new title. */
  renamed: number;
  /** Notes folded into another on evidence (restorable). */
  merged: number;
  byType: Record<string, number>;
  /** The rule notes built with them (null on a dry run). */
  rules?: { rules: number; written: number; unchanged: number; retired: number } | { error: string } | null;
}

function sameProperties(stored: unknown, built: Record<string, unknown> | undefined): boolean {
  const have = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const want = Object.fromEntries(Object.entries(built ?? {}).filter(([, v]) => v !== null && v !== undefined));
  return JSON.stringify(Object.entries(have).sort()) === JSON.stringify(Object.entries(want).sort());
}

/**
 * Build the notes for one user. With `dryRun`, nothing is written. A note
 * that already says what the build produced is left alone, so running this
 * after every feed sync costs one read per user when nothing is new.
 */
export async function rebuildWikiForUser(
  clientNumber: string,
  userId: number,
  opts: { dryRun?: boolean } = {},
): Promise<RebuildResult> {
  const [items, ctx] = await Promise.all([loadStoredItems(clientNumber, userId), loadContext(clientNumber, userId)]);
  const notes = buildNotes(items, ctx);
  const byType: Record<string, number> = {};
  for (const n of notes) byType[n.type] = (byType[n.type] ?? 0) + 1;
  let written = 0;
  let created = 0;
  let unchanged = 0;
  let retired = 0;
  let renamed = 0;
  let merged = 0;
  if (!opts.dryRun) {
    const existing = await (prisma as any).wikiPage.findMany({
      where: { clientNumber, userId, lastUpdatedBy: BUILDER_ACTOR },
      select: { id: true, pageType: true, title: true, bodyMarkdown: true, metadata: true, status: true },
    });
    const stored = new Map<string, any>(existing.map((e: any) => [`${e.pageType}|${e.title}`, e]));
    const sameIds = (have: unknown, built?: string[]) => JSON.stringify(normalizeIds(have)) === JSON.stringify(normalizeIds(built ?? []));
    // Every note this run stands behind, by its id: a note found by its identifier and renamed is
    // still the same note, so the retiring below goes by id, not by title.
    const kept = new Set<string>();
    for (const n of notes) {
      const have = stored.get(`${n.type}|${cleanTitle(n.title)}`);
      if (have && have.status === 'active' && have.metadata?.wiki === WIKI_GENERATION && have.bodyMarkdown === n.body && sameProperties(have.metadata?.properties, n.properties) && !(have.metadata?.unresolvedLinks ?? []).length && sameIds(have.metadata?.ids, n.ids)
        // A note written before notes had a revision is written once more, so its links are re-read
        // by the present rules (only live notes, nothing ambiguous) and it carries a revision.
        && typeof have.metadata?.rev === 'number') {
        // The text is current, but a new source may still belong to its trail.
        if (n.sourceIds?.length) await citeSources({ clientNumber, userId }, have.id, n.sourceIds);
        unchanged += 1;
        kept.add(have.id);
        continue;
      }
      const input = { ...n, clientNumber, userId, actor: BUILDER_ACTOR, exact: true };
      let r;
      try {
        r = await writeNote(input);
      } catch (err) {
        if (!(err instanceof IdentityConflict)) throw err;
        // The build put identifiers of two notes into one thing, which it does only on evidence
        // (the same mailbox at one organisation, or the user's word): fold the notes together.
        const titled = existing.find((e: any) => err.noteIds.includes(e.id) && e.title === cleanTitle(n.title));
        const survivor = titled?.id ?? err.noteIds[0];
        for (const other of err.noteIds) {
          if (other === survivor) continue;
          await mergeNotes({ clientNumber, userId }, survivor, other, BUILDER_ACTOR, 'the build found one thing behind both identifiers');
          kept.add(other);
          merged += 1;
        }
        r = await writeNote(input);
      }
      kept.add(r.id);
      written += 1;
      if (r.created) created += 1;
      if (r.renamedFrom) renamed += 1;
    }
    // A note the build no longer produces (a sender now recognised as a mailbox) is retired, so it
    // does not linger as a second copy. Retired, not deleted: it can be restored.
    for (const have of existing) {
      if (kept.has(have.id) || have.status === 'superseded') continue;
      await retireNote(have.id, BUILDER_ACTOR);
      retired += 1;
    }
  }
  // Rule notes are built with the other notes (Wiki-Knowledge §0.13 part 9). A failure there does
  // not undo the notes above; it is reported with the result.
  let rules: { rules: number; written: number; unchanged: number; retired: number } | { error: string } | null = null;
  if (!opts.dryRun) {
    try {
      const { rebuildRuleNotesForUser } = await import('./wikiRuleNotes');
      rules = await rebuildRuleNotesForUser(clientNumber, userId);
    } catch (err: any) {
      rules = { error: String(err?.message ?? err).slice(0, 200) };
    }
  }
  return { items: items.length, notes, written, created, unchanged, retired, renamed, merged, byType, rules };
}

/** Build the notes for every active user, one after another. */
export async function rebuildWikiForAllUsers(): Promise<Array<{ userId: number; written: number; created: number; unchanged: number; retired: number; renamed: number; merged: number; rules: RebuildResult['rules']; error?: string }>> {
  const { forEachActiveUser } = await import('../maintenance/queueArchiveMaintenanceService');
  const results = await forEachActiveUser((clientNumber, userId) => rebuildWikiForUser(clientNumber, userId));
  return results.map((r) => ({
    userId: r.userId,
    written: r.result?.written ?? 0,
    created: r.result?.created ?? 0,
    unchanged: r.result?.unchanged ?? 0,
    retired: r.result?.retired ?? 0,
    renamed: r.result?.renamed ?? 0,
    merged: r.result?.merged ?? 0,
    rules: r.result?.rules ?? null,
    ...(r.error ? { error: r.error } : {}),
  }));
}
