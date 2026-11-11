/**
 * F-2 (Functional Charter, agreed 11 Nov 2026), Nexeo's first ops. Pinned:
 *  CREATE    task.create makes his own task; a bad date or no title is refused before anything is written;
 *            with a person it is assigned AND the person told, and needs his confirmation first;
 *  FORWARD   task.update "forward" = assign + tell; "assign" itself stays silent (unchanged path);
 *  TELL      telling is an email through the send gate: told only when the gate really sends, otherwise it
 *            waits in Drafts and the answer says told: false;
 *  DELEGATE  email.delegate forwards through the gate and makes NO task until the forward has gone;
 *            afterSuziSent then makes the task, assigned and marked told, keeps its id with the send, and
 *            takes the thread off the emails needing a reply.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findAction = vi.fn();
const updateAction = vi.fn();
const updateItem = vi.fn();
const updateManyItems = vi.fn();
const exec = vi.fn();
vi.mock('../src/db/prisma', () => ({
  default: {
    agentAction: { findFirst: (...a: any[]) => findAction(...a), update: (...a: any[]) => updateAction(...a) },
    openItem: { update: (...a: any[]) => updateItem(...a), updateMany: (...a: any[]) => updateManyItems(...a) },
    $executeRawUnsafe: (...a: any[]) => exec(...a),
  },
}));
const person = vi.fn();
vi.mock('../src/services/suzi/suziPeople', () => ({ personById: (...a: any[]) => person(...a) }));
const follow = vi.fn();
vi.mock('../src/services/suzi/suziActions', () => ({ applyFollowUp: (...a: any[]) => follow(...a) }));
const write = vi.fn();
const saveNew = vi.fn();
const gateSend = vi.fn();
const fwd = vi.fn();
const latest = vi.fn();
const emailOp = vi.fn();
vi.mock('../src/services/suzi/suziEmail', () => ({
  writeWithModel: (...a: any[]) => write(...a),
  saveNewDraft: (...a: any[]) => saveNew(...a),
  saveToGmailDrafts: (...a: any[]) => gateSend(...a),
  forwardEmail: (...a: any[]) => fwd(...a),
  latestMail: (...a: any[]) => latest(...a),
  runEmailOp: (...a: any[]) => emailOp(...a),
}));
const emailRules = vi.fn(async () => [] as any[]);
vi.mock('../src/services/suzi/suziEmailRules', async () => {
  const real: any = await vi.importActual('../src/services/suzi/suziEmailRules');
  return { ...real, suziEmailRules: (...a: any[]) => emailRules(...a) };
});
vi.mock('../src/services/knowledge/brainPersonaService', () => ({ getBrainPersona: async () => ({ userFullName: 'Basit Ahmed' }) }));
const create = vi.fn();
const delegate = vi.fn();
const status = vi.fn();
vi.mock('../src/services/openItemsService', () => ({
  createItem: (...a: any[]) => create(...a),
  delegateItem: (...a: any[]) => delegate(...a),
  changeStatus: (...a: any[]) => status(...a),
}));

import { taskCreate, taskForward, emailDelegate, afterSuziSent } from '../src/services/suzi/suziDelegate';

const SIGNED = { signatureVerified: true, voiceScore: 0.9 };
const ALI = { id: 'p1', name: 'Ali Raza', email: 'ali@x.com' };

beforeEach(() => {
  for (const f of [findAction, updateAction, updateItem, updateManyItems, exec, person, follow, write, saveNew, gateSend, fwd, latest, emailOp, create, delegate, status]) f.mockReset();
  person.mockResolvedValue(ALI);
  write.mockResolvedValue('Ali, the vendor review is now yours.');
  saveNew.mockResolvedValue({ ok: true, item: { draft_id: '41' } });
  gateSend.mockResolvedValue({ ok: true, item: { sent: true, undo_until: '2026-11-11T13:00:10Z' } });
  follow.mockResolvedValue({ ok: true, action: { id: 'i1', title: 'Vendor review', due: '2026-11-14' } });
  create.mockResolvedValue({ id: 'i1', status: 'NEW' });
  emailOp.mockResolvedValue({ ok: true, item: {} });
});

describe('task.create (F-2.1)', () => {
  it('his own task: created, no one told, nothing sent', async () => {
    const r: any = await taskCreate('T', 2, { title: ' Vendor review ', due: '2026-11-14', note: 'ask for 3 quotes' }, false, SIGNED);
    expect(r.ok).toBe(true);
    expect(create.mock.calls[0][2]).toMatchObject({ title: 'Vendor review', type: 'task', description: 'ask for 3 quotes', metadata: { manualCreate: true, createdBy: 'suzi' } });
    expect(create.mock.calls[0][2].dueDate.toISOString()).toBe('2026-11-14T12:00:00.000Z');
    expect(saveNew).not.toHaveBeenCalled();
    expect(gateSend).not.toHaveBeenCalled();
  });
  it('refuses a bad date and an empty title before writing anything', async () => {
    expect(await taskCreate('T', 2, { title: 'X', due: '14/11' }, true, SIGNED)).toEqual({ ok: false, error: 'bad_date' });
    expect(await taskCreate('T', 2, { title: '  ' }, true, SIGNED)).toEqual({ ok: false, error: 'bad_title' });
    expect(create).not.toHaveBeenCalled();
  });
  it('with a person: needs his confirmation first, then assigned AND told through the gate', async () => {
    expect(await taskCreate('T', 2, { title: 'Vendor review', person_id: 'p1' }, false, SIGNED)).toEqual({ ok: false, error: 'needs_confirmation' });
    expect(create).not.toHaveBeenCalled();
    const r: any = await taskCreate('T', 2, { title: 'Vendor review', person_id: 'p1', source: { email_id: 'th9' } }, true, SIGNED);
    expect(create.mock.calls[0][2].metadata.suziSource).toEqual({ email_id: 'th9' });
    expect(follow.mock.calls[0][2]).toMatchObject({ actionId: 'i1', update: 'assign', personId: 'p1' });
    expect(saveNew.mock.calls[0][2]).toMatchObject({ to: 'ali@x.com', subject: 'Task: Vendor review', body: 'Ali, the vendor review is now yours.' });
    expect(saveNew.mock.calls[0][3]).toEqual({ tellOpenItemId: 'i1' });
    expect(gateSend.mock.calls[0]).toEqual(['T', 2, { draft_id: '41' }, true, SIGNED]);
    expect(r.item.told).toEqual({ told: true, draft_id: '41', undo_until: '2026-11-11T13:00:10Z' });
  });
  it('a person with no email on record: refused, no task made', async () => {
    person.mockResolvedValue({ id: 'p1', name: 'Ali' });
    expect(await taskCreate('T', 2, { title: 'X', person_id: 'p1' }, true, SIGNED)).toMatchObject({ ok: false, error: 'no_email' });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('task.update forward (F-2.2)', () => {
  it('unsigned: assigned, the note waits in Drafts, told: false', async () => {
    gateSend.mockResolvedValue({ ok: true, item: { sent: false, saved_to_gmail_drafts: true } });
    const r: any = await taskForward('T', 2, { id: 'i1', person_id: 'p1', note: 'by Friday' }, true, { signatureVerified: false, voiceScore: null });
    expect(follow.mock.calls[0][2]).toMatchObject({ actionId: 'i1', update: 'assign', personId: 'p1', note: 'by Friday' });
    expect(write.mock.calls[0][2]).toContain('What Basit Ahmed wants said: by Friday');
    expect(r.item.told).toEqual({ told: false, draft_id: '41' });
  });
  it('without his confirmation nothing changes', async () => {
    expect(await taskForward('T', 2, { id: 'i1', person_id: 'p1' }, false, SIGNED)).toEqual({ ok: false, error: 'needs_confirmation' });
    expect(follow).not.toHaveBeenCalled();
  });
  it('a refused assign is not told', async () => {
    follow.mockResolvedValue({ ok: false, error: 'bad_state', detail: 'finished' });
    expect(await taskForward('T', 2, { id: 'i1', person_id: 'p1' }, true, SIGNED)).toEqual({ ok: false, error: 'bad_state', detail: 'finished' });
    expect(saveNew).not.toHaveBeenCalled();
  });
});

describe('email.delegate (F-2.3)', () => {
  beforeEach(() => {
    latest.mockResolvedValue({ id: 'fe1', subject: 'Quote for racks' });
    fwd.mockResolvedValue({ ok: true, item: { draft_id: '52', attachments_left_out: 1 } });
    findAction.mockResolvedValue({ id: 52, input: { itemType: 'email' } });
  });
  it('held through the gate, and no task yet', async () => {
    const r: any = await emailDelegate('T', 2, { email_id: 'th9', person_id: 'p1', note: 'please handle' }, true, SIGNED);
    expect(fwd.mock.calls[0][2]).toEqual({ thread_id: 'th9', to: 'ali@x.com', text: 'please handle' });
    expect(updateAction.mock.calls[0][0].data.input.delegate).toMatchObject({ thread_id: 'th9', person_id: 'p1', person_email: 'ali@x.com', subject: 'Quote for racks' });
    expect(gateSend.mock.calls[0]).toEqual(['T', 2, { draft_id: '52' }, true, SIGNED]);
    expect(r.item).toMatchObject({ state: 'held', draft_id: '52', undo_until: '2026-11-11T13:00:10Z' });
    expect(create).not.toHaveBeenCalled();
  });
  it('thread_id works as the email id too; unsigned it is only saved', async () => {
    gateSend.mockResolvedValue({ ok: true, item: { sent: false } });
    const r: any = await emailDelegate('T', 2, { thread_id: 'th9', person_id: 'p1' }, true, { signatureVerified: false, voiceScore: null });
    expect(latest.mock.calls[0][2]).toBe('th9');
    expect(r.item).toMatchObject({ state: 'saved', sent: false });
  });
  it('the ready batch: no person_id, the person and rule come from his delegate rule', async () => {
    latest.mockResolvedValue({ id: 'fe1', subject: 'Quote for racks', senderEmail: 'sam@vendor.com' });
    emailRules.mockResolvedValue([{ id: 'r1', kind: 'email_delegate', by: 'domain', value: 'vendor.com', person_id: 'p1', person_name: 'Ali Raza' }]);
    const r: any = await emailDelegate('T', 2, { email_id: 'th9' }, true, SIGNED);
    expect(person.mock.calls[0][2]).toBe('p1');
    expect(updateAction.mock.calls[0][0].data.input.delegate).toMatchObject({ person_id: 'p1', rule_id: 'r1' });
    expect(r.item.state).toBe('held');
  });
  it('the ready batch after the rule is gone: 409 rule_removed, nothing forwarded', async () => {
    latest.mockResolvedValue({ id: 'fe1', subject: 'Quote', senderEmail: 'sam@vendor.com' });
    emailRules.mockResolvedValue([]);
    expect(await emailDelegate('T', 2, { email_id: 'th9' }, true, SIGNED)).toMatchObject({ ok: false, error: 'rule_removed' });
    expect(fwd).not.toHaveBeenCalled();
  });
  it('needs his confirmation', async () => {
    expect(await emailDelegate('T', 2, { email_id: 'th9', person_id: 'p1' }, false, SIGNED)).toEqual({ ok: false, error: 'needs_confirmation' });
    expect(fwd).not.toHaveBeenCalled();
  });
});

describe('after the send has really gone', () => {
  it('a delegated email: task made, assigned, marked told, its id kept, the thread handled', async () => {
    findAction.mockResolvedValue({ id: 52, clientNumber: 'T', userId: 2, input: { delegate: { thread_id: 'th9', person_id: 'p1', person_name: 'Ali Raza', person_email: 'ali@x.com', note: 'please handle', subject: 'Quote for racks' } } });
    await afterSuziSent(52, 'gm77');
    expect(create.mock.calls[0][2]).toMatchObject({ title: 'Quote for racks', metadata: { suziSource: { email_id: 'th9' } } });
    expect(status.mock.calls[0].slice(0, 3)).toEqual(['i1', 'T', 'TRIAGED']);
    expect(delegate.mock.calls[0].slice(0, 5)).toEqual(['i1', 'T', null, 'Ali Raza', 'ali@x.com']);
    expect(updateItem.mock.calls[0][0].data).toMatchObject({ delegationEmailMessageId: 'gm77' });
    expect(JSON.parse(exec.mock.calls[0][2])).toEqual({ task_id: 'i1' });
    expect(emailOp.mock.calls[0].slice(0, 4)).toEqual(['T', 2, 'email.mark', { thread_id: 'th9', state: 'handled' }]);
  });
  it('a note to a person: only that task is marked told, scoped to his tenant and user', async () => {
    findAction.mockResolvedValue({ id: 41, clientNumber: 'T', userId: 2, input: { tellOpenItemId: 'i1' } });
    await afterSuziSent(41, 'gm78');
    expect(updateManyItems.mock.calls[0][0].where).toEqual({ id: 'i1', clientNumber: 'T', userId: 2 });
    expect(create).not.toHaveBeenCalled();
  });
  it('an ordinary email: nothing else happens', async () => {
    findAction.mockResolvedValue({ id: 7, clientNumber: 'T', userId: 2, input: { feedEventId: 'fe1' } });
    await afterSuziSent(7, 'gm79');
    expect(create).not.toHaveBeenCalled();
    expect(updateManyItems).not.toHaveBeenCalled();
  });
});
