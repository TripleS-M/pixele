import { adminConfigured, loginAdmin, logoutAdmin } from '@/lib/auth';
import { handle, json, readBody } from '@/lib/http';

export const POST = (request: Request) =>
  handle(async () => {
    if (!adminConfigured()) {
      return json({ error: 'No admin password is set. Add ADMIN_PASSWORD to .env.local and restart.' }, 503);
    }
    const body = await readBody(request);
    const ok = await loginAdmin(String(body.password ?? ''));
    return ok ? json({ ok: true }) : json({ error: 'Access denied. Wrong password.' }, 401);
  });

export const DELETE = () =>
  handle(async () => {
    await logoutAdmin();
    return json({ ok: true });
  });
