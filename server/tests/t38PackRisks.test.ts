/**
 * T38 (both AGREE 18 Nov 2026) and T33 helpers' replied_at (both AGREE 18 Nov 15:05). Pinned:
 *  RISKS     the pack's risks[] = his latest radar run's flags, ranked by the radar's rank, at most 12, in the agreed
 *            shape {id, severity, title, reason, suggested_action?, refs[], run_date}; a malformed flag is left out;
 *            no run = [] (and an unreadable radar leaves the field out: dayPack);
 *  REPLIED   a helper's replied_at is their latest reply on the task's threads, matched by address, never by name.
 */
import { describe, it, expect } from 'vitest';
import { toPackRisks, PACK_RISKS_MAX } from '../src/services/suzi/dayPack';
import { packHelpers } from '../src/services/suzi/suziTaskTrail';

describe('RISKS', () => {
  it('ranked, capped, agreed shape', () => {
    const flags = Array.from({ length: 15 }, (_, i) => ({ id: `f${i}`, signal: 'silence', severity: i % 2 ? 'high' : 'low', title: `T${i}`, reason: 'r', sourceRefs: [{ kind: 'open_item', id: 7, label: 'L' }], rank: i / 20, ...(i === 14 ? { suggestedAction: 'Call him' } : {}) }));
    const r = toPackRisks({ flags: [...flags, { id: 'bad', severity: 'urgent', title: 'x' }], runDate: new Date('2026-11-18T00:00:00Z') });
    expect(r).toHaveLength(PACK_RISKS_MAX);
    expect(r[0]).toEqual({ id: 'f14', severity: 'low', title: 'T14', reason: 'r', suggested_action: 'Call him', refs: [{ kind: 'open_item', id: '7', label: 'L' }], run_date: '2026-11-18' });
    expect(r.map((x) => x.id)).not.toContain('bad');
    expect(toPackRisks(null)).toEqual([]);
  });
});

describe('REPLIED', () => {
  it('latest reply by the helper address', () => {
    const meta = { suziHelpers: [{ person_id: 'p2', name: 'Sara Khan', email: 'Sara@x.com', added_at: 'x' }, { person_id: 'p3', name: 'Ali', email: 'ali@x.com', added_at: 'x' }] };
    const replies = [
      { at: '2026-11-18T10:00:00.000Z', who: 'Sara Khan', change: 'reply', from: 'sara@x.com' },
      { at: '2026-11-18T11:00:00.000Z', who: 'Sara Khan', change: 'reply', from: 'sara@x.com' },
      { at: '2026-11-18T12:00:00.000Z', who: 'Ali', change: 'reply', from: 'someone-else@x.com' },
    ];
    expect(packHelpers(meta, replies)).toEqual([
      { person_id: 'p2', name: 'Sara Khan', replied_at: '2026-11-18T11:00:00.000Z' },
      { person_id: 'p3', name: 'Ali' },
    ]);
  });
});
