/**
 * D-335: a person shown once (founder 27 Nov 13:05), emails marked read in Gmail (14:1x), task titles in English
 * (his rule "Urdu spoken, English shown"; Suzi-Builder 16:13).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), exec: vi.fn(), find: vi.fn(), update: vi.fn() }));
vi.mock('../src/db/prisma', () => ({ default: { $queryRawUnsafe: db.query, $executeRawUnsafe: db.exec, openItem: { findFirst: db.find, update: db.update } } }));
const gmail = vi.hoisted(() => ({ markThreadRead: vi.fn() }));
vi.mock('../src/services/gmailService', () => gmail);
const log = vi.hoisted(() => ({ audit: vi.fn(async () => undefined) }));
vi.mock('../src/services/auditLogService', () => log);
const trail = vi.hoisted(() => ({ push: vi.fn(async () => undefined) }));
vi.mock('../src/services/suzi/suziTaskTrail', () => ({ trailPush: trail.push }));

import { onePerPerson } from '../src/services/suzi/suziPeople';
import { looksNonEnglish, toEnglish, englishTask, sweepEnglishTitles } from '../src/services/suzi/englishTitle';
import { runEmailOp, markReadInGmail } from '../src/services/suzi/suziEmail';
import { SYSTEM } from '../src/services/suzi/assistantReasoner';

beforeEach(() => { for (const f of [db.query, db.exec, db.find, db.update, gmail.markThreadRead, log.audit, trail.push]) f.mockReset(); });

describe('D-335 one person once', () => {
  it('the same colleague at three company addresses is one person, at his own domain', () => {
    const out = onePerPerson([
      { id: 'a', name: 'Salman Sohail', email: 'salman.sohail@tmcltd.ai' },
      { id: 'b', name: 'Salman Sohail', email: 'salman.sohail@tmcltd.com' },
      { id: 'c', name: 'Salman Sohail', email: 'salman.sohail@tmcloud.net' },
      { id: 'd', name: 'Salman Younus', email: 'salman.younus@tmcltd.com' },
    ], 'tmcltd.com');
    expect(out).toEqual([{ id: 'b', name: 'Salman Sohail', email: 'salman.sohail@tmcltd.com' }, { id: 'd', name: 'Salman Younus', email: 'salman.younus@tmcltd.com' }]);
  });
  it('a record with no address folds into the one that has it; two real people with one name both stay', () => {
    expect(onePerPerson([{ id: 'a', name: 'Asad Khan' }, { id: 'b', name: 'asad  khan', email: 'asad@x.com', phone: '1' }], 'x.com')).toEqual([{ id: 'b', name: 'asad  khan', email: 'asad@x.com', phone: '1' }]);
    expect(onePerPerson([{ id: 'a', name: 'Ali Raza', email: 'ali.raza@x.com' }, { id: 'b', name: 'Ali Raza', email: 'araza@vendor.com' }], 'x.com')).toHaveLength(2);
    expect(onePerPerson([{ id: 'a', name: 'Ali Raza', email: 'ali@vendor.com' }, { id: 'b', name: 'Ali Raza', email: 'ali@other.com' }], 'x.com')[0].id).toBe('a');
  });
});

describe('D-335 titles in English', () => {
  it('knows Urdu script and Roman Urdu from English', () => {
    expect(looksNonEnglish('iMEX import/export solution ki testing complete karni hai')).toBe(true);
    expect(looksNonEnglish('Salman ko invoice bhejna hai')).toBe(true);
    expect(looksNonEnglish('انوائس بھیجنی ہے')).toBe(true);
    for (const t of ['Complete testing for Pro Plan', 'Review SAP Compliance Agent concept', 'Pay Tridorian Invoice', 'Call Ki Hoon about the main plan', 'Follow up with Hai Nguyen']) expect(looksNonEnglish(t)).toBe(false);
  });
  it('the model words the English; an answer that is still Urdu, empty or the same is not used', async () => {
    expect(await toEnglish('T', 2, 'iMEX import/export solution ki testing complete karni hai', 200, async () => '"Complete the testing of the iMEX import/export solution"')).toBe('Complete the testing of the iMEX import/export solution');
    expect(await toEnglish('T', 2, 'Salman ko invoice bhejna hai', 200, async () => 'Salman ko invoice bhejna hai')).toBeNull();
    expect(await toEnglish('T', 2, 'Salman ko invoice bhejna hai', 200, async () => '')).toBeNull();
    expect(await toEnglish('T', 2, 'Salman ko invoice bhejna hai', 200, async () => { throw new Error('down'); })).toBeNull();
    const never = vi.fn(async () => 'x');
    expect(await toEnglish('T', 2, 'Pay Tridorian Invoice', 200, never)).toBeNull();
    expect(never).not.toHaveBeenCalled();
  });
  it('a task is renamed with the old words kept in its history; the sweep finds only the ones that need it', async () => {
    db.find.mockResolvedValue({ id: 't1', title: 'iMEX import/export solution ki testing complete karni hai', metadata: {} });
    const r = await englishTask('T', 2, 't1', async () => 'Complete the testing of the iMEX import/export solution');
    expect(r).toEqual({ renamed: true, title: 'Complete the testing of the iMEX import/export solution' });
    expect(db.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { title: 'Complete the testing of the iMEX import/export solution' } });
    expect(trail.push).toHaveBeenCalledWith('t1', expect.objectContaining({ who: 'Nexeo', change: 'Renamed', note: expect.stringContaining('ki testing complete karni hai → Complete the testing') }));
    db.update.mockClear();
    db.query.mockResolvedValue([{ id: 't1', title: 'Salman ko invoice bhejna hai', context: null }, { id: 't2', title: 'Pay Tridorian Invoice', context: null }]);
    db.find.mockResolvedValue({ id: 't1', title: 'Salman ko invoice bhejna hai', metadata: {} });
    expect(await sweepEnglishTitles('T', 2, async () => 'Send the invoice to Salman')).toEqual({ looked: 1, renamed: 1 });
    expect(db.update).toHaveBeenCalledTimes(1);
  });
  it('the assistant step is told to write titles in English', () => {
    expect(SYSTEM).toMatch(/short imperative in English/);
  });
});

describe('D-335 marked read in Gmail', () => {
  it('email.mark read: only Gmail, with the Gmail thread, and one audit row', async () => {
    db.query.mockResolvedValue([{ gthread: 'g-thread-1' }]);
    gmail.markThreadRead.mockResolvedValue({ success: true });
    const r: any = await runEmailOp('T', 2, 'email.mark', { thread_id: 'fe1', state: 'read' }, false);
    expect(r).toEqual({ ok: true, item: { thread_id: 'fe1', state: 'read', gmail: true } });
    expect(gmail.markThreadRead).toHaveBeenCalledWith(2, 'g-thread-1');
    expect(log.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'suzi.email.marked_read', result: 'success', details: { why: 'read' } }));
    expect(db.exec).not.toHaveBeenCalled(); // nothing else changes
  });
  it('an unknown thread is not found; a Gmail refusal is said with its reason, never thrown', async () => {
    db.query.mockResolvedValue([]);
    expect(await runEmailOp('T', 2, 'email.mark', { thread_id: 'nope', state: 'read' }, false)).toMatchObject({ ok: false, error: 'not_found' });
    expect(gmail.markThreadRead).not.toHaveBeenCalled();
    db.query.mockResolvedValue([{ gthread: 'g1' }]);
    gmail.markThreadRead.mockResolvedValue({ success: false, error: 'Mark-read failed: Insufficient Permission' });
    const r = await markReadInGmail('T', 2, 'g1', 'handled');
    expect(r).toEqual({ found: true, ok: false, error: 'Mark-read failed: Insufficient Permission' });
    expect(log.audit).toHaveBeenCalledWith(expect.objectContaining({ result: 'failure' }));
  });
});
