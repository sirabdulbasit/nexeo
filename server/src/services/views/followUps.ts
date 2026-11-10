/**
 * DEF-412 (CL-069, CL-070; founder, 10 Nov: "go with your recommendations"). The follow-ups the morning
 * brief carries, as facts, in place of the separate nudges that used to go out during the day:
 *
 *   overdue          his open tasks past their due date: when due, how late, who has it, the last real change
 *   needsDecision    tasks Nexeo's follow-up flagged for him (no owner, no answer after tries, a blocker)
 *   memoryProposals  how many memory proposals wait for his approval
 *
 * Read from what Nexeo already records, with no model. Only his own items.
 */
import prisma from '../../db/prisma';
import { changedAt, statusRowsFor, HISTORY_SELECT } from '../suzi/taskHistory';

export const OVERDUE_MAX = 10;
export const DECISION_MAX = 5;
const OPEN = ['NEW', 'TRIAGED', 'IN_PROGRESS', 'WAITING_INFO', 'DELEGATED'];

export interface FollowUps {
  overdue: Array<{ id: string; title: string; due: string; daysOverdue: number; withWhom: string; lastChange: string | null }>;
  overdueTotal: number;
  needsDecision: Array<{ id: string; title: string; reason: string | null }>;
  memoryProposalsWaiting: number | null;
}

const dayIn = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const shortDate = (d: Date, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The reason Nexeo's follow-up recorded, in plain words (DEF-413: never its field names). */
export function plainReason(raw: unknown): string | null {
  const t = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!t) return null;
  if (/concerned party has not responded|without a usable response|no response/i.test(t)) return 'no answer after several follow-ups';
  if (/no owner/i.test(t)) return 'nobody owns it';
  return t.slice(0, 160);
}

export async function getFollowUps(args: { clientNumber: string; userId: number; timezone: string; now?: Date }): Promise<FollowUps> {
  const { clientNumber, userId, timezone } = args;
  const now = args.now ?? new Date();
  const today = dayIn(now, timezone);

  const open = await prisma.openItem.findMany({
    where: { clientNumber, userId, status: { in: OPEN }, NOT: { type: 'email' } } as any,
    select: { id: true, title: true, dueDate: true, ...HISTORY_SELECT },
    take: 500,
  });

  const late = open
    .filter((o) => o.dueDate && dayIn(o.dueDate, timezone) < today)
    .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime());
  const shown = late.slice(0, OVERDUE_MAX);
  const status = await statusRowsFor(clientNumber, userId, shown.map((o) => o.id)).catch(() => new Map());

  const overdue = shown.map((o) => {
    const changed = changedAt(o as any, status.get(o.id) ?? [], userId);
    return {
      id: o.id,
      title: String(o.title ?? '').slice(0, 160),
      due: shortDate(o.dueDate!, timezone),
      daysOverdue: daysBetween(dayIn(o.dueDate!, timezone), today),
      withWhom: o.delegateeName || 'you',
      lastChange: changed ? shortDate(changed, timezone) : null,
    };
  });

  const needsDecision = open
    .filter((o) => (o.metadata as any)?.actionLifecycle?.needsUserIntervention === true)
    .slice(0, DECISION_MAX)
    .map((o) => ({ id: o.id, title: String(o.title ?? '').slice(0, 160), reason: plainReason((o.metadata as any)?.actionLifecycle?.interventionReason) }));

  const memoryProposalsWaiting = await prisma.governedBrainMemory.count({
    where: { clientNumber, userId, status: 'pending_approval' } as any,
  }).catch(() => null);

  return { overdue, overdueTotal: late.length, needsDecision, memoryProposalsWaiting };
}
