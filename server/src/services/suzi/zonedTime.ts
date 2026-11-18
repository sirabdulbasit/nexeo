/** ISO 8601 in `tz`, with its offset: 2026-11-04T15:00:00+05:00. */
export function toZonedIso(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const off = get('timeZoneName').replace('GMT', '') || '+00:00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${off}`;
}

/** The UTC instant his local day (YYYY-MM-DD) starts at, in his zone. Null for a malformed day. */
export function localDayStart(day: string, tz: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const guess = Date.parse(`${day}T00:00:00Z`);
  if (isNaN(guess)) return null;
  const offsetAt = (ms: number) => Date.parse(`${toZonedIso(new Date(ms), tz).slice(0, 19)}Z`) - ms; // zone minus UTC
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t); // once more, for a day a clock change crosses
  return new Date(t);
}
