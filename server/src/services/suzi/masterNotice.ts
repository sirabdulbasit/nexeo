/**
 * Link T30 (Master_Charter.md §4B, `POST /master/notice`, G2). Suzi Master tells a user something through
 * Nexeo, by device; Suzi's server has already mapped the device to its user. Text only, never code.
 *
 *   urgent: false  a line for his next morning brief (D3: "fixed for everyone: <note>, version V").
 *                  Kept in Nexeo's own message log, kind `suzi_master_line`, status `for_brief`.
 *   urgent: true   told now, once, through Nexeo's normal reach at high urgency (a release stopped by
 *                  the automatic halt). It is never folded into the brief.
 */
import prisma from '../../db/prisma';

export const MASTER_LINE_KIND = 'suzi_master_line';
export const MASTER_ALERT_KIND = 'suzi_master_alert';
export const MASTER_TEXT_MAX = 500;

export async function masterNotice(i: { userId: number; clientNumber: string; text: string; urgent: boolean }): Promise<{ ok: true; told: 'now' | 'brief'; sent?: boolean }> {
  const text = i.text.replace(/\s+/g, ' ').trim().slice(0, MASTER_TEXT_MAX);
  if (!text) throw new Error('empty text');
  if (i.urgent) {
    const { brainContactsUser } = await import('../notifications/brainOutboundService');
    const r = await brainContactsUser({
      userId: i.userId, clientNumber: i.clientNumber, kind: MASTER_ALERT_KIND, urgency: 'high',
      summary: `Suzi update: ${text.slice(0, 80)}`, body: text,
      metadata: { source: 'suzi_master' },
    });
    return { ok: true, told: 'now', sent: r.sent };
  }
  await prisma.brainUserMessage.create({
    data: {
      clientNumber: i.clientNumber, userId: i.userId, kind: MASTER_LINE_KIND, channel: 'brief',
      urgency: 'low', summary: text, status: 'for_brief', metadata: { source: 'suzi_master' },
    },
  });
  return { ok: true, told: 'brief' };
}

/** The brief's lines from Suzi Master in the last day, oldest first. */
export async function masterLinesForBrief(clientNumber: string, userId: number, now = new Date()): Promise<string[]> {
  const rows = await prisma.brainUserMessage.findMany({
    where: { clientNumber, userId, kind: MASTER_LINE_KIND, status: 'for_brief', createdAt: { gte: new Date(now.getTime() - 24 * 3_600_000) } },
    select: { summary: true },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });
  return rows.map((r) => r.summary);
}
