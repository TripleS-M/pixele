import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AdminShell from '@/components/admin/AdminShell';
import { isAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Control room', robots: { index: false } };

/** Everything under /admin (except the login page) requires a signed-in admin. */
export default async function SecureLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) redirect('/admin/login');
  return <AdminShell>{children}</AdminShell>;
}
