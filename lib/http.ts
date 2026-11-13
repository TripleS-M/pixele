import fs from 'node:fs';
import { NextResponse } from 'next/server';
import { AdminError } from './admin';
import { isAdmin } from './auth';
import { GameError } from './game';

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

/** Wraps a route handler: turns known errors into JSON responses. */
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GameError) return json({ error: err.message, code: err.code }, err.status);
    if (err instanceof AdminError) return json({ error: err.message }, err.status);
    console.error('[pixle] Request failed:', err);
    return json({ error: 'Something went wrong on the server.' }, 500);
  }
}

/** Same as handle(), but only for a signed-in admin. */
export async function adminOnly(fn: () => Promise<Response> | Response): Promise<Response> {
  if (!(await isAdmin())) return json({ error: 'Admin sign-in required.' }, 401);
  return handle(fn);
}

export function sendImage(file: string, cacheControl: string): Response {
  if (!fs.existsSync(file)) return json({ error: 'Image not found.' }, 404);
  const type = file.endsWith('.png') ? 'image/png' : 'image/webp';
  return new Response(new Uint8Array(fs.readFileSync(file)), {
    headers: { 'Content-Type': type, 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff' },
  });
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
