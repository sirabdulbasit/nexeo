/**
 * Suzi Master AGREE (16 Nov 2026): a successful calendar.cancel / update / create stamps suzi_calendar_touch, which
 * /v1/changes reads as "calendar"; a failed op ({ok:false}) stamps nothing. Found by the founder's cancel of
 * "TMC System Catalogues" (10:20:27 UTC), which flagged nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const s = vi.hoisted(() => ({ sql: [] as string[] }));
vi.mock('../src/db/prisma', () => ({ default: { $executeRawUnsafe: async (sql: string) => { s.sql.push(sql); return 1; } } }));
vi.mock('../src/services/suzi/suziPeople', () => ({ personById: async () => null }));
import { runCalendarOp } from '../src/services/suzi/suziCalendar';

const G = { signatureVerified: true, voiceScore: 0.9 } as any;
const ok = async () => ({ ok: true as const, item: { event_id: 'e1' } });
const no = async () => ({ ok: false as const, error: 'not_found' });
beforeEach(() => { s.sql = []; });

describe('calendar ops touch the changes feed', () => {
  for (const op of ['calendar.cancel', 'calendar.update', 'calendar.create']) {
    it(`${op} ok → stamped; failed → not`, async () => {
      expect((await runCalendarOp('T', 2, op, {}, true, G, { update: ok, cancel: ok, create: ok } as any)).ok).toBe(true);
      expect(s.sql.filter((q) => /INSERT INTO suzi_calendar_touch/.test(q))).toHaveLength(1);
      s.sql = [];
      expect((await runCalendarOp('T', 2, op, {}, true, G, { update: no, cancel: no, create: no } as any)).ok).toBe(false);
      expect(s.sql).toHaveLength(0);
    });
  }
  it('an unknown op stamps nothing', async () => {
    expect((await runCalendarOp('T', 2, 'calendar.move', {}, true, G)).ok).toBe(false);
    expect(s.sql).toHaveLength(0);
  });
});
