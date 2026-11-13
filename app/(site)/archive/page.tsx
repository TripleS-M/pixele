'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Entry = {
  date: string;
  number: number | null;
  official: boolean;
  status: 'new' | 'playing' | 'won' | 'lost';
  guesses: number;
  score: number | null;
};

function StatusBadge({ entry }: { entry: Entry }) {
  if (entry.status === 'won') return <span className="badge solid">Solved {entry.guesses}/5 · {entry.score}</span>;
  if (entry.status === 'lost') return <span className="badge">Unsolved</span>;
  if (entry.status === 'playing') return <span className="badge warn">In progress</span>;
  return <span className="badge warn">Not played</span>;
}

export default function ArchivePage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/archive', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setEntries(d.puzzles ?? []))
      .catch(() => setError('Could not load the archive.'));
  }, []);

  return (
    <div className="stack narrow">
      <div>
        <h1 className="page-title">Archive</h1>
        <p className="dim">
          Replay any past puzzle as practice. Practice games never change your streak or statistics.
        </p>
      </div>
      {error && <p className="notice error">{error}</p>}
      {!entries && !error && <p className="label cursor">Reading archive</p>}
      {entries && entries.length === 0 && (
        <div className="window">
          <div className="window-body empty">
            <h2>Archive empty</h2>
            <p>Past daily puzzles will appear here from tomorrow.</p>
            <Link className="btn primary" href="/">
              Today&apos;s puzzle
            </Link>
          </div>
        </div>
      )}
      {entries && entries.length > 0 && (
        <ul className="list">
          {entries.map((e) => (
            <li key={e.date}>
              <Link href={`/archive/${e.date}`}>
                <span className="num">#{String(e.number ?? 0).padStart(3, '0')}</span>
                <span>
                  {e.date}
                  {e.official && <span className="dim"> · daily result</span>}
                </span>
                <StatusBadge entry={e} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
