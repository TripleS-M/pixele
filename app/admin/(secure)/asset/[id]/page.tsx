'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, statusBadges, type AdminAsset } from '@/components/admin/api';

type Form = {
  answer: string;
  accepted: string;
  theme: string;
  hint: string;
  difficulty: string;
  category: string;
  sourceUrl: string;
  creator: string;
  licence: string;
  blocks: string[];
};

const toForm = (a: AdminAsset): Form => ({
  answer: a.answer,
  accepted: a.accepted.join('\n'),
  theme: a.theme,
  hint: a.hint,
  difficulty: a.difficulty,
  category: a.category,
  sourceUrl: a.sourceUrl,
  creator: a.creator,
  licence: a.licence,
  blocks: a.defaultBlocks.map((_, i) => (a.stageBlocks ? String(a.stageBlocks[i]) : '')),
});

const PASS_LABELS = ['Pass 1', 'Pass 2', 'Pass 3', 'Pass 4', 'Original'];

export default function AssetEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [asset, setAsset] = useState<AdminAsset | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [stage, setStage] = useState(1);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [date, setDate] = useState('');

  const accept = useCallback((a: AdminAsset) => {
    setAsset(a);
    setForm(toForm(a));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    api<{ asset: AdminAsset }>(`/api/admin/assets/${id}`)
      .then((d) => accept(d.asset))
      .catch((err) => setNote({ text: (err as Error).message, error: true }));
  }, [id, accept]);

  if (!asset || !form) {
    return note ? (
      <div className="stack">
        <p className="notice error">{note.text}</p>
        <Link className="btn" href="/admin" style={{ alignSelf: 'flex-start' }}>
          ← Library
        </Link>
      </div>
    ) : (
      <p className="label cursor">Loading asset</p>
    );
  }

  const set = (key: keyof Omit<Form, 'blocks'>) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value });

  const payload = () => {
    const anyBlocks = form.blocks.some((b) => b.trim());
    return {
      answer: form.answer,
      accepted: form.accepted.split('\n'),
      theme: form.theme,
      hint: form.hint,
      difficulty: form.difficulty,
      category: form.category,
      sourceUrl: form.sourceUrl,
      creator: form.creator,
      licence: form.licence,
      // Blank fields fall back to the global setting for that pass.
      stageBlocks: anyBlocks ? form.blocks.map((b, i) => (b.trim() ? Number(b) : asset.defaultBlocks[i])) : null,
    };
  };

  const run = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setNote(null);
    try {
      const text = await work();
      if (text) setNote({ text });
    } catch (err) {
      setNote({ text: (err as Error).message, error: true });
    }
    setBusy(false);
  };

  const save = (extra: Record<string, unknown> = {}, done = 'Saved.') =>
    run(async () => {
      const data = await api<{ asset: AdminAsset }>(`/api/admin/assets/${id}`, {
        method: 'PATCH',
        json: { ...payload(), ...extra },
      });
      accept(data.asset);
      return done;
    });

  const reload = async () => accept((await api<{ asset: AdminAsset }>(`/api/admin/assets/${id}`)).asset);

  const schedule = () =>
    run(async () => {
      await api('/api/admin/schedule', { method: 'PUT', json: { date, assetId: id } });
      await reload();
      setDate('');
      return `Scheduled for ${date}.`;
    });

  const unschedule = (d: string) =>
    run(async () => {
      await api('/api/admin/schedule', { method: 'DELETE', json: { date: d } });
      await reload();
      return `Removed from ${d}.`;
    });

  const remove = () => {
    if (!window.confirm('Delete this asset permanently? The original file is removed from the asset folder too.')) return;
    run(async () => {
      await api(`/api/admin/assets/${id}`, { method: 'DELETE' });
      router.push('/admin');
    });
  };

  const image = (n: number) => `/api/admin/assets/${id}/image/${n}?v=${version}`;
  const layer = (n: number) => `layer${asset.stageMono[n - 1] ? ' mono' : ''}${n === 5 ? ' final' : ''}`;

  return (
    <div className="stack">
      <div className="spread">
        <div className="row">
          <Link className="btn small" href="/admin">
            ← Library
          </Link>
          <div className="badges">
            {statusBadges(asset).map((b) => (
              <span key={b.text} className={`badge ${b.kind}`}>
                {b.text}
              </span>
            ))}
          </div>
        </div>
        <Link className="btn small" href={`/admin/preview/${id}`}>
          Preview as player →
        </Link>
      </div>

      <h1 className="page-title">{asset.answer || 'Unnamed asset'}</h1>

      {asset.needsConfig && (
        <p className="notice">
          Requires configuration: add {asset.missing.join(' and ')} before this image can be approved.
        </p>
      )}
      {asset.fileMissing && (
        <p className="notice error">
          The original file ({asset.relPath}) is no longer in the asset folder. Restore it, or archive this asset.
        </p>
      )}
      {note && (
        <p className={`notice${note.error ? ' error' : ''}`} role="status">
          {note.text}
        </p>
      )}

      <div className="editor">
        <div className="stack">
          <div className="window">
            <div className="titlebar">
              <span>
                {PASS_LABELS[stage - 1]} of 5{stage === 1 ? ' — what players see first' : ''}
              </span>
            </div>
            <div className="viewport-pad">
              <div
                className="viewport"
                style={{ aspectRatio: `${asset.width} / ${asset.height}`, width: `min(100%, calc(440px * ${asset.width} / ${asset.height}))` }}
              >
                <div className={layer(stage)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image(stage)} alt={`Enhancement stage ${stage}`} />
                </div>
              </div>
            </div>
          </div>
          <div>
            <span className="label">All five stages</span>
            <div className="stage-strip">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} aria-pressed={stage === n} onClick={() => setStage(n)} title={PASS_LABELS[n - 1]}>
                  <em>{n}</em>
                  <span className={layer(n)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image(n)} alt={`Stage ${n}`} />
                  </span>
                </button>
              ))}
            </div>
          </div>
          <dl className="kv">
            <dt>Puzzle ID</dt>
            <dd>{asset.id}</dd>
            <dt>File</dt>
            <dd>assets/pixle/{asset.relPath}</dd>
            <dt>Size</dt>
            <dd>
              {asset.width} × {asset.height}
            </dd>
            <dt>Added</dt>
            <dd>{asset.createdAt.slice(0, 10)}</dd>
            <dt>File hash</dt>
            <dd>{asset.hash}…</dd>
            <dt>Used</dt>
            <dd>{asset.used ? 'Yes — has been a daily puzzle' : 'Not yet'}</dd>
          </dl>
        </div>

        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="form-grid">
            <label className="field full">
              <span>Correct answer</span>
              <input value={form.answer} onChange={set('answer')} maxLength={80} placeholder="e.g. Mechanical Keyboard" />
            </label>
            <label className="field full">
              <span>Also accepted (one per line)</span>
              <textarea
                value={form.accepted}
                onChange={set('accepted')}
                placeholder={'keyboard\nmechanical gaming keyboard'}
              />
              <small>Aliases, abbreviations, alternative spellings. Case and punctuation are ignored.</small>
            </label>
            <label className="field">
              <span>Theme / category label</span>
              <input value={form.theme} onChange={set('theme')} maxLength={80} placeholder="Technology" />
            </label>
            <label className="field">
              <span>Difficulty</span>
              <select value={form.difficulty} onChange={set('difficulty')}>
                {['easy', 'medium', 'hard', 'expert'].map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className="field full">
              <span>Hint shown to players</span>
              <input value={form.hint} onChange={set('hint')} maxLength={160} placeholder="Technology and peripherals" />
              <small>A broad theme. It must not contain the answer.</small>
            </label>
            <label className="field">
              <span>Category folder</span>
              <input value={form.category} onChange={set('category')} maxLength={40} />
            </label>
            <label className="field">
              <span>Creator / photographer</span>
              <input value={form.creator} onChange={set('creator')} maxLength={160} />
            </label>
            <label className="field">
              <span>Source URL</span>
              <input value={form.sourceUrl} onChange={set('sourceUrl')} maxLength={500} placeholder="https://" />
            </label>
            <label className="field">
              <span>Licence</span>
              <input value={form.licence} onChange={set('licence')} maxLength={160} placeholder="CC BY 4.0" />
            </label>
            <div className="field full">
              <span>Pixel grid per pass (optional override for this image)</span>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                {form.blocks.map((b, i) => (
                  <input
                    key={i}
                    type="number"
                    min={2}
                    max={400}
                    value={b}
                    placeholder={String(asset.defaultBlocks[i])}
                    aria-label={`Pixels along the long side for pass ${i + 1}`}
                    onChange={(e) =>
                      setForm({ ...form, blocks: form.blocks.map((x, j) => (j === i ? e.target.value : x)) })
                    }
                  />
                ))}
              </div>
              <small>
                Pixels along the longer side for passes 1–4. Leave blank to use the global setting. Lower =
                harder.
              </small>
            </div>
          </div>

          <div className="row">
            <button className="btn primary" disabled={busy}>
              Save
            </button>
            {asset.status === 'draft' && (
              <button type="button" className="btn" disabled={busy} onClick={() => save({ status: 'approved' }, 'Approved. It can now be scheduled.')}>
                Save &amp; approve
              </button>
            )}
            {asset.status === 'approved' && (
              <button type="button" className="btn" disabled={busy} onClick={() => save({ status: 'draft' }, 'Returned to draft.')}>
                Return to draft
              </button>
            )}
            {asset.status === 'archived' ? (
              <button type="button" className="btn" disabled={busy} onClick={() => save({ status: 'draft' }, 'Restored as draft.')}>
                Restore
              </button>
            ) : (
              <button type="button" className="btn" disabled={busy} onClick={() => save({ status: 'archived' }, 'Archived.')}>
                Archive
              </button>
            )}
            <button type="button" className="btn" disabled={busy} onClick={remove}>
              Delete
            </button>
          </div>

          <div className="window">
            <div className="titlebar plain">
              <span>Schedule</span>
            </div>
            <div className="window-body stack" style={{ gap: 10 }}>
              {asset.status !== 'approved' ? (
                <p className="dim">Approve this puzzle to schedule it.</p>
              ) : (
                <div className="row" style={{ alignItems: 'flex-end' }}>
                  <label className="field" style={{ width: 190 }}>
                    <span>Daily puzzle date</span>
                    <input type="date" min={asset.today} value={date} onChange={(e) => setDate(e.target.value)} />
                  </label>
                  <button type="button" className="btn" disabled={busy || !date} onClick={schedule}>
                    Schedule
                  </button>
                  <Link href="/admin/schedule">Open calendar</Link>
                </div>
              )}
              {asset.scheduledDates.length > 0 && (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 13 }} className="stack">
                  {asset.scheduledDates.map((d) => (
                    <li key={d} className="row" style={{ gap: 8 }}>
                      <span>{d}</span>
                      {d < asset.today ? (
                        <span className="badge">Used</span>
                      ) : (
                        <>
                          {d === asset.today && <span className="badge solid">Live today</span>}
                          <button type="button" className="btn small flat" disabled={busy} onClick={() => unschedule(d)}>
                            Remove
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
