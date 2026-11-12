/**
 * F-4 Way A, gap from the founder's first live test (12 Nov 19:11 PKT, reported by tmcai-10): an INSTANT Meet has no
 * calendar event, so a poller that walks only calendar events can never pick it up. Pinned:
 *  - a conference of his that ended 15 minutes to 24 hours ago with no finished record is processed;
 *  - one already finished (record_ready / not_covered) is not read again;
 *  - one that ended less than 15 minutes ago waits for the next sweep.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn(async () => [] as any[]);
vi.mock('../src/db/prisma', () => ({ default: { $queryRawUnsafe: (...a: any[]) => (query as any)(...a), $executeRawUnsafe: async () => 1 } }));
const confs = vi.fn();
vi.mock('../src/services/meetings/meetTranscripts', async (orig) => ({
  ...(await (orig as any)()), meetFor: async () => ({}), recentConferences: (...a: any[]) => confs(...a),
}));
const processConf = vi.fn(async () => 'record_ready');
vi.mock('../src/services/meetings/meetingProcessor', async (orig) => ({ ...(await (orig as any)()), processConferenceForUser: (...a: any[]) => (processConf as any)(...a) }));

import { pollConferences } from '../src/jobs/meetPollJob';

const now = new Date('2026-11-12T15:00:00Z');
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
beforeEach(() => { query.mockReset(); query.mockResolvedValue([]); confs.mockReset(); processConf.mockClear(); });

describe('instant Meets are found without a calendar event', () => {
  it('processes a finished conference with no record; skips a finished record and a too-recent one', async () => {
    confs.mockResolvedValue([
      { name: 'conferenceRecords/instant', space: 'spaces/T06', startTime: ago(60), endTime: ago(40) },
      { name: 'conferenceRecords/done', space: 'spaces/X', startTime: ago(120), endTime: ago(100) },
      { name: 'conferenceRecords/justEnded', space: 'spaces/Y', startTime: ago(20), endTime: ago(5) },
      { name: 'conferenceRecords/ongoing', space: 'spaces/Z', startTime: ago(10) },
    ]);
    query.mockResolvedValue([{ conference_record: 'conferenceRecords/done' }]);
    const n = await pollConferences({ clientNumber: 'T', userId: 2 }, now);
    expect(n).toBe(1);
    expect(processConf).toHaveBeenCalledWith('T', 2, 'conferenceRecords/instant');
    // looks back 24 hours
    expect((confs.mock.calls[0] as any[])[1].toISOString()).toBe(new Date(now.getTime() - 24 * 60 * 60_000).toISOString());
  });
});

describe('a meeting with no calendar event gets a title', () => {
  it('"Meet at HH:MM" in his zone until the model names it', async () => {
    vi.doMock('../src/services/userTimezoneService', () => ({ resolveUserTimezone: async () => 'Asia/Karachi' }));
    const { fallbackTitle, FALLBACK_TITLE } = await vi.importActual<any>('../src/services/meetings/meetingProcessor');
    const t = await fallbackTitle(2, new Date('2026-11-12T14:11:00Z'));
    expect(t).toBe('Meet at 19:11');
    expect(FALLBACK_TITLE.test(t)).toBe(true);
    expect(FALLBACK_TITLE.test('Weekly SAP sync')).toBe(false);
  });
});
