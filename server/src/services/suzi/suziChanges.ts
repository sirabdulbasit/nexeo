/**
 * Link T12, P6: GET …/changes?since=<cursor> says which parts of the day pack changed, with no content. The desktop's
 * 15-minute tick asks here first and fetches the pack only if something did; unlock and a daily fetch stay whole, so a
 * miss here costs a delay, never data. `wiki` joins the list when wiki slices are in the pack: pages change all day,
 * so reporting it now would make every tick fetch.
 */
import prisma from '../../db/prisma';
import { rulesDocument } from './suziRules';

const MAX_CURSOR_AGE_MS = 7 * 24 * 60 * 60_000;
const EMAIL_SOURCES = "('gmail', 'outlook', 'imap_smtp')";
const CALENDAR_SOURCES = "('gcal', 'google_calendar', 'outlook_calendar')";

export type ChangeType = 'actions' | 'calendar' | 'emails' | 'rules' | 'people';
export type ChangesAnswer = { cursor: string; full: true } | { cursor: string; changed: ChangeType[] };

export async function changesSince(clientNumber: string, userId: number, since: unknown, now = new Date()): Promise<ChangesAnswer> {
  const cursor = now.toISOString();
  const from = new Date(typeof since === 'string' ? since : NaN);
  const age = now.getTime() - from.getTime();
  // A cursor it can't trust gets everything, not nothing.
  if (isNaN(age) || age < 0 || age > MAX_CURSOR_AGE_MS) return { cursor, full: true };

  // Reading the rules is what moves their number when they've changed.
  await rulesDocument(clientNumber, userId).catch(() => null);
  const rows = await prisma.$queryRawUnsafe<Array<Record<ChangeType, boolean>>>(
    `SELECT
       EXISTS (SELECT 1 FROM open_items WHERE client_number = $1 AND user_id = $2 AND updated_at > $3) AS actions,
       EXISTS (SELECT 1 FROM feed_events WHERE client_number = $1 AND user_id = $2 AND source_type IN ${CALENDAR_SOURCES} AND created_at > $3) AS calendar,
       (EXISTS (SELECT 1 FROM feed_events WHERE client_number = $1 AND user_id = $2 AND source_type IN ${EMAIL_SOURCES} AND created_at > $3)
        OR EXISTS (SELECT 1 FROM decision_logs WHERE client_number = $1 AND user_id = $2 AND created_at > $3)) AS emails,
       EXISTS (SELECT 1 FROM suzi_rules_version WHERE client_number = $1 AND user_id = $2 AND updated_at > $3) AS rules,
       EXISTS (SELECT 1 FROM persons WHERE client_number = $1 AND user_id = $2 AND updated_at > $3) AS people`,
    clientNumber, userId, from,
  );
  const row = rows[0];
  return { cursor, changed: (['actions', 'calendar', 'emails', 'rules', 'people'] as ChangeType[]).filter((t) => row?.[t]) };
}
