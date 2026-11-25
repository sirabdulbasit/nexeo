/**
 * T33 P2-P4 (both AGREE 17 Nov 2026), T37 rename and DEF-509 (both AGREE 18 Nov 2026). Pinned:
 *  NOTE      the note to each person names the lead owner, everyone else responsible and the due date (founder 18 Nov);
 *  HELPER    helper_add needs his yes and an email; answers at once (told: pending); the note's outcome lands on the
 *            helper; the same helper again is the first add; the lead cannot be a helper; helper_remove takes them off;
 *  CREATE    task.create with helpers makes one complete task (lead + helpers), the helpers' notes naming the lead;
 *  FOLLOWUP  to the delegate by default, to the lead and every helper with all: true; a repeat within 10 min is folded;
 *            refused when there is nobody to follow up;
 *  HISTORY   trail entries and replies are dated history entries and real changes;
 *  EMAILS    ignored and tasked emails leave the list (counted); a newer message comes back with task_id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const item: { row: any } = { row: null };
vi.mock('../src/db/prisma', () => ({
  default: {
    openItem: { findFirst: async () => item.row, update: async () => ({}) },
    $executeRawUnsafe: async () => 1,
    $queryRawUnsafe: async () => [],
    agentAction: { findFirst: async () => null },
  },
}));
const trail: any[] = [];
let helpers: any[] = [];
vi.mock('../src/services/suzi/suziTaskTrail', async () => {
  const real: any = await vi.importActual('../src/services/suzi/suziTaskTrail');
  return {
    ...real,
    trailPush: async (_id: string, e: any) => { trail.push({ at: new Date().toISOString(), ...e }); item.row = { ...item.row, metadata: { ...item.row.metadata, suziTrail: [...trail] } }; },
    setHelpers: async (_id: string, h: any[]) => { helpers = h; item.row = { ...item.row, metadata: { ...item.row.metadata, suziHelpers: h } }; },
    setHelperTold: async (_id: string, pid: string, t: any) => { helpers = helpers.map((h) => (h.person_id === pid ? { ...h, told: t.state, ...(t.draft_id ? { draft_id: t.draft_id } : {}) } : h)); item.row = { ...item.row, metadata: { ...item.row.metadata, suziHelpers: helpers } }; },
  };
});
const people: Record<string, any> = { p1: { id: 'p1', name: 'Salman Sohail', email: 'salman@x.com' }, p2: { id: 'p2', name: 'Sara Khan', email: 'sara@x.com' }, p3: { id: 'p3', name: 'No Mail', email: null } };
vi.mock('../src/services/suzi/suziSend', () => ({ sendBlockReason: async (_c: string, _u: number, g: any) => (g.signatureVerified ? null : 'not_signed') }));
vi.mock('../src/services/suzi/suziPeople', () => ({ personById: async (_c: string, _u: number, id: string) => people[id] ?? null }));
vi.mock('../src/services/suzi/suziActions', () => ({
  applyFollowUp: async () => ({ ok: true, action: { id: 'i1', title: 'SAP review', due: '2026-11-27' } }),
  actionById: async (_c: string, _u: number, id: string) => ({ id, title: 'SAP review', helpers: helpers.map((h) => ({ person_id: h.person_id, name: h.name })) }),
}));
const prompts: string[] = [];
const drafts: any[] = [];
vi.mock('../src/services/suzi/suziEmail', () => ({
  writeWithModel: async (_c: string, _u: number, p: string) => { prompts.push(p); return 'body'; },
  saveNewDraft: async (_c: string, _u: number, out: any, inp: any) => { drafts.push({ out, inp }); return { ok: true, item: { draft_id: String(40 + drafts.length) } }; },
  saveToGmailDrafts: async () => ({ ok: true, item: { sent: false } }),
  forwardEmail: async () => ({ ok: true, item: {} }), latestMail: async () => null, markThread: async () => ({ ok: true }),
}));
vi.mock('../src/services/knowledge/brainPersonaService', () => ({ getBrainPersona: async () => ({ userFullName: 'Basit Ahmed' }) }));
vi.mock('../src/services/openItemsService', () => ({ createItem: async () => ({ id: 'i1', status: 'NEW' }), delegateItem: async () => ({}), changeStatus: async () => ({}) }));

import { taskHelper, taskFollowup, taskCreate, tellPrompt } from '../src/services/suzi/suziDelegate';
import { historyOf, changedAt } from '../src/services/suzi/taskHistory';
import { leaveHandled } from '../src/services/suzi/dayPack';

const G = { signatureVerified: true, voiceScore: 0.9 };
const flush = async () => { for (let k = 0; k < 10; k++) await new Promise((r) => setTimeout(r, 5)); };
beforeEach(() => {
  trail.length = 0; helpers = []; prompts.length = 0; drafts.length = 0;
  item.row = { title: 'SAP review', dueDate: new Date('2026-11-27T12:00:00Z'), status: 'DELEGATED', delegateeName: 'Salman Sohail', delegateeEmail: 'salman@x.com', metadata: {} };
});

describe('NOTE: names the lead, the others and the date', () => {
  it('owner, helper and follow-up prompts', () => {
    const owner = tellPrompt('Basit', { itemId: 'i', title: 'T', due: '2026-11-27', note: '', person: { name: 'Salman', email: 's' }, role: 'owner', helpers: ['Sara'] });
    expect(owner).toContain('Lead owner: Salman (the person this email is to)');
    expect(owner).toContain('Also responsible: Sara');
    expect(owner).toContain('Due: 2026-11-27');
    const helper = tellPrompt('Basit', { itemId: 'i', title: 'T', due: null, note: 'check the figures', person: { name: 'Sara', email: 's' }, role: 'helper', lead: 'Salman', helpers: ['Sara', 'Ali'] });
    expect(helper).toContain('Lead owner: Salman');
    expect(helper).toContain('Also responsible: Ali');
    expect(helper).not.toContain('Also responsible: Sara');
    expect(helper).toContain('Due: no date set yet');
    expect(helper).toContain('check the figures');
  });
});

describe('HELPER (T33 P2)', () => {
  it('needs his yes and an email; the lead cannot be a helper; finished tasks refuse', async () => {
    expect(await taskHelper('T', 2, { id: 'i1', update: 'helper_add', person_id: 'p2' }, false, G)).toMatchObject({ error: 'needs_confirmation' });
    expect(await taskHelper('T', 2, { id: 'i1', update: 'helper_add', person_id: 'p3' }, true, G)).toMatchObject({ error: 'no_email' });
    expect(await taskHelper('T', 2, { id: 'i1', update: 'helper_add', person_id: 'p1' }, true, G)).toMatchObject({ error: 'bad_state' });
    item.row.status = 'CLOSED';
    expect(await taskHelper('T', 2, { id: 'i1', update: 'helper_add', person_id: 'p2' }, true, G)).toMatchObject({ error: 'bad_state' });
    item.row = null;
    expect(await taskHelper('T', 2, { id: 'x', update: 'helper_add', person_id: 'p2' }, true, G)).toMatchObject({ error: 'not_found' });
  });
  it('adds at once (told pending), the note follows and its outcome lands on the helper; a repeat is the first add', async () => {
    const r: any = await taskHelper('T', 2, { id: 'i1', update: 'helper_add', person_id: 'p2', note: 'check the figures' }, true, G);
    expect(r).toMatchObject({ ok: true, item: { helper_added: true, told: 'pending' } });
    expect(trail).toEqual([expect.objectContaining({ change: 'Helper added: Sara Khan', note: 'check the figures' })]);
    await flush(); await flush();
    expect(prompts[0]).toContain('Lead owner: Salman Sohail');
    expect(drafts[0].inp).toMatchObject({ tellTaskThreadOf: 'i1', tellRole: 'helper' });
    expect(drafts[0].inp.tellOpenItemId).toBeUndefined(); // a helper's note never marks the delegate told
    expect(helpers[0]).toMatchObject({ person_id: 'p2', told: 'drafted', draft_id: '41' });
    const again: any = await taskHelper('T', 2, { id: 'i1', update: 'helper_add', person_id: 'p2' }, true, G);
    expect(again).toMatchObject({ ok: true, item: { repeat: true, told: 'drafted', told_draft_id: '41' } });
    expect(trail).toHaveLength(1);
    expect(drafts).toHaveLength(1);
  });
  it('helper_remove takes them off with a history entry; an unknown helper is not_found', async () => {
    item.row.metadata = { suziHelpers: [{ person_id: 'p2', name: 'Sara Khan', email: 'sara@x.com', added_at: 'x' }] };
    helpers = item.row.metadata.suziHelpers;
    expect(await taskHelper('T', 2, { id: 'i1', update: 'helper_remove', person_id: 'p9' }, false, G)).toMatchObject({ error: 'not_found' });
    expect(await taskHelper('T', 2, { id: 'i1', update: 'helper_remove', person_id: 'p2' }, false, G)).toMatchObject({ ok: true, item: { helper_removed: true } });
    expect(helpers).toEqual([]);
    expect(trail[0].change).toBe('Helper removed: Sara Khan');
  });
});

describe('CREATE with helpers (founder 18 Nov 14:39)', () => {
  it('one call: lead and helpers; the helper note names the lead; needs his yes', async () => {
    item.row = { title: 'SAP review', dueDate: null, status: 'NEW', delegateeName: null, delegateeEmail: null, metadata: {} };
    expect(await taskCreate('T', 2, { title: 'SAP review', helpers: ['p2'] }, false, G)).toMatchObject({ error: 'needs_confirmation' });
    const r: any = await taskCreate('T', 2, { title: 'SAP review', due: '2026-11-27', person_id: 'p1', helpers: [{ person_id: 'p2', note: 'figures' }] }, true, G);
    expect(r.ok).toBe(true);
    expect(r.item.helpers_added).toEqual([{ person_id: 'p2', ok: true }]);
    await flush(); await flush();
    expect(prompts.find((p) => p.includes('to Sara Khan'))).toContain('Lead owner: Salman Sohail');
  });
});

describe('FOLLOWUP (T33 P3)', () => {
  it('unsigned: fails at once with the reason, nothing written or sent (Suzi 24 Nov 12:17)', async () => {
    const r: any = await taskFollowup('T', 2, { id: 'i1' }, true, { signatureVerified: false, voiceScore: null } as any);
    expect(r.ok).toBe(true);
    expect(r.item.told).toBe('failed');
    expect(r.item.reason).toBe('not_signed');
    expect(r.item.followed_up).toEqual([{ name: 'Salman Sohail', told: 'failed', reason: 'not_signed' }]);
  });
  it('to the delegate by default; to the lead and every helper with all; a repeat is folded', async () => {
    expect(await taskFollowup('T', 2, { id: 'i1' }, false, G)).toMatchObject({ error: 'needs_confirmation' });
    const one: any = await taskFollowup('T', 2, { id: 'i1', note: 'by Friday' }, true, G);
    expect(one.item.followed_up).toEqual([{ name: 'Salman Sohail', told: 'pending' }]);
    item.row.metadata = { ...item.row.metadata, suziHelpers: [{ person_id: 'p2', name: 'Sara Khan', email: 'sara@x.com', added_at: 'x' }] };
    helpers = item.row.metadata.suziHelpers;
    const all: any = await taskFollowup('T', 2, { id: 'i1', all: true }, true, G);
    expect(all.item.followed_up).toEqual([{ name: 'Salman Sohail', told: 'pending', repeat: true }, { name: 'Sara Khan', person_id: 'p2', told: 'pending' }]);
    expect(trail.map((e) => e.change)).toEqual(['Followed up: Salman Sohail', 'Followed up: Sara Khan']);
    await flush(); await flush();
    expect(prompts.every((p) => p.includes('following up'))).toBe(true);
    expect(drafts.map((d) => d.out.subject)).toEqual(['Following up: SAP review', 'Following up: SAP review']);
  });
  it('nobody to follow up: refused with a reason', async () => {
    item.row.delegateeEmail = null; item.row.delegateeName = null;
    expect(await taskFollowup('T', 2, { id: 'i1' }, true, G)).toMatchObject({ error: 'bad_state', detail: expect.stringContaining('person_id') });
  });
});

describe('HISTORY: trail and replies are real, dated entries', () => {
  it('helper, rename and reply entries appear and move changed_at', () => {
    const it_ = { createdAt: new Date('2026-11-18T08:00:00Z'), metadata: { suziTrail: [{ at: '2026-11-18T09:00:00Z', who: 'you, through Suzi', change: 'Renamed', note: 'Agrify → Agreeofy' }] } };
    const replies = [{ at: '2026-11-18T10:00:00Z', who: 'Sara Khan', change: 'reply', note: 'Done', thread_id: 'th', email_id: 'm1' }];
    const h = historyOf(it_ as any, [], 2, { replies });
    expect(h[0]).toEqual({ at: '2026-11-18T10:00:00.000Z', who: 'Sara Khan', change: 'reply', note: 'Done', thread_id: 'th', email_id: 'm1' });
    expect(h[1]).toMatchObject({ change: 'Renamed', note: 'Agrify → Agreeofy' });
    expect(changedAt(it_ as any, [], 2, replies)?.toISOString()).toBe('2026-11-18T10:00:00.000Z');
  });
});

describe('EMAILS (DEF-509)', () => {
  it('ignored and tasked leave (counted); a newer message comes back with task_id; rule-delegated rows stay', () => {
    const e = (id: string, at: string, by?: any) => ({ thread_id: id, from: 'x', subject: id, preview: '', received_at: at, urgency: 'normal', ...(by ? { by_rule: by } : {}) });
    const tasks = new Map([['t-old', { id: 'i1', since: '2026-11-18T10:00:00.000Z' }], ['t-new', { id: 'i2', since: '2026-11-18T10:00:00.000Z' }], ['t-del', { id: 'i3', since: '2026-11-18T10:00:00.000Z' }]]);
    const r = leaveHandled([
      e('t-ign', '2026-11-18T11:00:00+05:00', { action: 'ignored', rule_id: 'r', at: 'x' }),
      e('t-old', '2026-11-18T14:00:00+05:00'),
      e('t-new', '2026-11-18T15:30:00+05:00'),
      e('t-del', '2026-11-18T14:00:00+05:00', { action: 'delegated', rule_id: 'r', at: 'x' }),
      e('t-plain', '2026-11-18T14:00:00+05:00'),
    ] as any, tasks);
    expect(r.emails_hidden).toEqual({ ignored: 1, tasked: 1, calendar: 0 });
    expect(r.emails.map((x) => [x.thread_id, x.task_id])).toEqual([['t-new', 'i2'], ['t-del', undefined], ['t-plain', undefined]]);
  });
});

describe('task context in the note (Suzi 25 Nov 13:19)', () => {
  it('the prompt carries where the task came from and asks for more than the title', () => {
    const p = tellPrompt('Basit', { itemId: 'i1', title: 'Schedule a session', due: null, note: '', person: { name: 'Sofia Rana', email: 's@x.com' }, role: 'followup', origin: 'the meeting "Vision Metrics review" on 2026-11-16' });
    expect(p).toContain('Where this task came from: the meeting "Vision Metrics review" on 2026-11-16');
    expect(p).toContain('Never only the title');
  });
});
