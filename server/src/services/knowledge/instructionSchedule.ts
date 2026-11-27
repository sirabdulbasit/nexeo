/**
 * Link T41 round 9 (Suzi proposed 23 Nov 11:56, Nexeo AGREE 13:06 PKT): a standing instruction can say WHEN.
 *
 * "Clear caches every Friday" is a standing instruction, but nothing in its words tells the desktop when to run it.
 * The schedule is one optional, exact field on the instruction, set only when he says when:
 *
 *   {every: "day" | "week" | "month", on?: "mon".."sun" (week) | 1..28 (month), at?: "HH:MM" (the computer's own time)}
 *   {once: "<ISO date-time with offset>"}   (T50, 27 Nov: a one-off; runs once, is recorded, then leaves jobs[])
 *
 * Nexeo keeps it; Suzi runs it on the Mac (only while the Mac is on and he is not in a meeting) and reports the run
 * as `operator.report` with job `scheduled`. Nexeo never runs it and never invents one.
 */
export const SCHEDULE_EVERY = ['day', 'week', 'month'] as const;
export const SCHEDULE_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** A repeating schedule, or (T50, Suzi's condition 1, 27 Nov) a one-off: `{once: "<ISO date-time with offset>"}`. */
export type InstructionSchedule =
  | { every: (typeof SCHEDULE_EVERY)[number]; on?: (typeof SCHEDULE_DAYS)[number] | number; at?: string; once?: undefined }
  | { once: string; every?: undefined; on?: undefined; at?: undefined };

const KEYS = new Set(['every', 'on', 'at']);
/** A one-off must say its instant exactly: date, time and offset (or Z). A bare local time would be a guess. */
const ONCE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * The one reader of a schedule, for what arrives (Suzi's op) and what is stored (a page's metadata).
 * Returns the clean schedule, or null when it is not exactly one of the agreed shapes.
 */
export function parseSchedule(v: unknown): InstructionSchedule | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const s = v as Record<string, unknown>;
  if ('once' in s) {
    if (Object.keys(s).length !== 1 || typeof s.once !== 'string' || !ONCE.test(s.once) || isNaN(Date.parse(s.once))) return null;
    return { once: s.once };
  }
  if (Object.keys(s).some((k) => !KEYS.has(k))) return null;
  if (!(SCHEDULE_EVERY as readonly unknown[]).includes(s.every)) return null;
  const every = s.every as (typeof SCHEDULE_EVERY)[number];
  const out: { every: (typeof SCHEDULE_EVERY)[number]; on?: (typeof SCHEDULE_DAYS)[number] | number; at?: string } = { every };

  if (every === 'day') {
    if (s.on !== undefined) return null;
  } else if (every === 'week') {
    if (s.on !== undefined) {
      if (!(SCHEDULE_DAYS as readonly unknown[]).includes(s.on)) return null;
      out.on = s.on as (typeof SCHEDULE_DAYS)[number];
    }
  } else if (s.on !== undefined) {
    if (typeof s.on !== 'number' || !Number.isInteger(s.on) || s.on < 1 || s.on > 28) return null;
    out.on = s.on;
  }

  if (s.at !== undefined) {
    if (typeof s.at !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.at)) return null;
    out.at = s.at;
  }
  return out;
}

/**
 * The words on the instruction's Wiki page, so My Rules, Brain and the page say the same thing. T50: a job Nexeo runs
 * is in his time zone; one the Mac runs is in the computer's own time (`where` says which; the default is as before).
 */
export function describeSchedule(s: InstructionSchedule, where: 'mac' | 'nexeo' = 'mac'): string {
  if (s.once !== undefined) return `once at ${s.once}`;
  const on = s.on === undefined ? '' : s.every === 'month' ? ` on day ${s.on}` : ` on ${s.on}`;
  return `every ${s.every}${on}${s.at ? ` at ${s.at}` : ''} (${where === 'nexeo' ? 'his time zone' : "the computer's own time"})`;
}

const LINE = /^\*\*Schedule:\*\* .*$/m;

/** Put the schedule line on the page body, replace it, or take it off (null). */
export function withScheduleLine(body: string, s: InstructionSchedule | null, where: 'mac' | 'nexeo' = 'mac'): string {
  const line = s ? `**Schedule:** ${describeSchedule(s, where)}` : '';
  if (LINE.test(body)) return s ? body.replace(LINE, line) : body.replace(/^\*\*Schedule:\*\* .*\n?/m, '');
  if (!s) return body;
  const at = body.indexOf('\n\n## Original text');
  return at >= 0 ? `${body.slice(0, at)}\n${line}${body.slice(at)}` : `${body}\n${line}`;
}
