import type { AdminAsset } from '@/lib/admin';

export type { AdminAsset };

/** fetch() for the admin API: sends you back to the login screen if the session has expired. */
export async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const options: RequestInit = { cache: 'no-store', ...init };
  if (init && 'json' in init) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(init.json);
  }
  const res = await fetch(url, options);
  if (res.status === 401) {
    window.location.href = '/admin/login';
    throw new Error('Session expired.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data as T;
}

export const thumbUrl = (id: string) => `/api/admin/assets/${id}/image/thumb`;

export function statusBadges(a: AdminAsset): { text: string; kind: '' | 'solid' | 'warn' }[] {
  const out: { text: string; kind: '' | 'solid' | 'warn' }[] = [];
  if (a.fileMissing) out.push({ text: 'File missing', kind: 'warn' });
  if (a.status === 'archived') out.push({ text: 'Archived', kind: '' });
  else if (a.status === 'approved') out.push({ text: 'Approved', kind: 'solid' });
  else out.push({ text: a.needsConfig ? 'Needs config' : 'Draft', kind: 'warn' });
  if (a.used) out.push({ text: 'Used', kind: '' });
  if (a.upcomingDates.length) out.push({ text: 'Scheduled', kind: '' });
  return out;
}
