/**
 * F-4 Way A "take notes" (16 Nov 2026; shapes sent to suzi-b5 before the deploy):
 *   meeting.attend {event_id, way:"google_transcript"} → {meeting_id, status:"transcribing"} only after Meet's space
 *   transcription is really ON; not hosted → {status:"not_covered", reason:"not_host"}; any failure → {ok:false, error}.
 *   His "always" rule switches on his hosted Meets of the next 48 hours; nothing ever switches a space off.
 *   Pack attend: only his hosted Meets; always = really switched on; never = a never rule; else ask.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const s = vi.hoisted(() => ({ status: [] as any[], recs: [] as any[], nexeoOn: new Set<string>() }));
vi.mock('../src/db/prisma', () => ({ default: {
  user: { findUnique: async () => ({ email: 'me@tmcltd.com', integrationEmail: null }) },
  $queryRawUnsafe: async (sql: string, _u: any, ev: any) => (/nexeo_on/.test(sql) ? [{ on: s.nexeoOn.has(ev) }] : s.recs),
  $executeRawUnsafe: async (sql: string, _u: any, ev: string) => { if (/\|\| jsonb_build_object/.test(sql)) s.nexeoOn.add(ev); else if (/- \$2/.test(sql)) s.nexeoOn.delete(ev); return 1; },
} }));
vi.mock('../src/services/meetings/meetingRecordStore', () => ({
  keyForEvent: (id: string) => `event:${id}`,
  setStatus: async (_c: string, _u: number, key: string, status: string, base: any) => { s.status.push({ key, status, base }); return { id: `mtg_${key}`, status }; },
}));
vi.mock('../src/services/meetings/meetTranscripts', () => ({
  meetingCodeOf: (l?: string | null) => (l ? l.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/)?.[1] ?? null : null),
  meetFor: async () => null,
}));
vi.mock('../src/services/suzi/suziMeetingRules', async (orig) => {
  const real: any = await orig();
  return { ...real, meetingAttendRules: async () => s.rules };
});
(s as any).rules = [];

import { attendEvent, leaveEvent, transcriptionOn, autoAttend, TRANSCRIPTION_MASK } from '../src/services/meetings/meetAttend';
import { attendOf } from '../src/services/suzi/dayPack';

function fakeMeet(state: 'ON' | 'OFF', opts: { patchFails?: string } = {}) {
  const calls: any[] = [];
  return { calls, spaces: {
    get: async ({ name }: any) => { calls.push(['get', name]); return { data: { name: 'spaces/abc', config: { artifactConfig: { transcriptionConfig: { autoTranscriptionGeneration: state } } } } }; },
    patch: async (a: any) => { calls.push(['patch', a]); if (opts.patchFails) throw new Error(opts.patchFails); return { data: {} }; },
  } };
}
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const ev = (o: Partial<any> = {}) => ({ id: 'e1', title: 'TMC System Catalogues', start: later(1), end: later(2), organizer: 'me@tmcltd.com', link: 'https://meet.google.com/hmx-tjqd-wcd', ...o });

beforeEach(() => { s.status = []; s.recs = []; s.nexeoOn = new Set(); (s as any).rules = []; });

describe('meeting.attend Way A', () => {
  it('hosted, OFF → patches transcription ON with the exact mask, then transcribing', async () => {
    const meet = fakeMeet('OFF');
    const r: any = await attendEvent('TMC-0001', 2, ev(), { meet, own: ['me@tmcltd.com'] });
    expect(r).toEqual({ ok: true, item: { meeting_id: 'mtg_event:e1', status: 'transcribing' } });
    const patch = meet.calls.find((c) => c[0] === 'patch')[1];
    expect(patch.updateMask).toBe(TRANSCRIPTION_MASK);
    expect(patch.requestBody.config.artifactConfig.transcriptionConfig.autoTranscriptionGeneration).toBe('ON');
    expect(s.status.map((x) => x.status)).toEqual(['transcribing']);
  });
  it('already ON → no patch, still transcribing', async () => {
    const meet = fakeMeet('ON');
    expect(await transcriptionOn(meet, 'hmx-tjqd-wcd')).toBe('already_on');
    expect(meet.calls.some((c) => c[0] === 'patch')).toBe(false);
  });
  it('not hosted → not_covered with reason not_host; Meet never touched', async () => {
    const meet = fakeMeet('OFF');
    const r: any = await attendEvent('TMC-0001', 2, ev({ organizer: 'other@tmcltd.com' }), { meet, own: ['me@tmcltd.com'] });
    expect(r.item).toEqual({ meeting_id: 'mtg_event:e1', status: 'not_covered', reason: 'not_host' });
    expect(meet.calls).toHaveLength(0);
  });
  it('a Meet failure is an error, never a promise: no record made', async () => {
    const r1: any = await attendEvent('TMC-0001', 2, ev(), { meet: fakeMeet('OFF', { patchFails: 'Request had insufficient authentication scopes' }), own: ['me@tmcltd.com'] });
    expect(r1).toMatchObject({ ok: false, error: 'needs_reconnect' });
    const r2: any = await attendEvent('TMC-0001', 2, ev(), { meet: fakeMeet('OFF', { patchFails: 'backend error' }), own: ['me@tmcltd.com'] });
    expect(r2).toMatchObject({ ok: false, error: 'meet_failed' });
    expect(s.status).toHaveLength(0);
  });
  it('no Meet link / ended → errors', async () => {
    expect(await attendEvent('TMC-0001', 2, ev({ link: 'https://zoom.us/j/1' }), { meet: fakeMeet('OFF'), own: ['me@tmcltd.com'] })).toMatchObject({ ok: false, error: 'not_meet' });
    expect(await attendEvent('TMC-0001', 2, ev({ start: later(-3), end: later(-2) }), { meet: fakeMeet('OFF'), own: ['me@tmcltd.com'] })).toMatchObject({ ok: false, error: 'ended' });
  });
});

describe('meeting.leave Way A (his single-meeting never)', () => {
  it('Nexeo switched it on → switched back OFF, not_covered his_choice, quiet; attend again wins', async () => {
    const meet = fakeMeet('OFF');
    await attendEvent('TMC-0001', 2, ev(), { meet, own: ['me@tmcltd.com'] });
    expect(s.nexeoOn.has('e1')).toBe(true);
    const on = fakeMeet('ON');
    const r: any = await leaveEvent('TMC-0001', 2, ev(), { meet: on, own: ['me@tmcltd.com'] });
    expect(r).toEqual({ ok: true, item: { meeting_id: 'mtg_event:e1', status: 'not_covered' } });
    const patch = on.calls.find((c) => c[0] === 'patch')[1];
    expect(patch.requestBody.config.artifactConfig.transcriptionConfig.autoTranscriptionGeneration).toBe('OFF');
    expect(s.status.at(-1)).toMatchObject({ status: 'not_covered', base: { reason: 'his_choice', quiet: true } });
    expect(s.nexeoOn.has('e1')).toBe(false);
  });
  it('he switched it on in Meet himself → the space is left alone, still no record', async () => {
    const on = fakeMeet('ON');
    const r: any = await leaveEvent('TMC-0001', 2, ev(), { meet: on, own: ['me@tmcltd.com'] });
    expect(r.item.status).toBe('not_covered');
    expect(on.calls).toHaveLength(0);
  });
  it('a failed switch-off is an error, not a silent success', async () => {
    s.nexeoOn.add('e1');
    const r: any = await leaveEvent('TMC-0001', 2, ev(), { meet: fakeMeet('ON', { patchFails: 'backend error' }), own: ['me@tmcltd.com'] });
    expect(r).toMatchObject({ ok: false, error: 'meet_failed' });
    expect(s.status).toHaveLength(0);
  });
});

describe('always rules and the pack attend', () => {
  const always = { id: 'uar_a', by: 'title', value: 'catalogues', attend: 'always' };
  const never = { id: 'uar_n', by: 'title', value: 'payroll', attend: 'never' };
  it('autoAttend applies an always rule to a hosted Meet within 48h; skips chosen, far, not hosted, never', async () => {
    (s as any).rules = [always, never];
    const meetCalls: string[] = [];
    vi.spyOn(await import('../src/services/meetings/meetTranscripts'), 'meetFor').mockImplementation(async () => { const m = fakeMeet('OFF'); return { spaces: { ...m.spaces, patch: async (a: any) => { meetCalls.push(a.name); return {}; } } }; });
    const n = await autoAttend('TMC-0001', 2, [
      ev(), ev({ id: 'e2', title: 'ECP Payroll' }), ev({ id: 'e3', start: later(60), end: later(61) }), ev({ id: 'e4', organizer: 'x@tmcltd.com' }),
    ] as any, ['me@tmcltd.com']);
    expect(n).toBe(1);
    expect(s.status.map((x) => x.key)).toEqual(['event:e1']);
    expect(meetCalls).toHaveLength(1);
  });
  it('pack: always only when really switched on; never from a never rule; else ask; nothing on others', () => {
    const codeOf = (l?: string | null) => (l && l.includes('meet.google.com') ? 'x' : null);
    const f = attendOf([always, never] as any, new Map([['e1', 'always'], ['e7', 'never']]) as any, codeOf);
    const link = 'https://meet.google.com/hmx-tjqd-wcd';
    expect(f({ title: 'TMC System Catalogues' }, 'e1', true, link)).toEqual({ decision: 'always', rule_id: 'uar_a' });
    expect(f({ title: 'TMC System Catalogues' }, 'e9', true, link)).toEqual({ decision: 'ask' }); // rule matched, not applied yet
    expect(f({ title: 'ECP Payroll' }, 'e2', true, link)).toEqual({ decision: 'never', rule_id: 'uar_n' });
    expect(f({ title: 'Other' }, 'e5', true, link)).toEqual({ decision: 'ask' });
    expect(f({ title: 'TMC System Catalogues' }, 'e7', true, link)).toEqual({ decision: 'never' }); // his leave beats an always rule
    expect(f({ title: 'TMC System Catalogues' }, 'e1', false, link)).toBeUndefined();
    expect(f({ title: 'TMC System Catalogues' }, 'e1', true, 'https://zoom.us/j/1')).toBeUndefined();
  });
});
