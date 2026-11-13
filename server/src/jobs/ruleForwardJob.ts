/**
 * F-2.4 auto-forward (founder 13 Nov 2026, in Suzi Master's session: "Yes, forward automatically" and, with the rules
 * below put to him in full, "Yes, as described"; Suzi Master AGREE C1–C4; Functional Charter sha dec95d27). His
 * email_delegate rules forward matching emails by themselves. Every 5 minutes, for each user, Nexeo's send rules (C3):
 *   1. Nexeo can send for him (Google connected) and he is not on the emergency OFF list (maySendForReal).
 *   2. Only an email addressed TO him (not Cc/Bcc-only), not from himself, matching the rule; never a thread he has
 *      already replied to; one forward per message (deduped on the message id).
 *   3. The recipient is the rule's person, email on record, on his company's own domain (external refused).
 *   4. Outside his office hours nothing goes; it waits for the next tick inside them.
 *   5. At most 20 rule forwards per user per day; the rest wait for the next day.
 *   6. Attachments go with the forward, as a normal Gmail forward does.
 *   7. A task is made for the person when the forward has gone (afterSuziSent), noted as sent by his rule.
 * The forward runs through the same path as email.delegate (forwardEmail → send hold → release → task); C1/C2: the
 * pack shows it as by_rule {action: "delegated", rule_id, person_name, task_id, at}; rule.remove stops further ones.
 */
import prisma from '../db/prisma';
import createLogger from '../utils/logger';

const log = createLogger('rule-forward');
export const RULE_FORWARD_EVERY_MS = 5 * 60_000;
export const RULE_FORWARD_DAY_CAP = 20;
const LOOKBACK_MS = 24 * 60 * 60_000;

const addr = (v: unknown) => (String(v ?? '').match(/<([^>]+)>/)?.[1] ?? String(v ?? '')).trim().toLowerCase();
const domainOf = (e: string) => e.split('@')[1] ?? '';
const listHas = (raw: unknown, emails: Set<string>) => { const r = String(raw ?? '').toLowerCase(); return [...emails].some((e) => r.includes(e)); };

export interface Candidate { feedId: string; messageId: string; threadId: string; from: string; to: string; cc: string; subject: string; repliedThread: boolean }

/** C3.2: which candidate emails may be forwarded at all (before the rule match). */
export function eligible(c: Candidate, own: Set<string>): boolean {
  if (!listHas(c.to, own)) return false;           // addressed TO him, not Cc/Bcc-only
  if (own.has(addr(c.from))) return false;         // never his own mail
  if (c.repliedThread) return false;               // never a thread he already answered
  return true;
}

export async function runRuleForward(now = new Date()): Promise<{ users: number; forwarded: number; skipped: Record<string, number> }> {
  const { suziEmailRules, ruleFor } = await import('../services/suzi/suziEmailRules');
  const { maySendForReal } = await import('../services/suzi/suziSend');
  const { outsideOfficeHoursFor } = await import('../services/notifications/brainOutboundService');
  const { personById } = await import('../services/suzi/suziPeople');
  const { emailDelegate } = await import('../services/suzi/suziDelegate');
  const users = await prisma.user.findMany({ where: { isActive: true, integrationProvider: 'google', integrationStatus: 'active' }, select: { id: true, clientNumber: true, email: true, integrationEmail: true } as any }) as any[];
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  let forwarded = 0;
  for (const u of users) {
    try {
      const rules = (await suziEmailRules(u.clientNumber, u.id)).filter((r) => r.kind === 'email_delegate');
      if (!rules.length) continue;
      if (!(await maySendForReal(u.clientNumber, u.id))) { skip('cannot_send'); continue; }      // C3.1
      if (await outsideOfficeHoursFor(u.id, u.clientNumber)) { skip('outside_office_hours'); continue; } // C3.4
      const own = new Set<string>([u.email, u.integrationEmail].filter(Boolean).map((e: string) => e.toLowerCase()));
      const ownDomains = new Set([...own].map(domainOf).filter(Boolean));
      const sentToday = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM agent_actions WHERE client_number = $1 AND user_id = $2 AND action_type = 'draft_reply'
            AND input->'delegate'->>'by_rule' = 'true' AND created_at >= date_trunc('day', now())`, u.clientNumber, u.id,
      ).catch(() => [{ n: 0 }]);
      let budget = RULE_FORWARD_DAY_CAP - Number(sentToday[0]?.n ?? 0);                           // C3.5
      if (budget <= 0) { skip('day_cap'); continue; }
      const rows = await prisma.$queryRawUnsafe<Array<{ id: string; source_id: string; p: any }>>(
        `SELECT f.id, f.source_id, f.raw_payload AS p FROM feed_events f
          WHERE f.client_number = $1 AND f.user_id = $2 AND f.source_type = 'gmail' AND f.created_at >= $3
            AND NOT EXISTS (SELECT 1 FROM agent_actions a WHERE a.client_number = $1 AND a.user_id = $2
                             AND a.input->'delegate'->>'message_id' = f.source_id)
          ORDER BY f.created_at ASC LIMIT 200`,
        u.clientNumber, u.id, new Date(now.getTime() - LOOKBACK_MS),
      );
      for (const r of rows) {
        if (budget <= 0) break;
        const c: Candidate = { feedId: r.id, messageId: r.source_id, threadId: String(r.p?.threadId ?? r.source_id), from: r.p?.from ?? '', to: r.p?.to ?? '', cc: r.p?.cc ?? '', subject: r.p?.subject ?? '', repliedThread: r.p?.userRepliedThread === true };
        const rule = ruleFor(rules, { from: c.from, subject: c.subject });
        if (!rule) continue;
        if (!eligible(c, own)) { skip('not_eligible'); continue; }                                   // C3.2
        const person = rule.person_id ? await personById(u.clientNumber, u.id, rule.person_id) : null;
        if (!person?.email || !ownDomains.has(domainOf(person.email.toLowerCase()))) { skip('recipient_not_internal'); continue; } // C3.3
        const out: any = await emailDelegate(u.clientNumber, u.id, { email_id: c.threadId, rule_id: rule.id, person_id: person.id, message_id: c.messageId, note: 'Forwarded by your rule.' }, true,
          { signatureVerified: false, voiceScore: null, byRule: rule.id });
        if (out?.ok && out.item?.state === 'held') { forwarded += 1; budget -= 1; log.info('rule forward held', { userId: u.id, rule: rule.id, message: c.messageId, to: person.name }); }
        else skip(out?.error ?? 'not_sent');
      }
    } catch (e: any) {
      log.warn('rule forward failed for user', { userId: u.id, error: String(e?.message ?? e).slice(0, 160) });
    }
  }
  return { users: users.length, forwarded, skipped };
}

export function scheduleRuleForward(): void {
  const tick = (): void => {
    void import('./jobRunner')
      .then(({ protectedTick }) => protectedTick('rule_forward', 'important', () => runRuleForward()))
      .catch((e: any) => log.warn('rule forward tick could not run protected', { error: e?.message?.slice(0, 160) }));
  };
  setTimeout(() => { tick(); setInterval(tick, RULE_FORWARD_EVERY_MS); }, 6 * 60_000);
  log.info('rule forward scheduled', { everyMs: RULE_FORWARD_EVERY_MS });
}
