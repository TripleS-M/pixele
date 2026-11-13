import { AdminError, clearSchedule, listSchedule, setSchedule } from '@/lib/admin';
import { getConfig } from '@/lib/config';
import { isDateString, today } from '@/lib/dates';
import { adminOnly, json, readBody } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = (request: Request) =>
  adminOnly(async () => {
    const q = new URL(request.url).searchParams;
    const from = q.get('from');
    const to = q.get('to');
    if (!isDateString(from) || !isDateString(to)) throw new AdminError(400, 'Provide from and to dates.');
    return json({ entries: listSchedule(from, to), today: today(), timezone: getConfig().timezone });
  });

export const PUT = (request: Request) =>
  adminOnly(async () => {
    const body = await readBody(request);
    setSchedule(body.date, body.assetId);
    return json({ ok: true });
  });

export const DELETE = (request: Request) =>
  adminOnly(async () => {
    const body = await readBody(request);
    clearSchedule(body.date);
    return json({ ok: true });
  });
