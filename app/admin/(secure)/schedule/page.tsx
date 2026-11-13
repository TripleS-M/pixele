'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, thumbUrl, type AdminAsset } from '@/components/admin/api';

type Entry = { date: string; assetId: string; answer: string; number: number | null; locked: boolean };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function SchedulePage() {
  const [today, setToday] = useState('');
  const [month, setMonth] = useState<{ y: number; m: number } | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [assets, setAssets] = useState<AdminAsset[]>([]);
  const [picking, setPicking] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  // Six-week grid, Monday first.
  const days = useMemo(() => {
    if (!month) return [];
    const first = utc(month.y, month.m, 1);
    const offset = (first.getUTCDay() + 6) % 7;
    const count = Math.ceil((offset + utc(month.y, month.m + 1, 0).getUTCDate()) / 7) * 7;
    return Array.from({ length: count }, (_, i) => {
      const d = utc(month.y, month.m, 1 - offset + i);
      return { date: iso(d), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month.m };
    });
  }, [month]);

  const load = useCallback(async () => {
    try {
      const lib = await api<{ assets: AdminAsset[]; today: string }>('/api/admin/assets');
      setAssets(lib.assets);
      setToday(lib.today);
      setMonth((current) => current ?? { y: Number(lib.today.slice(0, 4)), m: Number(lib.today.slice(5, 7)) - 1 });
    } catch (err) {
      setNote({ text: (err as Error).message, error: true });
    }
  }, []);

  const loadEntries = useCallback(async () => {
    if (!days.length) return;
    try {
      const data = await api<{ entries: Entry[] }>(
        `/api/admin/schedule?from=${days[0].date}&to=${days[days.length - 1].date}`,
      );
      setEntries(data.entries);
    } catch (err) {
      setNote({ text: (err as Error).message, error: true });
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const byDate = useMemo(() => new Map(entries.map((e) => [e.date, e])), [entries]);
  const approved = useMemo(() => assets.filter((a) => a.status === 'approved' && !a.fileMissing), [assets]);
  // Fresh puzzles first: never used and not already on the calendar.
  const fresh = (a: AdminAsset) => a.scheduledDates.length === 0;
  const choices = useMemo(() => [...approved].sort((a, b) => Number(fresh(b)) - Number(fresh(a))), [approved]);

  const change = async (work: () => Promise<string>) => {
    setBusy(true);
    setNote(null);
    try {
      const text = await work();
      await Promise.all([load(), loadEntries()]);
      setNote({ text });
    } catch (err) {
      setNote({ text: (err as Error).message, error: true });
    }
    setBusy(false);
  };

  const open = (date: string) => {
    setPicking(date);
    dialog.current?.showModal();
  };
  const close = () => {
    dialog.current?.close();
    setPicking(null);
  };

  const assign = (assetId: string) => {
    const date = picking!;
    close();
    change(async () => {
      await api('/api/admin/schedule', { method: 'PUT', json: { date, assetId } });
      return `Scheduled for ${date}.`;
    });
  };

  const clear = () => {
    const date = picking!;
    close();
    change(async () => {
      await api('/api/admin/schedule', { method: 'DELETE', json: { date } });
      return `Cleared ${date}.`;
    });
  };

  const gaps = days.filter((d) => d.inMonth && d.date >= today && !byDate.has(d.date));
  const unused = approved.filter(fresh);

  const autoFill = () =>
    change(async () => {
      const pairs = gaps.slice(0, unused.length).map((d, i) => ({ date: d.date, assetId: unused[i].id }));
      for (const pair of pairs) await api('/api/admin/schedule', { method: 'PUT', json: pair });
      return `Filled ${pairs.length} empty day${pairs.length === 1 ? '' : 's'}.`;
    });

  if (!month) return note ? <p className="notice error">{note.text}</p> : <p className="label cursor">Loading schedule</p>;

  const title = utc(month.y, month.m, 1).toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const shift = (n: number) => {
    const d = utc(month.y, month.m + n, 1);
    setMonth({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  };
  const picked = picking ? byDate.get(picking) : undefined;

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1 className="page-title">Schedule</h1>
          <p className="dim">
            One puzzle per day. Click a day to assign an approved puzzle. Past days are locked.
          </p>
        </div>
        <div className="row">
          <button className="btn small" onClick={() => shift(-1)} aria-label="Previous month">
            ←
          </button>
          <span className="big" style={{ minWidth: 210, textAlign: 'center' }}>
            {title}
          </span>
          <button className="btn small" onClick={() => shift(1)} aria-label="Next month">
            →
          </button>
        </div>
      </div>

      <div className="spread">
        <span className="label">
          {gaps.length} empty day{gaps.length === 1 ? '' : 's'} left this month · {unused.length} approved puzzle
          {unused.length === 1 ? '' : 's'} not yet scheduled
        </span>
        <button className="btn small" onClick={autoFill} disabled={busy || !gaps.length || !unused.length}>
          Auto-fill empty days
        </button>
      </div>

      {note && (
        <p className={`notice${note.error ? ' error' : ''}`} role="status">
          {note.text}
        </p>
      )}

      <div className="calendar">
        {DOW.map((d) => (
          <div className="dow" key={d}>
            {d}
          </div>
        ))}
        {days.map((d) => {
          const entry = byDate.get(d.date);
          const past = d.date < today;
          const cls = `day${d.inMonth ? '' : ' outside'}${past ? ' past' : ''}${d.date === today ? ' today' : ''}`;
          return (
            <button
              key={d.date}
              className={cls}
              disabled={!d.inMonth || past || busy}
              onClick={() => open(d.date)}
              aria-label={`${d.date}${entry ? `: ${entry.answer}` : ': empty'}`}
            >
              <span className="d">
                <span>{d.day}</span>
                {entry && <small>#{entry.number}{past ? ' · used' : ''}</small>}
              </span>
              {entry ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumbUrl(entry.assetId)} alt="" loading="lazy" />
                  <span className="a">{entry.answer}</span>
                </>
              ) : (
                !past && <span className="plus">+</span>
              )}
            </button>
          );
        })}
      </div>

      <dialog ref={dialog} className="wide" onClose={() => setPicking(null)}>
        <div className="titlebar">
          <span>Puzzle for {picking}</span>
        </div>
        <div className="window-body stack">
          {picking === today && (
            <p className="notice">
              This is today&apos;s live puzzle. Changing it restarts the game for anyone who has already played today.
            </p>
          )}
          {picked && (
            <p>
              Currently: <strong>{picked.answer}</strong> · <Link href={`/admin/asset/${picked.assetId}`}>edit</Link>
            </p>
          )}
          {choices.length === 0 ? (
            <p className="notice">
              No approved puzzles yet. Open an asset in the <Link href="/admin">library</Link>, add its answer and
              hint, then approve it.
            </p>
          ) : (
            <ul className="picker">
              {choices.map((a) => (
                <li key={a.id}>
                  <button onClick={() => assign(a.id)} disabled={busy}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumbUrl(a.id)} alt="" loading="lazy" />
                    <span>
                      {a.answer} <span className="dim">· {a.difficulty}</span>
                    </span>
                    <span className="badges">
                      {a.used && <span className="badge">Used</span>}
                      {a.scheduledDates.length > 0 ? (
                        <span className="badge">{a.scheduledDates[a.scheduledDates.length - 1]}</span>
                      ) : (
                        <span className="badge solid">Fresh</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            {picked && (
              <button className="btn" onClick={clear} disabled={busy}>
                Clear this day
              </button>
            )}
            <button className="btn" onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
