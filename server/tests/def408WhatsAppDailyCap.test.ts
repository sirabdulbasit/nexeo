/**
 * DEF-408 (`counter-without-reset`, CL-068) and DEF-409. Pinned:
 *  1. the daily cap re-opens by itself on a new day (PKT), with no job to schedule: a capped count from
 *     yesterday lets today's first send through and starts again at 1;
 *  2. on the same day the cap still holds;
 *  3. a failed claim query is "WhatsApp send check failed", never "Daily message limit reached";
 *  4. both send paths (text and voice note) use the one claim;
 *  5. the fallback email shows WhatsApp emphasis as formatting, escapes everything else.
 * (3)-(5) run everywhere; (1)-(2) run the real SQL on a throwaway Postgres when SCRATCH_PG_URL is set:
 *   docker run -d --rm --name pg-scratch -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:55433:5432 postgres:16-alpine
 *   SCRATCH_PG_URL=postgresql://postgres@127.0.0.1:55433/postgres npx vitest run tests/def408WhatsAppDailyCap.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const URL = process.env.SCRATCH_PG_URL;
const holder: { client: any; fail: boolean } = { client: null, fail: false };
vi.mock('../src/db/prisma', () => ({
  default: new Proxy({}, {
    get: (_t, k) => (k === '$queryRawUnsafe' && holder.fail ? async () => { throw new Error('db down'); } : holder.client?.[k]),
  }),
}));

import { claimSendSlot, CLAIM_SLOT_SQL } from '../src/services/whatsapp/WhatsAppManager';
import { whatsAppToEmailHtml } from '../src/services/notifications/brainOutboundService';

describe('a database fault is not the cap', () => {
  it('a failed claim query says the check failed', async () => {
    holder.fail = true;
    expect(await claimSendSlot('T')).toEqual({ ok: false, error: 'WhatsApp send check failed' });
    holder.fail = false;
  });
  it('both send paths use the one claim, and nothing claims the old way', () => {
    const src = readFileSync(path.join(__dirname, '../src/services/whatsapp/WhatsAppManager.ts'), 'utf8');
    expect(src.match(/await claimSendSlot\(params\.clientNumber\)/g)?.length).toBe(2);
    expect(src).not.toMatch(/SET messages_today\s+= messages_today \+ 1/);
  });
  it('the day rolls over inside the claim, in PKT', () => {
    expect(CLAIM_SLOT_SQL).toContain("AT TIME ZONE 'Asia/Karachi'");
    expect(CLAIM_SLOT_SQL).toMatch(/THEN 1 ELSE messages_today \+ 1/);
  });
});

describe('the fallback email reads like an email', () => {
  it('WhatsApp emphasis becomes formatting', () => {
    expect(whatsAppToEmailHtml("*Today's calendar*\nYou have _no_ meetings, ~one~ moved.")).toBe(
      "<strong>Today&#39;s calendar</strong>\nYou have <em>no</em> meetings, <s>one</s> moved.".replace('&#39;', whatsAppToEmailHtml("'")),
    );
  });
  it('everything else stays escaped, and words with underscores or stars inside are left alone', () => {
    const out = whatsAppToEmailHtml('<script>x</script> my_file_name 2*3*4 a@b_c.com');
    expect(out).not.toContain('<script>');
    expect(out).toContain('my_file_name');
    expect(out).toContain('2*3*4');
    expect(out).not.toContain('<em>');
    expect(out).not.toContain('<strong>');
  });
});

describe.skipIf(!URL)('the claim SQL on a scratch Postgres', () => {
  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    holder.client = new PrismaClient({ datasources: { db: { url: URL! } } });
    await holder.client.$executeRawUnsafe(`DROP TABLE IF EXISTS whatsapp_config`);
    await holder.client.$executeRawUnsafe(`CREATE TABLE whatsapp_config (client_number TEXT PRIMARY KEY, last_message_at TIMESTAMPTZ,
      daily_limit INTEGER NOT NULL DEFAULT 100, monthly_limit INTEGER NOT NULL DEFAULT 2000, messages_today INTEGER NOT NULL DEFAULT 0,
      messages_this_month INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  });
  afterAll(async () => { await holder.client?.$disconnect(); });
  const row = async () => (await holder.client.$queryRawUnsafe(`SELECT messages_today AS d, messages_this_month AS m FROM whatsapp_config WHERE client_number = 'T'`))[0];

  it('yesterday at the cap: today\'s first send goes and the count starts at 1', async () => {
    await holder.client.$executeRawUnsafe(`INSERT INTO whatsapp_config (client_number, last_message_at, daily_limit, messages_today, messages_this_month)
      VALUES ('T', NOW() - interval '1 day', 3, 3, 50)`);
    expect(await claimSendSlot('T')).toEqual({ ok: true });
    expect(await row()).toMatchObject({ d: 1 });
  });
  it('the same day: the cap holds', async () => {
    expect(await claimSendSlot('T')).toEqual({ ok: true });
    expect(await claimSendSlot('T')).toEqual({ ok: true });
    expect(await claimSendSlot('T')).toEqual({ ok: false, error: 'Daily message limit reached' });
    expect(await row()).toMatchObject({ d: 3 });
  });
  it('a first-ever send (no last_message_at) goes; a new month restarts the monthly count', async () => {
    await holder.client.$executeRawUnsafe(`INSERT INTO whatsapp_config (client_number, daily_limit) VALUES ('N', 3)`);
    expect(await claimSendSlot('N')).toEqual({ ok: true });
    await holder.client.$executeRawUnsafe(`UPDATE whatsapp_config SET last_message_at = NOW() - interval '40 days', messages_this_month = 999 WHERE client_number = 'T'`);
    expect(await claimSendSlot('T')).toEqual({ ok: true });
    expect(await row()).toMatchObject({ d: 1, m: 1 });
  });
});
