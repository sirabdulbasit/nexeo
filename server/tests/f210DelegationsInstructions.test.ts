/**
 * F-2.10 (Suzi Master AGREE 11 Nov; founder 12 Nov 2026). Pinned:
 *  MATRIX       delegation.set/remove only for an Admin or SuperAdmin, confirmed, signed and voiced; written through the
 *               existing matrix service (history kept); an unknown person is not_found and nothing is written;
 *  INSTRUCTION  instruction.add confirmed, through the one instruction store Brain renders; company-wide scope is
 *               admin-only; instruction.remove archives (never deletes) and passes the admin flag;
 *  VERSION      each answer carries the new rules_version.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let userType = 'SA';
vi.mock('../src/db/prisma', () => ({ default: { user: { findFirst: async () => ({ userType }) } } }));
vi.mock('../src/services/suzi/suziPeople', () => ({ personById: async (_c: string, _u: number, id: string) => (id === 'p1' ? { id: 'p1', name: 'Ali Raza', email: 'ali@x.com' } : id === 'p2' ? { id: 'p2', name: 'Sara', email: 'sara@x.com' } : null) }));
vi.mock('../src/services/suzi/suziRules', () => ({ rulesDocument: async () => ({ rules_version: 42 }) }));
const upsert = vi.fn(async (_c: string, _u: number, i: any) => ({ area: i.area }));
const deactivate = vi.fn(async () => true);
vi.mock('../src/services/knowledge/delegationMatrixService', () => ({ upsertEntry: (...a: any[]) => (upsert as any)(...a), deactivateEntry: (...a: any[]) => (deactivate as any)(...a) }));
const create = vi.fn(async (_c: string, _u: number, t: string, scope: string) => ({ id: 'ins_1', structured: { title: t.slice(0, 20) }, scope }));
const status = vi.fn(async () => ({ ok: true }));
vi.mock('../src/services/knowledge/instructionService', () => ({ createInstructionFromText: (...a: any[]) => (create as any)(...a), updateInstructionStatus: (...a: any[]) => (status as any)(...a) }));

import { runDelegationOp } from '../src/services/suzi/suziDelegations';

const signed = { signatureVerified: true, voiceScore: 0.9 } as any;
const unsigned = { signatureVerified: false, voiceScore: null } as any;
beforeEach(() => { userType = 'SA'; upsert.mockClear(); deactivate.mockClear(); create.mockClear(); status.mockClear(); });

describe('delegation matrix', () => {
  it('admin, confirmed, signed: written through the matrix service, with the new rules_version', async () => {
    const r = await runDelegationOp('T', 2, 'delegation.set', { area: 'Payroll', person_id: 'p1', escalate_to: 'p2', note: 'Pakistan payroll' }, true, signed);
    expect(r).toEqual({ ok: true, item: { area: 'Payroll', owner: 'Ali Raza', escalate_to: 'Sara', rules_version: 42 } });
    expect(upsert.mock.calls[0][2]).toMatchObject({ area: 'Payroll', ownerName: 'Ali Raza', ownerEmail: 'ali@x.com', escalateToName: 'Sara', notes: 'Pakistan payroll' });
  });
  it('refused, writing nothing: not confirmed, not an admin, not signed, unknown person', async () => {
    expect(await runDelegationOp('T', 2, 'delegation.set', { area: 'Payroll', person_id: 'p1' }, false, signed)).toMatchObject({ error: 'needs_confirmation' });
    expect(await runDelegationOp('T', 2, 'delegation.set', { area: 'Payroll', person_id: 'p1' }, true, unsigned)).toMatchObject({ error: 'needs_signature' });
    expect(await runDelegationOp('T', 2, 'delegation.set', { area: 'Payroll', person_id: 'nobody' }, true, signed)).toMatchObject({ error: 'not_found' });
    userType = 'EM';
    expect(await runDelegationOp('T', 2, 'delegation.set', { area: 'Payroll', person_id: 'p1' }, true, signed)).toMatchObject({ error: 'not_allowed' });
    expect(await runDelegationOp('T', 2, 'delegation.remove', { area: 'Payroll' }, true, signed)).toMatchObject({ error: 'not_allowed' });
    expect(upsert).not.toHaveBeenCalled();
    expect(deactivate).not.toHaveBeenCalled();
  });
  it('remove deactivates the area (history kept by the service)', async () => {
    expect(await runDelegationOp('T', 2, 'delegation.remove', { area: 'Payroll' }, true, signed)).toEqual({ ok: true, item: { area: 'Payroll', removed: true, rules_version: 42 } });
    expect(deactivate).toHaveBeenCalledWith('T', 'Payroll', 2);
  });
});

describe('standing instructions', () => {
  it('added for him through the one instruction store; confirmation needed', async () => {
    expect(await runDelegationOp('T', 2, 'instruction.add', { text: 'Always copy Salman on finance mails' }, false, unsigned)).toMatchObject({ error: 'needs_confirmation' });
    const r: any = await runDelegationOp('T', 2, 'instruction.add', { text: 'Always copy Salman on finance mails' }, true, unsigned);
    expect(r).toMatchObject({ ok: true, item: { id: 'ins_1', scope: 'user', rules_version: 42 } });
    expect(create).toHaveBeenCalledWith('T', 2, 'Always copy Salman on finance mails', 'user');
  });
  it('company-wide only for an admin', async () => {
    userType = 'EM';
    expect(await runDelegationOp('T', 2, 'instruction.add', { text: 'x', scope: 'client' }, true, unsigned)).toMatchObject({ error: 'not_allowed' });
    expect(create).not.toHaveBeenCalled();
  });
  it('remove archives it, never deletes, and passes whether he is an admin', async () => {
    expect(await runDelegationOp('T', 2, 'instruction.remove', { id: 'ins_1' }, true, unsigned)).toEqual({ ok: true, item: { id: 'ins_1', removed: true, rules_version: 42 } });
    expect(status).toHaveBeenCalledWith('T', 2, 'ins_1', 'archived', { isAdmin: true });
  });
});
