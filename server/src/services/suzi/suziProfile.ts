/**
 * Link T14 and T11, N4. Nexeo's profile is the record of the assistant's one name (founder, 5 Nov: "both should
 * have same name"), and Nexeo keeps what nudges-off holds back, for when the user asks.
 */
import prisma from '../../db/prisma';

export const DEFAULT_ASSISTANT_NAME = 'Suzi';
const NAME = /^\p{L}[\p{L}\p{M} '-]{0,39}$/u;
const HELD_WINDOW_HOURS = 72;
const MAX_HELD = 20;

export async function getAssistantName(clientNumber: string, userId: number): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string | null }>>(
    `SELECT notification_preferences->>'brainName' AS name FROM users WHERE id = $1 AND client_number = $2`,
    userId, clientNumber,
  );
  const name = rows[0]?.name?.trim();
  // "Brain" is the old default, never a name someone chose.
  return name && name.toLowerCase() !== 'brain' ? name : DEFAULT_ASSISTANT_NAME;
}

/** False when the name isn't one: the caller answers 400 and nothing changes. */
export async function setAssistantName(clientNumber: string, userId: number, raw: unknown): Promise<boolean> {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!NAME.test(name)) return false;
  await prisma.$executeRawUnsafe(
    `UPDATE users SET notification_preferences = jsonb_set(COALESCE(notification_preferences::jsonb, '{}'::jsonb), '{brainName}', to_jsonb($1::text))
      WHERE id = $2 AND client_number = $3`,
    name, userId, clientNumber,
  );
  return true;
}

export interface HeldItem { id: string; kind: string; summary: string; urgency: string; at: string }

/** Urgent items still waiting, or shown only silently. Reading this changes nothing and raises nothing. */
export async function heldItems(clientNumber: string, userId: number): Promise<HeldItem[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; kind: string; summary: string; urgency: string; created_at: Date }>>(
    `SELECT id::text, kind, summary, urgency, created_at FROM suzi_outbox
      WHERE client_number = $1 AND user_id = $2 AND urgency IN ('high', 'emergency')
        AND created_at > now() - interval '${HELD_WINDOW_HOURS} hours'
        AND (state = 'held' OR delivered_how IN ('notice', 'whatsapp', 'email'))
      ORDER BY created_at DESC LIMIT ${MAX_HELD}`,
    clientNumber, userId,
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, summary: r.summary, urgency: r.urgency, at: new Date(r.created_at).toISOString() }));
}
