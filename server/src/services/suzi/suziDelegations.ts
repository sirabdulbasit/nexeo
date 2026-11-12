/**
 * F-2.10 (Suzi Master AGREE 11 Nov; founder 12 Nov 2026: "Suzi can also create rules, delegation, instructions
 * through Nexeo, which will be used by Nexeo brain"). Written to the stores Nexeo's Brain already reads:
 *
 *   delegation.set     {area, person_id, escalate_to?, note?}   delegation_matrix (tenant-wide): Admin or SuperAdmin,
 *                                                               confirmed, signed and voiced (presence = the voice
 *                                                               lock until F-2.9 adds other forms)
 *   delegation.remove  {area}                                  the same gate; the row is deactivated, history kept
 *   instruction.add    {text, scope?: user | client}           a standing instruction (instruction wiki page, the
 *                                                               one Brain renders); confirmed; client scope is admin
 *   instruction.remove {id}                                    archived, never deleted; only its author or an admin
 *
 * Each answer carries the new rules_version, so Suzi refetches her rules document.
 */
import prisma from '../../db/prisma';
import { personById } from './suziPeople';
import type { SendGate } from './suziEmail';

type Args = Record<string, unknown>;
type Result = { ok: true; item: unknown } | { ok: false; error: string; detail?: string };
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const fail = (error: string, detail?: string): Result => ({ ok: false, error, ...(detail ? { detail } : {}) });
export const DELEGATION_OPS = ['delegation.set', 'delegation.remove', 'instruction.add', 'instruction.remove'] as const;

async function isAdmin(clientNumber: string, userId: number): Promise<boolean> {
  const u = await prisma.user.findFirst({ where: { id: userId, clientNumber } as any, select: { userType: true } as any }) as any;
  return u?.userType === 'SA' || u?.userType === 'AD';
}

async function rulesVersion(clientNumber: string, userId: number): Promise<number | undefined> {
  const { rulesDocument } = await import('./suziRules');
  return (await rulesDocument(clientNumber, userId).catch(() => null))?.rules_version;
}

const signedOk = (gate: SendGate, confirmed: boolean) => confirmed && gate.signatureVerified && gate.voiceScore !== null;

export async function runDelegationOp(clientNumber: string, userId: number, op: string, a: Args, confirmed: boolean, gate: SendGate): Promise<Result> {
  if (op === 'delegation.set' || op === 'delegation.remove') {
    const area = text(a.area).slice(0, 100);
    if (!area) return fail('bad_area');
    if (!confirmed) return fail('needs_confirmation');
    if (!(await isAdmin(clientNumber, userId))) return fail('not_allowed', 'the delegation matrix is set by an Admin or SuperAdmin');
    if (!signedOk(gate, confirmed)) return fail('needs_signature', 'the delegation matrix changes who acts for the company: a signed, voiced yes is needed');
    const m = await import('../knowledge/delegationMatrixService');
    if (op === 'delegation.remove') {
      const done = await m.deactivateEntry(clientNumber, area, userId);
      return done ? { ok: true, item: { area, removed: true, rules_version: await rulesVersion(clientNumber, userId) } } : fail('not_found');
    }
    const owner = await personById(clientNumber, userId, text(a.person_id));
    if (!owner) return fail('not_found', 'no such person');
    const esc = text(a.escalate_to) ? await personById(clientNumber, userId, text(a.escalate_to)) : null;
    if (text(a.escalate_to) && !esc) return fail('not_found', 'no such person to escalate to');
    const entry = await m.upsertEntry(clientNumber, userId, {
      area, ownerName: owner.name, ownerEmail: owner.email ?? null,
      escalateToName: esc?.name ?? null, escalateToEmail: esc?.email ?? null,
      notes: text(a.note).slice(0, 1000) || null, isActive: true,
    });
    return { ok: true, item: { area: (entry as any).area ?? area, owner: owner.name, escalate_to: esc?.name ?? null, rules_version: await rulesVersion(clientNumber, userId) } };
  }

  if (op === 'instruction.add') {
    const body = text(a.text).slice(0, 2000);
    if (!body) return fail('bad_text');
    if (!confirmed) return fail('needs_confirmation');
    const scope = text(a.scope) === 'client' ? 'client' : 'user';
    if (scope === 'client' && !(await isAdmin(clientNumber, userId))) return fail('not_allowed', 'a company-wide instruction is set by an Admin or SuperAdmin');
    const { createInstructionFromText } = await import('../knowledge/instructionService');
    const made = await createInstructionFromText(clientNumber, userId, body, scope);
    if (!made) return fail('bad_text');
    return { ok: true, item: { id: made.id, title: made.structured.title, scope, rules_version: await rulesVersion(clientNumber, userId) } };
  }

  if (op === 'instruction.remove') {
    const id = text(a.id);
    if (!id) return fail('not_found');
    if (!confirmed) return fail('needs_confirmation');
    const { updateInstructionStatus } = await import('../knowledge/instructionService');
    const r = await updateInstructionStatus(clientNumber, userId, id, 'archived', { isAdmin: await isAdmin(clientNumber, userId) });
    if (!r.ok) return fail(/not found/i.test(r.reason ?? '') ? 'not_found' : 'not_allowed', r.reason);
    return { ok: true, item: { id, removed: true, rules_version: await rulesVersion(clientNumber, userId) } };
  }

  return fail('unknown_op');
}
