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
import { externalUsersForCycle } from '../services/wiki/knowledgeModel';
import createLogger from '../utils/logger';

const log = createLogger('rule-forward');
/** ON since 16 Nov 2026: the founder's "go ahead" in Nexeo-Builder, after the review's P1 fixes and proofs (D-261..D-263).
 *  One switch for job, auto:true and the pack. At switch-on he had no email_delegate rule, so nothing forwards until he sets one. */
export const RULE_FORWARD_ENABLED = true;
export const RULE_FORWARD_EVERY_MS = 5 * 60_000;
export const RULE_FORWARD_DAY_CAP = 20;
// Review P1: a held or capped email must not age out: a 7-day window, and only email newer than the rule itself.
const LOOKBACK_MS = 7 * 24 * 60 * 60_000;

const addr = (v: unknown) => (String(v ?? '').match(/<([^>]+)>/)?.[1] ?? String(v ?? '')).trim().toLowerCase();
const domainOf = (e: string) => e.split('@')[1] ?? '';
/** Review P1: every mailbox in an address list, parsed and normalised (never a substring match). */
export function mailboxes(raw: unknown): Set<string> {
  const out = new Set<string>();
  for (const m of String(raw ?? '').matchAll(/<\s*([^<>\s@]+@[^<>\s@]+)\s*>|([^\s,;<>"']+@[^\s,;<>"']+)/g)) out.add((m[1] ?? m[2]).toLowerCase().replace(/[.,;]+$/, ''));
  return out;
}
const listHas = (raw: unknown, emails: Set<string>) => { const box = mailboxes(raw); return [...emails].some((e) => box.has(e)); };
/** Review P1: shared mail providers are never "his company's domain". */
export const PUBLIC_PROVIDERS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'yandex.com', 'zoho.com']);
/** His company's own domains: the domains of the client's own users, minus shared providers. */
export async function companyDomains(clientNumber: string): Promise<Set<string>> {
  const rows = await prisma.user.findMany({ where: { clientNumber, isActive: true } as any, select: { email: true, integrationEmail: true } as any }) as any[];
  const out = new Set<string>();
  for (const u of rows) for (const e of [u.email, u.integrationEmail]) { const d = domainOf(String(e ?? '').toLowerCase()); if (d && !PUBLIC_PROVIDERS.has(d)) out.add(d); }
  return out;
}

export interface Candidate { feedId: string; messageId: string; threadId: string; from: string; to: string; cc: string; subject: string; repliedThread: boolean }

/** C3.2: which candidate emails may be forwarded at all (before the rule match). */
export function eligible(c: Candidate, own: Set<string>): boolean {
  if (!listHas(c.to, own)) return false;           // addressed TO him, not Cc/Bcc-only
  if (own.has(addr(c.from))) return false;         // never his own mail
  if (c.repliedThread) return false;               // never a thread he already answered
  return true;
}

/**
 * Suzi Master, 14 Nov (the known limit of proof a): a claim that never reached a hold (a crash or a stall between the
 * claim and the hold: no send state after STALE_CLAIM_MS) gives its key up and is queued again, so the message is
 * forwarded once rather than never. A draft it already recorded is deleted. A stalled tick that wakes later is fenced
 * (suziEmail.saveToGmailDrafts holds only under a live key; suziSend.releaseHeldSend re-checks it). Never throws.
 */
export const STALE_CLAIM_MS = 10 * 60_000;
export async function voidStaleClaims(clientNumber: string, userId: number): Promise<number> {
  const voided = await Promise.resolve().then(() => prisma.$queryRawUnsafe<Array<{ d: string | null }>>(
    `UPDATE agent_actions SET idempotency_key = idempotency_key || ':void:' || id::text,
            output = jsonb_set(COALESCE(output, '{}'::jsonb), '{send}', COALESCE(output->'send', '{}'::jsonb) || '{"state":"cancelled","requeue":true,"error":"the forward did not reach Gmail; queued again"}'::jsonb),
            updated_at = now()
      WHERE client_number = $1 AND user_id = $2 AND action_type = 'draft_reply' AND idempotency_key LIKE 'rule_fwd:%'
        AND idempotency_key NOT LIKE '%:void:%' AND output->'send'->>'state' IS NULL AND created_at < now() - ($3::int * interval '1 millisecond')
      RETURNING output->>'gmailDraftId' AS d`,
    clientNumber, userId, STALE_CLAIM_MS,
  )).catch(() => [] as Array<{ d: string | null }>);
  if (voided.some((v) => v.d)) {
    const { deleteGmailDraft } = await import('../services/gmailService');
    for (const v of voided) if (v.d) await deleteGmailDraft(userId, v.d).catch(() => undefined);
  }
  return voided.length;
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
  const external = await externalUsersForCycle('ruleForward');
  if (!external) return { users: 0, forwarded: 0, skipped };
  for (const u of users) {
    if (external.has(u.id)) { skip('external_knowledge'); continue; } // Client Owned Data: Nexeo runs nothing for him
    try {
      await bounceSweep(u.clientNumber, u.id).catch((e: any) => log.warn('bounce check failed', { userId: u.id, error: String(e?.message ?? e).slice(0, 160) }));
      const rules = (await suziEmailRules(u.clientNumber, u.id)).filter((r) => r.kind === 'email_delegate');
      if (!rules.length) continue;
      if (!(await maySendForReal(u.clientNumber, u.id))) { skip('cannot_send'); continue; }      // C3.1
      if (await outsideOfficeHoursFor(u.id, u.clientNumber)) { skip('outside_office_hours'); continue; } // C3.4
      const own = new Set<string>([u.email, u.integrationEmail].filter(Boolean).map((e: string) => e.toLowerCase()));
      const ownDomains = await companyDomains(u.clientNumber);                                    // review P1: authoritative, no shared provider
      if (ownDomains.size === 0) { skip('no_company_domain'); continue; }
      // Review P1: his own day (his time zone), and a count that cannot be read holds forwarding (fail closed).
      const { resolveUserTimezone } = await import('../services/userTimezoneService');
      const tz = await resolveUserTimezone(u.id).catch(() => null);
      if (!tz) { skip('timezone_unreadable'); continue; }
      const sentToday = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM agent_actions WHERE client_number = $1 AND user_id = $2 AND action_type = 'draft_reply'
            AND input->'delegate'->>'by_rule' = 'true' AND idempotency_key LIKE 'rule_fwd:%' AND idempotency_key NOT LIKE '%:void:%'
            AND created_at >= (date_trunc('day', now() AT TIME ZONE $3) AT TIME ZONE $3)`, u.clientNumber, u.id, tz,
      ).catch(() => null);
      if (!sentToday) { skip('count_unreadable'); continue; }
      let budget = RULE_FORWARD_DAY_CAP - Number(sentToday[0]?.n ?? 0);                           // C3.5
      if (budget <= 0) { skip('day_cap'); continue; }
      const born = await prisma.$queryRawUnsafe<Array<{ id: string; created_at: Date }>>(
        `SELECT id, created_at FROM user_action_rules WHERE client_number = $1 AND user_id = $2 AND id = ANY($3::text[])`, u.clientNumber, u.id, rules.map((x) => x.id),
      ).catch(() => null);
      if (!born) { skip('rules_unreadable'); continue; }
      const ruleBorn = new Map(born.map((b) => [b.id, new Date(b.created_at).getTime()]));
      await voidStaleClaims(u.clientNumber, u.id);
      const rows = await prisma.$queryRawUnsafe<Array<{ id: string; source_id: string; p: any; created_at: Date }>>(
        `SELECT f.id, f.source_id, f.raw_payload AS p, f.created_at FROM feed_events f
          WHERE f.client_number = $1 AND f.user_id = $2 AND f.source_type = 'gmail' AND f.created_at >= $3
            AND NOT EXISTS (SELECT 1 FROM agent_actions a WHERE a.client_number = $1 AND a.user_id = $2
                             AND a.input->'delegate'->>'message_id' = f.source_id
                             -- proof (b): a forward cancelled because the rule's person changed is queued again
                             AND COALESCE(a.output->'send'->>'requeue', '') <> 'true')
          ORDER BY f.created_at ASC LIMIT 200`,
        u.clientNumber, u.id, new Date(now.getTime() - LOOKBACK_MS),
      );
      for (const r of rows) {
        if (budget <= 0) break;
        const c: Candidate = { feedId: r.id, messageId: r.source_id, threadId: String(r.p?.threadId ?? r.source_id), from: r.p?.from ?? '', to: r.p?.to ?? '', cc: r.p?.cc ?? '', subject: r.p?.subject ?? '', repliedThread: r.p?.userRepliedThread === true };
        const rule = ruleFor(rules, { from: c.from, subject: c.subject });
        if (!rule) continue;
        if (ruleBorn.get(rule.id) && r.created_at && new Date(r.created_at).getTime() < ruleBorn.get(rule.id)!) continue; // older than the rule
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

/**
 * DEF-491 (Suzi Master AGREE 16 Nov, (b)): a rule forward that bounces. For 30 minutes after it was sent, each tick
 * looks for a bounce notice carrying its Message-ID; one found → state "bounced" (the pack and Suzi say so) and the
 * person's task is cancelled, since they never got it. Gmail unreadable → asked again next tick.
 */
export const BOUNCE_WINDOW_MS = 30 * 60_000;
export async function bounceSweep(clientNumber: string, userId: number, now = new Date(),
  deps: { bounceFor?: (u: number, m: string, s: Date) => Promise<'bounced' | 'none' | 'unknown'> } = {}): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: number; mid: string | null; sent_at: string | null; task_id: string | null }>>(
    `SELECT id, output->'send'->>'gmail_message_id' AS mid, output->'send'->>'sent_at' AS sent_at, output->'send'->>'task_id' AS task_id
       FROM agent_actions WHERE client_number = $1 AND user_id = $2 AND action_type = 'draft_reply'
        AND input->'delegate'->>'by_rule' = 'true' AND output->'send'->>'state' = 'sent'
        AND (output->'send'->>'sent_at')::timestamptz > $3`,
    clientNumber, userId, new Date(now.getTime() - BOUNCE_WINDOW_MS),
  );
  const check = deps.bounceFor ?? (async (u: number, m: string, s: Date) => (await import('../services/gmailService')).bounceFor(u, m, s));
  let n = 0;
  for (const r of rows) {
    if (!r.mid || !r.sent_at) continue;
    if ((await check(userId, r.mid, new Date(r.sent_at))) !== 'bounced') continue;
    const won = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `UPDATE agent_actions SET output = jsonb_set(output, '{send}', (output->'send') || $2::jsonb), updated_at = now()
        WHERE id = $1 AND output->'send'->>'state' = 'sent' RETURNING id`,
      r.id, JSON.stringify({ state: 'bounced', bounced_at: now.toISOString() }),
    );
    if (!won.length) continue;
    n += 1;
    log.info('rule forward bounced', { userId, action: r.id });
    if (r.task_id) {
      const { changeStatus } = await import('../services/openItemsService');
      await changeStatus(r.task_id, clientNumber, 'CANCELLED' as any, 'The forward bounced back: they never got it', `user:${userId}`).catch(() => undefined);
    }
  }
  return n;
}

export function scheduleRuleForward(): void {
  if (!RULE_FORWARD_ENABLED) { log.info('rule forward is switched off (P1 review fixes pending)'); return; }
  const tick = (): void => {
    void import('./jobRunner')
      .then(({ protectedTick }) => protectedTick('rule_forward', 'important', () => runRuleForward()))
      .catch((e: any) => log.warn('rule forward tick could not run protected', { error: e?.message?.slice(0, 160) }));
  };
  setTimeout(() => { tick(); setInterval(tick, RULE_FORWARD_EVERY_MS); }, 6 * 60_000);
  log.info('rule forward scheduled', { everyMs: RULE_FORWARD_EVERY_MS });
}
