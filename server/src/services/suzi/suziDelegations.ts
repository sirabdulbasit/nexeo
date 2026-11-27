/**
 * F-2.10 (Suzi Master AGREE 11 Nov; founder 12 Nov 2026: "Suzi can also create rules, delegation, instructions
 * through Nexeo, which will be used by Nexeo brain"). Written to the stores Nexeo's Brain already reads:
 *
 *   delegation.set     {area, person_id, escalate_to?, note?}   delegation_matrix (tenant-wide): Admin or SuperAdmin,
 *                                                               confirmed, signed and voiced (presence = the voice
 *                                                               lock until F-2.9 adds other forms)
 *   delegation.remove  {area}                                  the same gate; the row is deactivated, history kept
 *   instruction.add    {text, scope?: user | client, schedule?} a standing instruction (instruction wiki page, the
 *                                                               one Brain renders); confirmed; client scope is admin
 *   instruction.update {id, schedule | null}                   T41 round 9: sets or clears WHEN it runs, nothing else;
 *                                                               confirmed; only its author or an admin
 *   instruction.remove {id}                                    archived, never deleted; only its author or an admin
 *
 * T50 (both AGREE 27 Nov), scheduled jobs. On instruction.add with a schedule: `runs_on?: "nexeo" | "mac"` (Nexeo
 * decides once from the words when it is missing, and answers with the choice), `send?: "auto"` only with `said`, his
 * own words for that job, confirmed back; `schedule: {once: "<ISO date-time>"}` is a one-off. instruction.update
 * changes exactly one thing per call: `schedule`, `runs_on`, `paused`, or `send` (+ `said`).
 *
 * Each answer carries the new rules_version, so Suzi refetches her rules document.
 */
import prisma from '../../db/prisma';
import { personById } from './suziPeople';
import type { SendGate } from './suziEmail';
import { parseSchedule } from '../knowledge/instructionSchedule';

type Args = Record<string, unknown>;
type Result = { ok: true; item: unknown } | { ok: false; error: string; detail?: string };
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const fail = (error: string, detail?: string): Result => ({ ok: false, error, ...(detail ? { detail } : {}) });
export const DELEGATION_OPS = ['delegation.set', 'delegation.remove', 'instruction.add', 'instruction.update', 'instruction.remove'] as const;

async function isAdmin(clientNumber: string, userId: number): Promise<boolean> {
  const u = await prisma.user.findFirst({ where: { id: userId, clientNumber } as any, select: { userType: true } as any }) as any;
  return u?.userType === 'SA' || u?.userType === 'AD';
}

async function rulesVersion(clientNumber: string, userId: number): Promise<number | undefined> {
  const { rulesDocument } = await import('./suziRules');
  return (await rulesDocument(clientNumber, userId).catch(() => null))?.rules_version;
}

const signedOk = (gate: SendGate, confirmed: boolean) => confirmed && gate.signatureVerified && (gate.voiceScore !== null || gate.click === true);

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
    const schedule = a.schedule == null ? null : parseSchedule(a.schedule);
    if (a.schedule != null && !schedule) return fail('bad_schedule');
    if (schedule?.once !== undefined && Date.parse(schedule.once) <= Date.now()) return fail('bad_schedule', 'that time has already passed');
    // T50: the job part exists only with a schedule. A wrong value is refused, never read as something else.
    if (a.runs_on !== undefined && a.runs_on !== 'nexeo' && a.runs_on !== 'mac') return fail('bad_args', 'runs_on is "nexeo" or "mac"');
    if (a.send !== undefined && a.send !== 'ask' && a.send !== 'auto') return fail('bad_args', 'send is "ask" or "auto"');
    if ((a.runs_on !== undefined || a.send !== undefined) && !schedule) return fail('bad_args', 'runs_on and send belong to a scheduled instruction');
    const said = text(a.said).slice(0, 300);
    if (a.send === 'auto' && !said) return fail('bad_args', 'send "auto" needs his own words for this job (said)');
    if (!confirmed) return fail('needs_confirmation');
    const scope = text(a.scope) === 'client' ? 'client' : 'user';
    if (scope === 'client' && !(await isAdmin(clientNumber, userId))) return fail('not_allowed', 'a company-wide instruction is set by an Admin or SuperAdmin');
    const { createInstructionFromText } = await import('../knowledge/instructionService');
    const runsOn: 'nexeo' | 'mac' | null = !schedule ? null
      : a.runs_on === 'nexeo' || a.runs_on === 'mac' ? a.runs_on
      : await (await import('./scheduledJobs')).decideRunsOn(body, { clientNumber, userId });
    const job = runsOn ? (a.send === 'auto' ? { runs_on: runsOn, send: 'auto' as const, said } : { runs_on: runsOn, send: 'ask' as const }) : null;
    const made = await createInstructionFromText(clientNumber, userId, body, scope, schedule, job);
    if (!made) return fail('bad_text');
    return { ok: true, item: { id: made.id, title: made.structured.title, scope, ...(schedule ? { schedule } : {}), ...(job ? { runs_on: job.runs_on, send: job.send, ...(job.send === 'auto' ? { said } : {}) } : {}), rules_version: await rulesVersion(clientNumber, userId) } };
  }

  if (op === 'instruction.update') {
    const id = text(a.id);
    if (!id) return fail('not_found');
    // One change per call: the schedule (null clears it), where it runs, paused, or send (+ said, his words).
    const CHANGES = ['schedule', 'runs_on', 'paused', 'send'];
    const sent = CHANGES.filter((k) => k in a);
    const extra = Object.keys(a).filter((k) => k !== 'id' && k !== 'said' && !CHANGES.includes(k));
    if (extra.length) return fail('bad_args', `only schedule, runs_on, paused or send change here: ${extra.slice(0, 5).join(', ')}`);
    if (!sent.length) return fail('bad_schedule', 'schedule is required (null clears it)');
    if (sent.length > 1) return fail('bad_args', 'one change per call');
    if ('said' in a && sent[0] !== 'send') return fail('bad_args', 'said goes with send');
    const admin = { isAdmin: await isAdmin(clientNumber, userId) };
    const refused = (reason?: string) => fail(/not found/i.test(reason ?? '') ? 'not_found' : /no schedule/i.test(reason ?? '') ? 'bad_state' : 'not_allowed', reason);

    if (sent[0] === 'schedule') {
      const schedule = a.schedule === null ? null : parseSchedule(a.schedule);
      if (a.schedule !== null && !schedule) return fail('bad_schedule');
      if (schedule?.once !== undefined && Date.parse(schedule.once) <= Date.now()) return fail('bad_schedule', 'that time has already passed');
      if (!confirmed) return fail('needs_confirmation');
      const { setInstructionSchedule } = await import('../knowledge/instructionService');
      const r = await setInstructionSchedule(clientNumber, userId, id, schedule, admin);
      if (!r.ok) return refused(r.reason);
      return { ok: true, item: { id, schedule, rules_version: await rulesVersion(clientNumber, userId) } };
    }
    if (sent[0] === 'paused') {
      if (typeof a.paused !== 'boolean') return fail('bad_args', 'paused is true or false');
      if (!confirmed) return fail('needs_confirmation');
      const { updateInstructionStatus } = await import('../knowledge/instructionService');
      // Only a live instruction is paused or resumed: one he removed, or a finished one-off, is not brought back here.
      const page = await prisma.wikiPage.findFirst({ where: { id, clientNumber, pageType: 'instruction', status: 'active' } as any, select: { metadata: true } as any }) as any;
      const st = page?.metadata?.status;
      if (st !== 'active' && st !== 'paused') return fail('not_found');
      const r = await updateInstructionStatus(clientNumber, userId, id, a.paused ? 'paused' : 'active', admin);
      if (!r.ok) return refused(r.reason);
      return { ok: true, item: { id, paused: a.paused, rules_version: await rulesVersion(clientNumber, userId) } };
    }
    const { setInstructionJob } = await import('../knowledge/instructionService');
    if (sent[0] === 'runs_on') {
      if (a.runs_on !== 'nexeo' && a.runs_on !== 'mac') return fail('bad_args', 'runs_on is "nexeo" or "mac"');
      if (!confirmed) return fail('needs_confirmation');
      const r = await setInstructionJob(clientNumber, userId, id, { runs_on: a.runs_on }, admin);
      if (!r.ok) return refused(r.reason);
      return { ok: true, item: { id, runs_on: r.job!.runs_on, send: r.job!.send, rules_version: await rulesVersion(clientNumber, userId) } };
    }
    // send: "auto" only on his explicit words for this job, confirmed back (Suzi's condition 3). Never inferred.
    if (a.send !== 'ask' && a.send !== 'auto') return fail('bad_args', 'send is "ask" or "auto"');
    const said = text(a.said).slice(0, 300);
    if (a.send === 'auto' && !said) return fail('bad_args', 'send "auto" needs his own words for this job (said)');
    if (!confirmed) return fail('needs_confirmation');
    const r = await setInstructionJob(clientNumber, userId, id, { send: a.send, ...(a.send === 'auto' ? { said } : {}) }, admin);
    if (!r.ok) return refused(r.reason);
    return { ok: true, item: { id, runs_on: r.job!.runs_on, send: r.job!.send, ...(r.job!.send === 'auto' ? { said: r.job!.said } : {}), rules_version: await rulesVersion(clientNumber, userId) } };
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
