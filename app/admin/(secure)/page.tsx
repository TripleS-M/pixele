'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, statusBadges, thumbUrl, type AdminAsset } from '@/components/admin/api';

type Filter = 'all' | 'needs' | 'draft' | 'approved' | 'unscheduled' | 'used' | 'archived';
type UploadResult = { name: string; status: 'added' | 'duplicate' | 'error'; id?: string; duplicateOf?: string; error?: string };
type Scan = {
  added: { relPath: string }[];
  duplicates: { relPath: string; duplicateOf: string }[];
  errors: { relPath: string; error: string }[];
  unsupported: string[];
  reprocessed: number;
  moved: number;
  missing: number;
};

const FILTERS: [Filter, string, (a: AdminAsset) => boolean][] = [
  ['all', 'All', (a) => a.status !== 'archived'],
  ['needs', 'Needs config', (a) => a.status === 'draft' && a.needsConfig],
  ['draft', 'Ready to approve', (a) => a.status === 'draft' && !a.needsConfig],
  ['approved', 'Approved', (a) => a.status === 'approved'],
  ['unscheduled', 'Approved · unscheduled', (a) => a.status === 'approved' && a.scheduledDates.length === 0],
  ['used', 'Used', (a) => a.used],
  ['archived', 'Archived', (a) => a.status === 'archived'],
];

const DEFAULT_CATEGORIES = ['animals', 'anime', 'architecture', 'food', 'technology', 'vehicles', 'nature', 'random'];

export default function LibraryPage() {
  const [assets, setAssets] = useState<AdminAsset[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState('');
  const [scan, setScan] = useState<Scan | null>(null);
  const [uploads, setUploads] = useState<UploadResult[] | null>(null);
  const [busy, setBusy] = useState('');
  const [category, setCategory] = useState('random');
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (withScan = false) => {
    try {
      const data = await api<{ assets: AdminAsset[]; lastScan: Scan | null }>(
        `/api/admin/assets${withScan ? '?scan=1' : ''}`,
      );
      setAssets(data.assets);
      if (withScan) setScan(data.lastScan);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh(true);
  }, [refresh]);

  const categories = useMemo(
    () => Array.from(new Set([...DEFAULT_CATEGORIES, ...(assets ?? []).map((a) => a.category)])).sort(),
    [assets],
  );

  const upload = async (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setBusy(`Processing ${list.length} image${list.length > 1 ? 's' : ''}`);
    setUploads(null);
    const results: UploadResult[] = [];
    try {
      // One request per file keeps each upload small and reports progress as it goes.
      for (let i = 0; i < list.length; i++) {
        setBusy(`Processing image ${i + 1} of ${list.length}`);
        const form = new FormData();
        form.append('category', category);
        form.append('files', list[i]);
        try {
          const data = await api<{ results: UploadResult[] }>('/api/admin/assets', { method: 'POST', body: form });
          results.push(...data.results);
        } catch (err) {
          results.push({ name: list[i].name, status: 'error', error: (err as Error).message });
        }
      }
      setUploads(results);
      await refresh();
    } finally {
      setBusy('');
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const rescan = async () => {
    setBusy('Scanning asset folder');
    try {
      setScan(await api<Scan>('/api/admin/scan', { method: 'POST' }));
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy('');
  };

  const visible = (assets ?? []).filter(FILTERS.find((f) => f[0] === filter)![2]);
  const scanNotes = scan
    ? [
        scan.added.length && `${scan.added.length} new image${scan.added.length > 1 ? 's' : ''} registered as draft`,
        scan.reprocessed && `${scan.reprocessed} re-rendered with new pixelation settings`,
        scan.moved && `${scan.moved} moved/renamed`,
        scan.missing && `${scan.missing} with missing original file`,
        ...scan.duplicates.map((d) => `Duplicate skipped: ${d.relPath} (same image as ${d.duplicateOf})`),
        ...scan.errors.map((e) => `Could not read ${e.relPath}: ${e.error}`),
        ...scan.unsupported.map((u) => `Unsupported file ignored: ${u}`),
      ].filter(Boolean)
    : [];

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1 className="page-title">Asset library</h1>
          <p className="dim">
            Drop images into <code>assets/pixle/&lt;category&gt;/</code> or upload them here. New images always
            arrive as drafts.
          </p>
        </div>
        <button className="btn" onClick={rescan} disabled={Boolean(busy)}>
          Rescan folder
        </button>
      </div>

      <div
        className={`dropzone${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          upload(e.dataTransfer.files);
        }}
      >
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 200 }}>
            <span>Category folder</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <input
            ref={fileInput}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(e) => upload(e.target.files)}
          />
          <button className="btn primary" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}>
            Upload images
          </button>
          <span className="dim">or drag &amp; drop here — select many files for a bulk upload (JPG, PNG, WEBP)</span>
        </div>
        {busy && (
          <p className="label cursor" role="status">
            {busy}
          </p>
        )}
        {uploads && (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {uploads.map((u, i) => (
              <li key={i}>
                {u.name} —{' '}
                {u.status === 'added' ? (
                  <>
                    draft created · <Link href={`/admin/asset/${u.id}`}>add metadata</Link>
                  </>
                ) : u.status === 'duplicate' ? (
                  `duplicate skipped (same image as ${u.duplicateOf})`
                ) : (
                  `failed: ${u.error}`
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {scanNotes.length > 0 && (
        <div className="notice">
          <span className="label">Last folder scan</span>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {scanNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="notice error">{error}</p>}

      <div className="tabs" role="group" aria-label="Filter assets">
        {FILTERS.map(([key, label, test]) => (
          <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {label} ({(assets ?? []).filter(test).length})
          </button>
        ))}
      </div>

      {!assets && !error && <p className="label cursor">Loading library</p>}
      {assets && visible.length === 0 && (
        <p className="notice">
          {assets.length === 0
            ? 'The library is empty. Upload an image above, or copy files into the assets/pixle folder.'
            : 'Nothing in this view.'}
        </p>
      )}

      <div className="admin-grid">
        {visible.map((a) => (
          <Link key={a.id} href={`/admin/asset/${a.id}`} className="asset-card">
            <div className="thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumbUrl(a.id)} alt="" loading="lazy" />
            </div>
            <div className="meta">
              <span className="name">{a.answer || '— unnamed —'}</span>
              <span className="file">{a.relPath}</span>
              <div className="badges">
                {statusBadges(a).map((b) => (
                  <span key={b.text} className={`badge ${b.kind}`}>
                    {b.text}
                  </span>
                ))}
              </div>
              {a.scheduledDates.length > 0 && (
                <span className="file">{a.scheduledDates.slice(-3).join(', ')}</span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
