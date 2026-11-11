/**
 * Link T30 (Master_Charter.md, the one agreed document). Nexeo's own part, pinned:
 *  1. /master/notice (G2): not urgent = a line kept for his next morning brief (his own rows only, the last
 *     day); urgent = told now through the normal reach at high urgency, never kept for the brief;
 *  2. the brief shows "Suzi updates" only when there is one, and never shows the section on a quiet day;
 *  3. the installer: the signed description is read from X-Installer; a link lasts 10 minutes and names only
 *     the system; a test run never reaches the live server; nothing of the file is kept here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
const findMany = vi.fn();
vi.mock('../src/db/prisma', () => ({ default: { brainUserMessage: { create: (...a: any[]) => create(...a), findMany: (...a: any[]) => findMany(...a) } } }));
const contact = vi.fn();
vi.mock('../src/services/notifications/brainOutboundService', () => ({ brainContactsUser: (...a: any[]) => contact(...a) }));

import { masterNotice, masterLinesForBrief, MASTER_LINE_KIND, MASTER_ALERT_KIND } from '../src/services/suzi/masterNotice';
import { renderSuziUpdates } from '../src/services/views/dayBrief';
import { issueLink, redeemLink, parseInstallerHeader, installerFetch, installerInfo, InstallerUnavailable, LINK_TTL_MS } from '../src/services/suzi/suziInstaller';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

beforeEach(() => { create.mockReset(); findMany.mockReset(); contact.mockReset(); contact.mockResolvedValue({ sent: true }); });

describe('a line from Suzi Master', () => {
  it('not urgent: kept for his next brief, nothing sent now', async () => {
    expect(await masterNotice({ userId: 2, clientNumber: 'T', text: '  fixed for everyone:  goodbye words, version 1.4.1 ', urgent: false })).toEqual({ ok: true, told: 'brief' });
    expect(create.mock.calls[0][0].data).toMatchObject({ clientNumber: 'T', userId: 2, kind: MASTER_LINE_KIND, status: 'for_brief', summary: 'fixed for everyone: goodbye words, version 1.4.1' });
    expect(contact).not.toHaveBeenCalled();
  });
  it('urgent: told now at high urgency, through the normal reach, not kept for the brief', async () => {
    expect(await masterNotice({ userId: 2, clientNumber: 'T', text: 'Version 1.4.1 was stopped: 2 computers failed.', urgent: true })).toEqual({ ok: true, told: 'now', sent: true });
    expect(contact.mock.calls[0][0]).toMatchObject({ userId: 2, clientNumber: 'T', kind: MASTER_ALERT_KIND, urgency: 'high', body: 'Version 1.4.1 was stopped: 2 computers failed.' });
    expect(create).not.toHaveBeenCalled();
  });
  it('the brief reads only his own lines from the last day', async () => {
    findMany.mockResolvedValue([{ summary: 'a' }, { summary: 'b' }]);
    const now = new Date('2026-11-11T03:30:00Z');
    expect(await masterLinesForBrief('T', 2, now)).toEqual(['a', 'b']);
    const w = findMany.mock.calls[0][0].where;
    expect(w).toMatchObject({ clientNumber: 'T', userId: 2, kind: MASTER_LINE_KIND, status: 'for_brief' });
    expect(w.createdAt.gte.toISOString()).toBe('2026-11-10T03:30:00.000Z');
  });
  it('the brief section appears only when there is something', () => {
    expect(renderSuziUpdates([])).toEqual([]);
    expect(renderSuziUpdates(null)).toEqual([]);
    expect(renderSuziUpdates(['fixed for everyone: X, version 1.4.1']).join('\n')).toContain('## Suzi updates (since yesterday)\n- fixed for everyone: X, version 1.4.1');
  });
});

describe('the installer', () => {
  it('reads the signed description; anything else is "not available"', () => {
    const h = Buffer.from(JSON.stringify({ os: 'macos', version: '1.0.1', file: 'Suzi-1.0.1-arm64.dmg', sha256: 'ab'.repeat(32), size: 293_000_000, made: '2026-11-10', sig: 'x' })).toString('base64');
    expect(parseInstallerHeader('macos', h)).toEqual({ os: 'macos', version: '1.0.1', file: 'Suzi-1.0.1-arm64.dmg', sha256: 'ab'.repeat(32), size: 293_000_000, made: '2026-11-10' });
    expect(parseInstallerHeader('macos', null)).toBeNull();
    expect(parseInstallerHeader('macos', 'not-base64-json')).toBeNull();
  });
  it('a link lasts 10 minutes, can be used again inside them (resume), then is gone', () => {
    const t0 = 1_000_000;
    const { token } = issueLink('windows', t0);
    expect(redeemLink(token, t0 + 1000)).toBe('windows');
    expect(redeemLink(token, t0 + 2000)).toBe('windows');
    expect(redeemLink(token, t0 + LINK_TTL_MS)).toBeNull();
    expect(redeemLink('made-up', t0)).toBeNull();
  });
  it('the description is read with a one-byte GET, never HEAD (Suzi Master answers HEAD with 501)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 't30-'));
    writeFileSync(join(dir, 's'), 'x'.repeat(40));
    process.env.SUZI_GATEWAY_ADMIN_SECRET_FILE = join(dir, 's');
    process.env.SUZI_GATEWAY_IN_TESTS = '1';
    try {
      const d = { os: 'macos', version: '1.1.0', file: 'Suzi-1.1.0-arm64.dmg', sha256: 'cc'.repeat(32), size: 243742941, made: '2026-11-11', sig: 'x' };
      const calls: any[] = [];
      const f = (async (url: string, init: any) => {
        calls.push({ url, init });
        if (init.method !== 'GET') return new Response('<html>501</html>', { status: 501 });
        return new Response('A', { status: 206, headers: { 'x-installer': Buffer.from(JSON.stringify(d)).toString('base64') } });
      }) as unknown as typeof fetch;
      expect(await installerInfo('macos', f)).toMatchObject({ version: '1.1.0', file: 'Suzi-1.1.0-arm64.dmg', size: 243742941 });
      expect(calls[0].init.method).toBe('GET');
      expect(calls[0].init.headers.Range).toBe('bytes=0-0');
      expect(calls[0].init.signal).toBeDefined();
      const none = (async () => new Response('no', { status: 404 })) as unknown as typeof fetch;
      expect(await installerInfo('windows', none)).toBeNull();
    } finally {
      delete process.env.SUZI_GATEWAY_ADMIN_SECRET_FILE;
      delete process.env.SUZI_GATEWAY_IN_TESTS;
    }
  });
  it('a test run never reaches the live server', async () => {
    await expect(installerFetch('macos', 'HEAD')).rejects.toBeInstanceOf(InstallerUnavailable);
  });
});
