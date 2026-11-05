/**
 * Owner rulings, 4 Nov 2026: WhatsApp only connects the user with Nexeo or Suzi. Pinned:
 *  1. others are off by default: nothing in production has to remember a setting;
 *  2. a message from an unregistered number reaches neither delegation capture nor triage, and no
 *     words are logged; the sender's number is still kept (owner ruling 2026-09-02);
 *  3. the user's other chats stop after their own dictation and before the feed;
 *  4. only a registered user may be sent WhatsApp, and a failed lookup means no;
 *  5. every path that can reach another person goes through that check, and no new one can appear
 *     without being listed here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';

const capture = vi.fn(); const triage = vi.fn(); const remember = vi.fn(); const resolve = vi.fn(); const logged: any[] = [];
vi.mock('../src/services/delegation/delegationCaptureService', () => ({ captureDelegationReply: (...a: any[]) => capture(...a) }));
vi.mock('../src/services/whatsapp/senderTriage', () => ({ triageUnregisteredInbound: (...a: any[]) => triage(...a), rememberSender: (...a: any[]) => remember(...a) }));
vi.mock('../src/utils/logger', () => ({ default: () => ({ info: (...a: any[]) => logged.push(a), warn: (...a: any[]) => logged.push(a), error: (...a: any[]) => logged.push(a), debug: () => {} }) }));
vi.mock('../src/services/whatsapp/inboundIdentity', () => ({ resolveRegisteredWhatsAppUser: (...a: any[]) => resolve(...a) }));
vi.mock('../src/db/prisma', () => {
  const model = new Proxy({}, { get: () => async () => null });
  const p: any = new Proxy({ $queryRaw: async () => [], $queryRawUnsafe: async () => [], $executeRaw: async () => 0, $executeRawUnsafe: async () => 0 }, { get: (t: any, k: string) => (k in t ? t[k] : model) });
  return { __esModule: true, default: p, prisma: p };
});

import { mayWhatsApp, whatsappWithOthers } from '../src/services/whatsapp/othersPolicy';

describe('messages from others', () => {
  const saved = process.env.WHATSAPP_WITH_OTHERS;
  beforeEach(() => { delete process.env.WHATSAPP_WITH_OTHERS; resolve.mockReset(); resolve.mockResolvedValue(null); capture.mockReset(); triage.mockReset(); remember.mockReset(); logged.length = 0; });
  afterEach(() => { process.env.WHATSAPP_WITH_OTHERS = saved; });

  it('are not read by default', () => {
    expect(whatsappWithOthers()).toBe(false);
  });

  it('an unregistered sender reaches neither capture nor triage; the number is kept; no words are logged', async () => {
    const { handleInboundMessage } = await import('../src/services/whatsapp/WhatsAppInbound');
    await handleInboundMessage({ clientNumber: 'T', fromNumber: '+923001112222', messageBody: 'secret words here', waMessageId: 'w1', _resolvedIdentity: null } as any);
    await new Promise((r) => setTimeout(r, 20));
    expect(capture).not.toHaveBeenCalled();
    expect(triage).not.toHaveBeenCalled();
    expect(remember).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logged)).not.toContain('secret words');
    expect(JSON.stringify(logged)).toContain('not read');
  });

  it('the personal-number link is gone: one registered number per client (owner, 5 Nov)', () => {
    expect(existsSync('src/services/whatsapp/UserWebjsProvider.ts')).toBe(false);
  });

  it('a non-user\'s voice note or image is never opened: the check comes before any download, on both paths', () => {
    for (const [f, gate, media] of [
      ['src/services/whatsapp/WebjsProvider.ts', 'resolvedIdentity === null && !whatsappWithOthers()', 'downloadInboundMedia('],
      ['src/routes/webhookRoutes.ts', 'resolvedIdentity === null && !whatsappWithOthers()', 'downloadMetaMedia('],
    ]) {
      const src = readFileSync(f, 'utf8');
      const at = src.indexOf(gate);
      expect(at, f).toBeGreaterThan(0);
      const firstMedia = src.indexOf(media, src.indexOf('resolveRegisteredWhatsAppUser(clientNumber, fromNumber)'));
      expect(firstMedia, f).toBeGreaterThan(at);
    }
    expect(readFileSync('src/services/whatsapp/WebjsProvider.ts', 'utf8')).not.toContain("body: (message.body || '').slice(0, 50)");
  });

  it('only a registered user may be sent WhatsApp; a failed lookup means no', async () => {
    expect(await mayWhatsApp('T', '+923001112222')).toBe(false);
    resolve.mockResolvedValue({ userId: 2 });
    expect(await mayWhatsApp('T', '+923001112222')).toBe(true);
    resolve.mockRejectedValue(new Error('db down'));
    expect(await mayWhatsApp('T', '+923001112222')).toBe(false);
  });

  it('every sender to another person is checked, and a new sender must be listed here', () => {
    const toUserOnly = ['services/notifications/brainOutboundService.ts', 'services/notifications/tenantWhatsappSender.ts', 'services/whatsapp/WhatsAppInbound.ts', 'services/whatsapp/WebjsProvider.ts', 'routes/webhookRoutes.ts'];
    const checked = ['services/openItems/delegateeFollowupWorker.ts', 'jobs/actionLifecycleWorker.ts', 'services/knowledge/genericActionDispatcher.ts', 'services/delegation/delegationCaptureService.ts', 'services/knowledge/brainComposer.ts'];
    const out = execSync("grep -rlE 'sendTenantWhatsApp(Text|VoiceNote)\\(' src --include=*.ts --exclude-dir=scripts", { encoding: 'utf8' }).trim().split('\n').map((f) => f.replace(/^src\//, '')).sort();
    expect(out).toEqual([...toUserOnly, ...checked].sort());
    for (const f of checked) {
      const src = readFileSync(`src/${f}`, 'utf8');
      const sends = src.split(/sendTenantWhatsAppText\(/).length - 1;
      const checks = src.split(/mayWhatsApp\(/).length - 1;
      expect(checks, f).toBeGreaterThanOrEqual(sends);
    }
  });
});
