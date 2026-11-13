import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { get, run } from './db';

const PLAYER_COOKIE = 'pixle_player';
const ADMIN_COOKIE = 'pixle_admin';
const ADMIN_SESSION_HOURS = 12;
const secure = process.env.NODE_ENV === 'production' && process.env.PIXLE_INSECURE_COOKIES !== '1';

// ---------------------------------------------------------------- players

/**
 * Anonymous player identity: a random id in an httpOnly cookie. Game progress is
 * stored server-side against it, so refreshing (or editing local storage) cannot
 * reset a daily attempt.
 */
export async function getPlayerId(create: boolean): Promise<string | null> {
  const jar = await cookies();
  const existing = jar.get(PLAYER_COOKIE)?.value;
  if (existing && /^[a-f0-9]{32}$/.test(existing)) {
    if (get('SELECT 1 FROM players WHERE id = ?', existing)) return existing;
    if (!create) return null;
  }
  if (!create) return null;
  const id = crypto.randomBytes(16).toString('hex');
  run('INSERT INTO players (id, created_at) VALUES (?, ?)', id, new Date().toISOString());
  jar.set(PLAYER_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 60 * 60 * 24 * 400,
  });
  return id;
}

// ---------------------------------------------------------------- admin

export const adminConfigured = () => Boolean(process.env.ADMIN_PASSWORD);

function secret(): string {
  return (
    process.env.SESSION_SECRET ||
    crypto.createHash('sha256').update('pixle-session:' + (process.env.ADMIN_PASSWORD ?? '')).digest('hex')
  );
}

const sign = (payload: string) => crypto.createHmac('sha256', secret()).update(payload).digest('hex');

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export async function loginAdmin(password: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  // Slow down guessing a little.
  await new Promise((resolve) => setTimeout(resolve, 400));
  if (!expected || !safeEqual(password, expected)) return false;
  const expires = Date.now() + ADMIN_SESSION_HOURS * 3600 * 1000;
  const payload = `admin.${expires}`;
  (await cookies()).set(ADMIN_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: ADMIN_SESSION_HOURS * 3600,
  });
  return true;
}

export async function logoutAdmin() {
  (await cookies()).delete(ADMIN_COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  if (!adminConfigured()) return false;
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  const cut = token.lastIndexOf('.');
  if (cut < 0) return false;
  const payload = token.slice(0, cut);
  const expires = Number(payload.split('.')[1]);
  return safeEqual(token.slice(cut + 1), sign(payload)) && Number.isFinite(expires) && expires > Date.now();
}
