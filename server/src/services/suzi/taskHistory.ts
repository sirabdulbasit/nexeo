/**
 * Link T25 (both AGREE, 6 Nov 2026): what happened to one of the user's tasks, and when it last really changed.
 * Built by code from what Nexeo already records, with no model:
 *
 *   status history (accepted changes, with who made them) · assigns (the delegation trail) · due-date moves
 *   Nexeo logged · notes: his own, his answers to Nexeo's questions, replies from the person it went to ·
 *   Nexeo's own follow-ups to him · when it was created
 *
 * `changed_at` is the latest REAL change: status, due date, assign, a note or answer from him or someone else,
 * or creation. Nexeo's own bookkeeping (its follow-up questions and their stamps) never counts. That is the
 * difference from `updated_at`, which every write moves (DEF-406).
 *
 * Gaps, said plainly: some older due-date changes and every priority or title change left no record, so they
 * can't appear. Notes and follow-ups are kept bounded, so the oldest of a long history may be gone.
 */
import prisma from '../../db/prisma';

export const HISTORY_MAX = 20;
const NOTE_MAX = 300;

export interface HistoryEntry { at: string; who: string; change: string; note?: string }
export interface StatusRow { at: Date; from: string; to: string; actor: string | null; reason: string | null }
type Item = { createdAt?: Date | null; notes?: unknown; delegationTrail?: unknown; metadata?: unknown; delegateeName?: string | null };
type Ev = HistoryEntry & { real: boolean; ms: number };

const cut = (v: unknown) => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return t ? t.slice(0, NOTE_MAX) : undefined;
};
const ms = (v: unknown): number => {
  const t = v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : NaN;
};
const word = (s: string) => s.toLowerCase().replace(/_/g, ' ');
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

function whoOfActor(actor: string | null, userId: number): string {
  if (!actor) return 'Nexeo';
  const m = /^user:(\d+)$/.exec(actor);
  if (m) return Number(m[1]) === userId ? 'you' : 'a colleague';
  return 'Nexeo';
}

function events(item: Item, status: StatusRow[], userId: number): Ev[] {
  const out: Ev[] = [];
  const push = (at: unknown, who: string, change: string, real: boolean, note?: string) => {
    const t = ms(at);
    if (!Number.isFinite(t)) return;
    out.push({ at: new Date(t).toISOString(), ms: t, who, change, real, ...(note ? { note } : {}) });
  };

  push(item.createdAt, 'Nexeo', 'Created', true);

  for (const s of status) {
    push(s.at, whoOfActor(s.actor, userId), `Status: ${word(s.from)} → ${word(s.to)}`, true, cut(s.reason));
  }

  for (const t of arr(item.delegationTrail)) {
    const to = t?.delegatedTo ?? t?.to;
    if (!to) continue;
    push(t?.delegatedAt ?? t?.at, 'you', `Assigned to ${String(to).slice(0, 120)}`, true, cut(t?.note));
  }

  const lifecycle = (item.metadata as any)?.actionLifecycle ?? {};
  for (const c of arr(lifecycle.commitmentHistory)) {
    const due = typeof c?.dueDate === 'string' ? c.dueDate.slice(0, 10) : null;
    if (!due) continue;
    push(c?.at, c?.source === 'user' ? 'you' : 'Nexeo', `Due moved to ${due}`, true, cut(c?.reason));
  }
  for (const f of arr(lifecycle.followUpHistory)) {
    const ev = String(f?.event ?? '');
    if (!ev || ev === 'response_received') continue; // the answer itself is in the notes
    const change = /escalat/i.test(ev) ? 'Nexeo escalated it' : `Nexeo followed up${f?.channel ? ` (${String(f.channel)})` : ''}`;
    push(f?.at, 'Nexeo', change, false, cut(f?.summary));
  }

  for (const n of arr(item.notes)) {
    if (!n || typeof n !== 'object' || n.action) continue; // `action` notes repeat a status change
    if (n.by === 'action_lifecycle') {
      const mine = n.source === 'user';
      push(n.at, mine ? 'you' : (item.delegateeName || 'the person it is with'), mine ? `Answered: ${word(String(n.outcome ?? 'update'))}` : 'Update', true, cut(n.delayReason ?? n.summary));
    } else if (n.source === 'whatsapp_delegatee_reply') {
      push(n.at, String(n.from || item.delegateeName || 'the person it is with').slice(0, 120), 'Replied', true, cut(n.body));
    } else if (n.source === 'prompt_reply') {
      push(n.at, 'you', 'Answered Nexeo', true, cut(n.text));
    } else if (n.type === 'propagation' || n.by === 'delegation_tracker') {
      push(n.at, 'Nexeo', 'Noted', false, cut(n.text));
    } else if (n.text) {
      const by = typeof n.by === 'number' ? `user:${n.by}` : typeof n.by === 'string' ? n.by : null;
      push(n.at, n.source === 'suzi' ? 'you, through Suzi' : whoOfActor(by ?? `user:${userId}`, userId), 'Note', true, cut(n.text));
    }
  }
  return out;
}

/**
 * Newest first, at most 20. Nexeo's own follow-ups repeat (one task had 20 escalations in a row, crowding out
 * everything that really happened), so the same Nexeo step is folded into one line with a count, at its
 * latest time; real events are never folded.
 */
export function historyOf(item: Item, status: StatusRow[], userId: number): HistoryEntry[] {
  const sorted = events(item, status, userId).sort((a, b) => b.ms - a.ms);
  const out: Array<HistoryEntry & { n: number; key?: string }> = [];
  const folded = new Map<string, HistoryEntry & { n: number }>();
  for (const e of sorted) {
    if (!e.real) {
      const key = `${e.who}\u0000${e.change}`;
      const seen = folded.get(key);
      if (seen) { seen.n += 1; continue; }
      const entry = { at: e.at, who: e.who, change: e.change, ...(e.note ? { note: e.note } : {}), n: 1 };
      folded.set(key, entry);
      out.push(entry);
    } else {
      out.push({ at: e.at, who: e.who, change: e.change, ...(e.note ? { note: e.note } : {}), n: 1 });
    }
  }
  return out.slice(0, HISTORY_MAX).map(({ n, ...h }) => (n > 1 ? { ...h, change: `${h.change} (${n} times)` } : h));
}

/** The latest real change, or null when nothing is recorded. */
export function changedAt(item: Item, status: StatusRow[], userId: number): Date | null {
  const real = events(item, status, userId).filter((e) => e.real);
  return real.length ? new Date(Math.max(...real.map((e) => e.ms))) : null;
}

const HISTORY_SELECT = { createdAt: true, notes: true, delegationTrail: true, metadata: true, delegateeName: true } as const;
export { HISTORY_SELECT };

/** Accepted status changes for these items of his, oldest first. */
export async function statusRowsFor(clientNumber: string, userId: number, itemIds: string[]): Promise<Map<string, StatusRow[]>> {
  const out = new Map<string, StatusRow[]>();
  if (!itemIds.length) return out;
  const rows = await prisma.$queryRawUnsafe<Array<{ open_item_id: string; at: Date; from_status: string; to_status: string; actor: string | null; reason: string | null }>>(
    `SELECT open_item_id, created_at AS at, from_status, to_status, actor, reason FROM item_status_history
      WHERE client_number = $1 AND user_id = $2 AND open_item_id = ANY($3::text[]) AND outcome = 'accepted'
      ORDER BY created_at`,
    clientNumber, userId, itemIds,
  );
  for (const r of rows) {
    const list = out.get(r.open_item_id) ?? [];
    list.push({ at: r.at, from: r.from_status, to: r.to_status, actor: r.actor, reason: r.reason });
    out.set(r.open_item_id, list);
  }
  return out;
}

export type HistoryAnswer =
  | { ok: true; history: HistoryEntry[]; checked: boolean }
  | { ok: false; error: 'not_found'; detail: string };

export async function taskHistory(clientNumber: string, userId: number, id: string): Promise<HistoryAnswer> {
  const item = id && id.length <= 100
    ? await prisma.openItem.findFirst({ where: { id, clientNumber, userId }, select: HISTORY_SELECT })
    : null;
  if (!item) return { ok: false, error: 'not_found', detail: 'no such task' };
  let checked = true;
  const status = await statusRowsFor(clientNumber, userId, [id]).catch(() => { checked = false; return new Map<string, StatusRow[]>(); });
  return { ok: true, history: historyOf(item as Item, status.get(id) ?? [], userId), checked };
}
