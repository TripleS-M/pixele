'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Stats = {
  played: number;
  won: number;
  lost: number;
  winRate: number;
  currentStreak: number;
  maxStreak: number;
  averageGuesses: number;
  averageScore: number;
  totalPoints: number;
  hintsUsed: number;
  distribution: number[];
  maxScore: number;
  recent: { date: string; number: number | null; status: string; guesses: number; score: number; hintUsed: boolean }[];
};

const CACHE_KEY = 'pixle:stats';

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    fetch('/api/stats', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data: Stats) => {
        setStats(data);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        // Fall back to the last copy saved in this browser.
        try {
          const cached = localStorage.getItem(CACHE_KEY);
          if (cached) setStats(JSON.parse(cached));
        } catch {
          /* ignore */
        }
        setOffline(true);
      });
  }, []);

  if (!stats) {
    return <p className={`label${offline ? '' : ' cursor'}`}>{offline ? 'Statistics unavailable.' : 'Compiling statistics'}</p>;
  }

  const tiles: [string, string | number][] = [
    ['Played', stats.played],
    ['Won', stats.won],
    ['Win rate', `${stats.winRate}%`],
    ['Current streak', stats.currentStreak],
    ['Max streak', stats.maxStreak],
    ['Avg guesses', stats.played ? stats.averageGuesses : '—'],
    ['Avg score', stats.played ? stats.averageScore : '—'],
    ['Total points', stats.totalPoints],
  ];
  const peak = Math.max(1, ...stats.distribution, stats.lost);
  const rows: [string, number][] = [
    ...stats.distribution.map((n, i): [string, number] => [`Guess ${i + 1}`, n]),
    ['Failed', stats.lost],
  ];

  return (
    <div className="stack">
      <div>
        <h1 className="page-title">Operator record</h1>
        <p className="dim">Daily cases only. Practice games are never counted.</p>
      </div>
      {offline && <p className="notice">Offline — showing the last statistics saved in this browser.</p>}

      <div className="tiles">
        {tiles.map(([label, value]) => (
          <div className="tile" key={label}>
            <b>{value}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <section className="stack" style={{ gap: 8 }}>
        <h2 style={{ fontSize: 28 }}>Solved on</h2>
        <div className="dist">
          {rows.map(([label, n]) => (
            <div className="dist-row" key={label}>
              <span>{label}</span>
              <div className="dist-track">
                <div className="dist-fill" data-empty={n === 0} style={{ width: `${(n / peak) * 100}%` }} />
              </div>
              <span>{n}</span>
            </div>
          ))}
        </div>
        <p className="dim">
          Hints used in {stats.hintsUsed} of {stats.played} games.
        </p>
      </section>

      {stats.recent.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <h2 style={{ fontSize: 28 }}>Recent cases</h2>
          <ul className="list">
            {stats.recent.map((r) => (
              <li key={r.date}>
                <div className="list-row">
                  <span className="num">#{String(r.number ?? 0).padStart(3, '0')}</span>
                  <span>
                    {r.date}
                    {r.hintUsed && <span className="dim"> · hint</span>}
                  </span>
                  <span className={`badge${r.status === 'won' ? ' solid' : ''}`}>
                    {r.status === 'won' ? `${r.guesses}/5 · ${r.score}` : 'Unsolved'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stats.played === 0 && (
        <p className="notice">No completed daily cases yet. Solve today&apos;s case to start your record.</p>
      )}

      <div className="row">
        <Link className="btn primary" href="/">
          Today&apos;s case
        </Link>
        <Link className="btn" href="/archive">
          Practise older cases
        </Link>
      </div>
    </div>
  );
}
