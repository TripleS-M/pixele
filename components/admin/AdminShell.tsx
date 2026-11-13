'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo, ThemeToggle } from '@/components/Shell';

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const signOut = async () => {
    await fetch('/api/admin/session', { method: 'DELETE' });
    window.location.href = '/admin/login';
  };
  const libraryActive = pathname === '/admin' || pathname.startsWith('/admin/asset');
  return (
    <div className="shell wide">
      <header className="topbar">
        <Logo href="/admin" tag="CONTROL ROOM" />
        <nav className="nav" aria-label="Admin">
          <Link href="/admin" aria-current={libraryActive ? 'page' : undefined}>
            Library
          </Link>
          <Link href="/admin/schedule" aria-current={pathname.startsWith('/admin/schedule') ? 'page' : undefined}>
            Schedule
          </Link>
          <Link href="/" target="_blank">
            Live site ↗
          </Link>
          <ThemeToggle />
          <button type="button" onClick={signOut}>
            Sign out
          </button>
        </nav>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
