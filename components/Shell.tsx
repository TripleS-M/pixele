'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

export function Logo({ href = '/', tag }: { href?: string; tag?: string }) {
  return (
    <Link href={href} className="logo" aria-label="Pixle home">
      <span className="logo-mark" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} />
        ))}
      </span>
      PIXLE
      {tag && <small>{tag}</small>}
    </Link>
  );
}

export function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const current =
      root.dataset.theme ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem('pixle:theme', next);
    } catch {
      /* storage unavailable: the theme just won't persist */
    }
  };
  return (
    <button type="button" onClick={toggle} title="Switch between dark and light display">
      Display
    </button>
  );
}

type Scoring = { points: number[]; hintPenalty: number };

/** Public site frame: header, navigation, how-to-play manual, footer. */
export default function Shell({
  children,
  scoring,
  timezone,
}: {
  children: React.ReactNode;
  scoring: Scoring;
  timezone: string;
}) {
  const pathname = usePathname();
  const manual = useRef<HTMLDialogElement>(null);

  // First visit: open the manual once.
  useEffect(() => {
    try {
      if (pathname === '/' && !localStorage.getItem('pixle:manual-seen')) {
        localStorage.setItem('pixle:manual-seen', '1');
        manual.current?.showModal();
      }
    } catch {
      /* ignore */
    }
  }, [pathname]);

  const current = (href: string) => (pathname === href || pathname.startsWith(href + '/') ? 'page' : undefined);

  return (
    <div className="shell">
      <header className="topbar">
        <Logo tag="IMAGE RECOVERY TERMINAL" />
        <nav className="nav" aria-label="Main">
          <Link href="/" aria-current={pathname === '/' ? 'page' : undefined}>
            Daily
          </Link>
          <Link href="/archive" aria-current={current('/archive')}>
            Archive
          </Link>
          <Link href="/stats" aria-current={current('/stats')}>
            Stats
          </Link>
          <button type="button" onClick={() => manual.current?.showModal()}>
            Manual
          </button>
          <ThemeToggle />
        </nav>
      </header>

      <main className="main">{children}</main>

      <footer className="footer">
        <span>Pixle/OS 1.0 — one new case every day</span>
        <span>New case at 00:00 {timezone.replace(/_/g, ' ')}</span>
      </footer>

      <dialog ref={manual} aria-labelledby="manual-title">
        <div className="titlebar">
          <span id="manual-title">Operator manual</span>
        </div>
        <div className="window-body stack manual">
          <p>
            A corrupted image has been recovered. This terminal can <strong>enhance</strong> it — but every
            enhancement pass costs you.
          </p>
          <ol>
            <li>Study the image and type what you think it shows.</li>
            <li>
              A wrong guess makes the terminal run the next enhancement pass: more pixels, more colours, more
              detail.
            </li>
            <li>You have {scoring.points.length} guesses. The final guess is made on the fully restored image.</li>
            <li>
              Stuck? Request the <strong>theme hint</strong>. It never uses up a guess, but costs{' '}
              {scoring.hintPenalty} points.
            </li>
          </ol>
          <table>
            <thead>
              <tr>
                <th>Identified on guess</th>
                {scoring.points.map((_, i) => (
                  <th key={i}>{i + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Points</td>
                {scoring.points.map((p, i) => (
                  <td key={i}>{p}</td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="dim">
            Everyone gets the same image each day. Past cases can be replayed in the archive as practice —
            practice never affects your streak or statistics.
          </p>
          <form method="dialog" className="row">
            <button className="btn primary" autoFocus>
              Begin
            </button>
          </form>
        </div>
      </dialog>
    </div>
  );
}
