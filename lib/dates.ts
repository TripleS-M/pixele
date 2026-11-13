import { getConfig } from './config';

/** Today's date (YYYY-MM-DD) in the configured puzzle timezone. Always decided by the server. */
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: getConfig().timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Seconds until the next puzzle (midnight in the puzzle timezone). */
export function secondsUntilTomorrow(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: getConfig().timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Math.max(1, 86400 - (get('hour') * 3600 + get('minute') * 60 + get('second')));
}

export const isDateString = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

const toDays = (d: string) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);

export const daysBetween = (from: string, to: string) => toDays(to) - toDays(from);

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}
