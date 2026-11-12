/**
 * DEF-441 — the employee directory's document shows a sample record with "id": 101, so
 * "how a record is identified" was set to "id"; the real API sends no "id" in any of its
 * 1,111 records (it has email and personalNo). Every knowledge row was then set aside at
 * proposal time with nothing at Connect saying why. vm: "identity is measured, not
 * guessed". measureIdentity reports a missing id field and the fields that are filled
 * and unique in every record.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/utils/logger', () => ({
  __esModule: true,
  default: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
vi.mock('../src/db/prisma', () => ({ __esModule: true, default: {} }));

import { measureIdentity } from '../src/services/integrations/sources/apiReader';

const people = [
  { name: 'A One', email: 'a@x.com', personalNo: 'E-1', businessUnit: 'TMC', reportsToId: null, directReports: [{ n: 1 }] },
  { name: 'B Two', email: 'b@x.com', personalNo: 'E-2', businessUnit: 'TMC', reportsToId: 'E-1', directReports: [] },
  { name: 'C Three', email: 'c@x.com', personalNo: 'E-3', businessUnit: 'Xnrel', reportsToId: 'E-1', directReports: [] },
];

describe('DEF-441 the record identifier is measured', () => {
  it('names a configured id field that no record has, with the usable fields', () => {
    expect(measureIdentity(people, 'id')).toEqual({ field: 'id', records: 3, candidates: ['name', 'email', 'personalNo'] });
  });

  it('a field filled in only some records is not a candidate; repeated values are not either', () => {
    const c = measureIdentity(people, 'id')!.candidates;
    expect(c).not.toContain('reportsToId'); // blank in one record
    expect(c).not.toContain('businessUnit'); // "TMC" twice
    expect(c).not.toContain('directReports'); // not a single value
  });

  it('says nothing when the field is present in any record', () => {
    expect(measureIdentity(people, 'email')).toBeNull();
    expect(measureIdentity([{ id: '' }, { id: 7 }], 'id')).toBeNull();
  });

  it('reads a dotted id field', () => {
    expect(measureIdentity([{ meta: { uid: 'u1' } }], 'meta.uid')).toBeNull();
  });

  it('says nothing with no id field set or no records', () => {
    expect(measureIdentity(people, null)).toBeNull();
    expect(measureIdentity([], 'id')).toBeNull();
  });

  it('uniqueness ignores case and surrounding spaces', () => {
    expect(measureIdentity([{ e: 'A@x.com' }, { e: ' a@x.com' }], 'id')!.candidates).toEqual([]);
  });
});
