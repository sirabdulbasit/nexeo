/**
 * Link T22 (both AGREE, 6 Nov 2026; the founder's yes relayed by Suzi's builder): really sending a Suzi email.
 *
 * suziEmail hands a send here only when ALL of these hold:
 *   - Suzi's server verified the device's signature (`signature_verified`, which only Suzi's server can set);
 *   - the user said yes (`confirmed_by_user`) and the voice lock passed (`voice_score` present);
 *   - Nexeo itself can send for him: his Google account is connected (founder, 13 Nov 2026: "Suzi can do all which Nexeo
 *     can do"; the separate per-user switch SEND_SWITCH is retired as the gate and kept only as an emergency OFF list).
 *
 * A send is then HELD for SEND_HOLD_MS. `email.undo` inside the hold cancels it, and the draft stays in Gmail
 * Drafts. Gmail can't unsend, so the hold is the only undo there is. After the hold, the saved Gmail draft
 * itself is sent, so what goes is exactly what was saved. Claiming a hold is one conditional UPDATE
 * (held → sending), so an undo and a release can't both win.
 *
 * A hold found after a restart is sent if it fell due less than LATE_LIMIT_MS ago; an older one stays in
 * Drafts, marked failed, because a send minutes late is not what the user approved.
 */
import prisma from '../../db/prisma';
import { audit } from '../auditLogService';

export const SEND_HOLD_MS = 10_000;
export const LATE_LIMIT_MS = 10 * 60_000;
export const SEND_SWITCH = 'feature_suzi_email_send_users';
const DRAFT_TYPE = 'draft_reply';
const SLACK_MS = 250;

export type SendState = 'held' | 'sending' | 'sent' | 'cancelled' | 'failed';

export const SEND_OFF_SWITCH = 'feature_suzi_email_send_off_users';

/**
 * Founder, 13 Nov 2026: "Suzi can do all which Nexeo can do". Suzi really sends when Nexeo can send for him (his Google
 * account connected), with the signed, confirmed, voiced yes checked by the caller and the undo hold kept. An emergency
 * OFF list (SEND_OFF_SWITCH) can still stop one user.
 */
export async function maySendForReal(clientNumber: string, userId: number): Promise<boolean> {
  const { getFlagValue } = await import('../featureFlagService');
  const off = await getFlagValue(clientNumber, SEND_OFF_SWITCH, '').catch(() => '');
  if (off.split(',').map((x) => x.trim()).filter(Boolean).includes(String(userId))) return false;
  const u = await prisma.user.findFirst({ where: { id: userId, clientNumber } as any, select: { integrationProvider: true, integrationStatus: true } as any }).catch(() => null) as any;
  return u?.integrationProvider === 'google' && u?.integrationStatus === 'active';
}

let schedule: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms); };
/** Tests run the timer by hand. */
export function setSendScheduler(s: (fn: () => void, ms: number) => void): void { schedule = s; }

export function scheduleRelease(id: number, inMs = SEND_HOLD_MS): void {
  schedule(() => {
    releaseHeldSend(id).catch((e) => console.warn(`[suzi-send] release of ${id} failed: ${e?.message ?? e}`));
  }, Math.max(0, inMs) + SLACK_MS);
}

async function finish(id: number, clientNumber: string, userId: number, state: SendState, extra: Record<string, unknown>): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE agent_actions SET output = jsonb_set(output, '{send}', (output->'send') || $2::jsonb), updated_at = now() WHERE id = $1`,
    id, JSON.stringify({ state, ...extra }),
  );
  await audit({
    clientNumber, actorId: userId, actorKind: 'user', action: `suzi.email.${state === 'sent' ? 'sent' : 'send_failed'}`,
    subjectType: 'email', subjectId: String(id), result: state === 'sent' ? 'success' : 'failure', details: extra,
  });
}

/** Sends one held email whose time has come. Anything not held, or not yet due, is left alone. */
export async function releaseHeldSend(id: number, now = new Date()): Promise<'sent' | 'failed' | 'late' | 'skipped'> {
  const rows = await prisma.$queryRawUnsafe<Array<{ client_number: string; user_id: number; gmail_draft_id: string | null; send_at: Date }>>(
    `UPDATE agent_actions SET output = jsonb_set(output, '{send,state}', '"sending"'), updated_at = now()
      WHERE id = $1 AND action_type = '${DRAFT_TYPE}' AND output->'send'->>'state' = 'held'
        AND (output->'send'->>'send_at')::timestamptz <= $2
      RETURNING client_number, user_id, output->>'gmailDraftId' AS gmail_draft_id, (output->'send'->>'send_at')::timestamptz AS send_at,
                input->'delegate'->>'rule_id' AS rule_id, (input->'delegate'->>'by_rule') = 'true' AS by_rule,
                input->'delegate'->>'person_id' AS person_id, lower(input->'delegate'->>'person_email') AS person_email`,
    id, now,
  );
  const r = rows[0] as any;
  if (!r) return 'skipped';
  // F-2.4 review P1: a forward made by a RULE is re-checked at the moment it goes: the rule must still be active and
  // he must still be allowed to send (not on the send-off list). Anything unreadable or changed = not sent (fail closed).
  if (r.by_rule) {
    const still = await prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM user_action_rules WHERE id = $1 AND client_number = $2 AND user_id = $3 AND is_active = TRUE) AS ok`,
      r.rule_id, r.client_number, r.user_id,
    ).catch(() => [{ ok: false }]);
    const mayStill = await maySendForReal(r.client_number, r.user_id).catch(() => false);
    if (!still[0]?.ok || !mayStill) {
      await finish(id, r.client_number, r.user_id, 'cancelled', { cancelled_at: now.toISOString(), error: !still[0]?.ok ? 'the rule was removed or paused before it went' : 'sending is switched off for him', ...(await dropRuleDraft(r.user_id, r.gmail_draft_id)) });
      return 'skipped';
    }
    // F-2.4 proof (b): the rule's person, or that person's email, changed during the hold. This forward is cancelled
    // (its draft stays in Drafts) and marked to be queued again: the next tick forwards the message to the person the
    // rule names now, under a new claim key. Anything unreadable counts as changed (fail closed: nothing goes now).
    const now_ = await currentRulePerson(r.client_number, r.user_id, r.rule_id).catch(() => null);
    if (!now_ || now_.person_id !== r.person_id || now_.email !== r.person_email) {
      await finish(id, r.client_number, r.user_id, 'cancelled', { cancelled_at: now.toISOString(), requeue: true, error: 'the rule\'s person changed before it went; queued again for the person the rule names now', ...(await dropRuleDraft(r.user_id, r.gmail_draft_id)) });
      return 'skipped';
    }
  }
  if (now.getTime() - new Date(r.send_at).getTime() > LATE_LIMIT_MS) {
    await finish(id, r.client_number, r.user_id, 'failed', { failed_at: now.toISOString(), error: 'not sent: the server was down when it was due' });
    return 'late';
  }
  if (!r.gmail_draft_id) {
    await finish(id, r.client_number, r.user_id, 'failed', { failed_at: now.toISOString(), error: 'no saved Gmail draft' });
    return 'failed';
  }
  const { sendGmailDraft } = await import('../gmailService');
  const s = await sendGmailDraft(r.user_id, r.gmail_draft_id);
  if (s.success && r.by_rule) {
    // F-2.4 proof (c): a rule forward stays "sending" until Gmail returns its id AND the message reads back as sent.
    await finish(id, r.client_number, r.user_id, 'sending', { gmail_message_id: s.messageId ?? null, receipt_pending: true });
    return confirmReceipt(id);
  }
  if (s.success) {
    await finish(id, r.client_number, r.user_id, 'sent', { sent_at: new Date().toISOString(), gmail_message_id: s.messageId ?? null });
    // F-2: a note to a person marks the task told; a delegated email gets its task only now.
    const { afterSuziSent } = await import('./suziDelegate');
    await afterSuziSent(id, s.messageId ?? null).catch((e) => console.warn(`[suzi-send] after-send of ${id} failed: ${e?.message ?? e}`));
    return 'sent';
  }
  await finish(id, r.client_number, r.user_id, 'failed', { failed_at: new Date().toISOString(), error: String(s.error ?? 'Gmail did not send it').slice(0, 200) });
  return 'failed';
}

/**
 * Suzi Master, 14 Nov: a rule forward that is cancelled must not leave its draft in his Drafts (he never wrote it).
 * Only for rule forwards; a send he undid keeps its draft, as before. A delete that fails is recorded, not retried.
 */
async function dropRuleDraft(userId: number, gmailDraftId: string | null): Promise<Record<string, unknown>> {
  if (!gmailDraftId) return {};
  const { deleteGmailDraft } = await import('../gmailService');
  const d = await deleteGmailDraft(userId, gmailDraftId).catch((e: any) => ({ success: false, error: String(e?.message ?? e) }));
  return d.success ? { draft_deleted: true } : { draft_deleted: false, draft_delete_error: String((d as any).error ?? '').slice(0, 200) };
}

/** The person a rule names now, with that person's email as on record now (lower-cased). */
async function currentRulePerson(clientNumber: string, userId: number, ruleId: string): Promise<{ person_id: string; email: string } | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ pid: string | null }>>(
    `SELECT action_payload->'suzi'->>'person_id' AS pid FROM user_action_rules WHERE id = $1 AND client_number = $2 AND user_id = $3 AND is_active = TRUE`,
    ruleId, clientNumber, userId,
  );
  const pid = rows[0]?.pid;
  if (!pid) return null;
  const { personById } = await import('./suziPeople');
  const p = await personById(clientNumber, userId, pid);
  return p?.email ? { person_id: p.id, email: p.email.toLowerCase() } : null;
}

export const RECEIPT_RETRY_MS = [15_000, 60_000, 5 * 60_000];

/**
 * F-2.4 proof (c): read a rule forward back from Gmail. SENT label = delivered: the state becomes 'sent' (the pack's
 * "delivered") and only then is the person's task made. Not in Gmail = failed. Unreadable = still 'sending', read
 * again later (RECEIPT_RETRY_MS); after the last try it stays 'sending' and is never called delivered.
 */
export async function confirmReceipt(id: number, attempt = 0): Promise<'sent' | 'failed' | 'skipped'> {
  const rows = await prisma.$queryRawUnsafe<Array<{ client_number: string; user_id: number; mid: string | null }>>(
    `SELECT client_number, user_id, output->'send'->>'gmail_message_id' AS mid FROM agent_actions
      WHERE id = $1 AND output->'send'->>'state' = 'sending' AND (output->'send'->>'receipt_pending') = 'true'`,
    id,
  );
  const r = rows[0];
  if (!r) return 'skipped';
  if (!r.mid) {
    await finish(id, r.client_number, r.user_id, 'failed', { failed_at: new Date().toISOString(), receipt_pending: false, error: 'Gmail returned no message id' });
    return 'failed';
  }
  const { sentReceipt } = await import('../gmailService');
  const got = await sentReceipt(r.user_id, r.mid).catch(() => 'unknown' as const);
  if (got === 'sent') {
    await finish(id, r.client_number, r.user_id, 'sent', { sent_at: new Date().toISOString(), delivered_at: new Date().toISOString(), receipt_pending: false });
    const { afterSuziSent } = await import('./suziDelegate');
    await afterSuziSent(id, r.mid).catch((e) => console.warn(`[suzi-send] after-send of ${id} failed: ${e?.message ?? e}`));
    return 'sent';
  }
  if (got === 'not_sent') {
    await finish(id, r.client_number, r.user_id, 'failed', { failed_at: new Date().toISOString(), receipt_pending: false, error: 'Gmail does not list it as sent' });
    return 'failed';
  }
  if (attempt < RECEIPT_RETRY_MS.length) schedule(() => { confirmReceipt(id, attempt + 1).catch(() => undefined); }, RECEIPT_RETRY_MS[attempt]);
  return 'skipped';
}

/** At boot: every hold still waiting gets its timer back (a due one at once). */
export async function resumeHeldSends(now = new Date()): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: number; send_at: Date }>>(
    `SELECT id, (output->'send'->>'send_at')::timestamptz AS send_at FROM agent_actions
      WHERE action_type = '${DRAFT_TYPE}' AND output->'send'->>'state' = 'held'`,
  );
  for (const r of rows) scheduleRelease(r.id, new Date(r.send_at).getTime() - now.getTime());
  // F-2.4 proof (c) across a restart: a rule forward Gmail took but not yet read back is read back again.
  const pending = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
    `SELECT id FROM agent_actions WHERE action_type = '${DRAFT_TYPE}' AND output->'send'->>'state' = 'sending' AND (output->'send'->>'receipt_pending') = 'true'`,
  ).catch(() => [] as Array<{ id: number }>);
  for (const p of pending) schedule(() => { confirmReceipt(p.id).catch(() => undefined); }, 0);
  return rows.length;
}
