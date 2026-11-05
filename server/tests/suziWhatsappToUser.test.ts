/**
 * Founder, 5 Nov: when online, Suzi sends WhatsApp through Nexeo. Row 19: it only ever reaches the user. Pinned: the target is
 * the verified user whatever the args say; a failed delivery is reported, not claimed; empty text does nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn(async () => ({ id: 'log1' }));
vi.mock('../src/db/prisma', () => ({ default: { suziActLog: { create: (...a: any[]) => (create as any)(...a), update: async () => ({}), findUnique: async () => null } } }));
vi.mock('../src/services/auditLogService', () => ({ audit: async () => {} }));
vi.mock('../src/services/suzi/suziActions', () => ({ applyFollowUp: vi.fn() }));
vi.mock('../src/services/suzi/suziEmail', () => ({ EMAIL_OPS: [], runEmailOp: vi.fn() }));
const contact = vi.fn();
vi.mock('../src/services/notifications/brainOutboundService', () => ({ brainContactsUser: (...a: any[]) => contact(...a) }));

import { act } from '../src/services/suzi/suziAct';

const call = (args: any) => act('TMC-0001', 2, { op: 'whatsapp.to_user', args, idempotency_key: 'k' });

beforeEach(() => { contact.mockReset(); contact.mockResolvedValue({ sent: true }); });

describe('whatsapp.to_user', () => {
  it('goes to the verified user, and a `to` in the args changes nothing', async () => {
    expect((await call({ text: 'Done.', to: '+920000000', userId: 9 })).status).toBe(200);
    const req = contact.mock.calls[0][0];
    expect(req).toMatchObject({ userId: 2, clientNumber: 'TMC-0001', body: 'Done.' });
    expect(JSON.stringify(req)).not.toContain('+920000000');
  });
  it('a failed delivery is reported, not claimed', async () => {
    contact.mockResolvedValue({ sent: false });
    expect(await call({ text: 'Done.' })).toMatchObject({ status: 409, body: { ok: false, error: 'rejected' } });
  });
  it('empty text does nothing', async () => {
    expect((await call({ text: '  ' })).body).toMatchObject({ ok: false, error: 'bad_text' });
    expect(contact).not.toHaveBeenCalled();
  });
});
