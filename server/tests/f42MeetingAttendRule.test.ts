/**
 * F-4.2 (charter, agreed 13 Nov 2026): rule.set kind meeting_attend, stored in his one rule store with a readable
 * line, folded when set twice, and the matcher: never beats always, a single-meeting choice beats both, the
 * oldest of two equal rules is reported, all = every event with a join link.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const s = vi.hoisted(() => ({ same: [] as any[], exec: [] as any[][], rebuilt: 0 }));
vi.mock('../src/db/prisma', () => ({ default: {
  $queryRawUnsafe: async () => s.same,
  $executeRawUnsafe: async (...a: any[]) => { s.exec.push(a); return 1; },
} }));
vi.mock('../src/services/suzi/suziRules', () => ({ rulesDocument: async () => ({ rules_version: 7 }) }));
vi.mock('../src/services/wiki/wikiRuleNotes', () => ({ rebuildRuleNotesForUser: async () => { s.rebuilt++; return {}; } }));

import { ruleSet } from '../src/services/suzi/suziEmailRules';
import { meetingAttendFor, meetingRuleText, type MeetingAttendRule } from '../src/services/suzi/suziMeetingRules';

beforeEach(() => { s.same = []; s.exec = []; s.rebuilt = 0; });

describe('F-4.2 rule.set meeting_attend', () => {
  it('needs his confirmation', async () => {
    expect(await ruleSet('TMC-0001', 2, { kind: 'meeting_attend', match: { by: 'all' }, attend: 'always' }, false)).toEqual({ ok: false, error: 'needs_confirmation' });
  });
  it('stores one DRAFT, manual-trigger rule with a readable line, and refreshes the Wiki note', async () => {
    const r: any = await ruleSet('TMC-0001', 2, { kind: 'meeting_attend', match: { by: 'organizer', value: ' Sofia.Rana@TMCLTD.com ' }, attend: 'always' }, true);
    expect(r.ok).toBe(true);
    expect(r.item).toMatchObject({ kind: 'meeting_attend', match: { by: 'organizer', value: 'sofia.rana@tmcltd.com' }, attend: 'always', text: 'Meetings organised by sofia.rana@tmcltd.com: always take notes', rules_version: 7 });
    expect(r.item.existing).toBeUndefined();
    const [sql, , , , name, nl, cond, type, payload] = s.exec[0];
    expect(sql).toMatch(/'manual'/); expect(sql).toMatch(/'DRAFT'/);
    expect(name).toBe('Meetings organised by sofia.rana@tmcltd.com: always take notes'); expect(nl).toBe(name);
    expect(JSON.parse(cond)).toEqual({ meeting: 'organizer', value: 'sofia.rana@tmcltd.com' });
    expect(type).toBe('suzi_meeting_attend');
    expect(JSON.parse(payload)).toEqual({ suzi: { kind: 'meeting_attend', by: 'organizer', value: 'sofia.rana@tmcltd.com', attend: 'always' } });
    await new Promise((r) => setTimeout(r, 0)); expect(s.rebuilt).toBe(1);
  });
  it('the same match again folds into his rule: existing:true, same id', async () => {
    s.same = [{ id: 'uar_old' }];
    const r: any = await ruleSet('TMC-0001', 2, { kind: 'meeting_attend', match: { by: 'title', value: 'Weekly  Sync' }, attend: 'never', note: 'internal' }, true);
    expect(r.item).toMatchObject({ rule_id: 'uar_old', existing: true, text: 'Meetings with "weekly sync" in the title: never take notes' });
    expect(s.exec[0][0]).toMatch(/^UPDATE/); expect(s.exec[0][3]).toBe('Meetings with "weekly sync" in the title: never take notes. internal');
  });
  it('bad shapes are refused', async () => {
    for (const a of [{ match: { by: 'host', value: 'x' }, attend: 'always' }, { match: { by: 'all' }, attend: 'sometimes' }, { match: { by: 'organizer', value: 'sofia' }, attend: 'always' }, { match: { by: 'title' }, attend: 'never' }]) {
      const r: any = await ruleSet('TMC-0001', 2, { kind: 'meeting_attend', ...a }, true);
      expect(r).toMatchObject({ ok: false, error: 'bad_rule' });
    }
    expect(s.exec).toHaveLength(0);
  });
  it('all needs no value', () => { expect(meetingRuleText('all', undefined, 'always')).toBe('Every meeting with a join link: always take notes'); });
});

describe('F-4.2 matching', () => {
  const R = (id: string, by: any, value: string | undefined, attend: any): MeetingAttendRule => ({ id, by, ...(value ? { value } : {}), attend });
  const ev = { title: ' Weekly SYNC with Ops ', organizer: 'Sofia.Rana@tmcltd.com', attendees: ['basit.ahmed@tmcltd.com', 'Kashif@TMCLTD.com'], hasJoinLink: true };
  it('no rule: ask', () => { expect(meetingAttendFor([], ev)).toEqual({ decision: 'ask' }); });
  it('title contains, organizer and attendee by exact email, all by join link', () => {
    expect(meetingAttendFor([R('a', 'title', 'weekly sync', 'always')], ev)).toEqual({ decision: 'always', rule_id: 'a' });
    expect(meetingAttendFor([R('a', 'organizer', 'sofia.rana@tmcltd.com', 'always')], ev).rule_id).toBe('a');
    expect(meetingAttendFor([R('a', 'organizer', 'rana@tmcltd.com', 'always')], ev).decision).toBe('ask');
    expect(meetingAttendFor([R('a', 'attendee', 'kashif@tmcltd.com', 'always')], ev).rule_id).toBe('a');
    expect(meetingAttendFor([R('a', 'all', undefined, 'always')], { ...ev, hasJoinLink: false }).decision).toBe('ask');
  });
  it('never beats always; oldest of equals; his choice beats both', () => {
    const rules = [R('old', 'all', undefined, 'always'), R('mid', 'title', 'sync', 'never'), R('new', 'organizer', 'sofia.rana@tmcltd.com', 'never')];
    expect(meetingAttendFor(rules, ev)).toEqual({ decision: 'never', rule_id: 'mid' });
    expect(meetingAttendFor(rules, { ...ev, choice: 'always' })).toEqual({ decision: 'always' });
  });
});
