import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CATEGORIES, LIBRARY_DIR } from './config';
import { all, get, run, toAsset, DIFFICULTIES, type Asset, type Difficulty } from './db';
import { cleanAccepted } from './answers';
import { SUPPORTED_EXTENSIONS, processImage, stagePath, stageSignature, validateImage } from './images';

export type ScanResult = {
  at: string;
  added: { id: string; relPath: string }[];
  duplicates: { relPath: string; duplicateOf: string }[];
  errors: { relPath: string; error: string }[];
  unsupported: string[];
  moved: number;
  reprocessed: number;
  missing: number;
};

const g = globalThis as unknown as {
  __pixleQueue?: Promise<unknown>;
  __pixleWatcher?: fs.FSWatcher;
  __pixleLastScan?: ScanResult;
};

/** All ingestion work runs one job at a time so scans and uploads can never race each other. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = (g.__pixleQueue ?? Promise.resolve()).then(job, job);
  g.__pixleQueue = next.catch(() => undefined);
  return next;
}

const toPosix = (p: string) => p.split(path.sep).join('/');
const absPath = (relPath: string) => path.join(LIBRARY_DIR, ...relPath.split('/'));
export const libraryPath = absPath;

const sha256 = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex');
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Creates the library with its starter category folders (safe to call repeatedly). */
export function ensureLibraryFolders(withCategories = false) {
  fs.mkdirSync(LIBRARY_DIR, { recursive: true });
  if (!withCategories) return;
  for (const category of DEFAULT_CATEGORIES) {
    fs.mkdirSync(path.join(LIBRARY_DIR, category), { recursive: true });
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const categoryOf = (relPath: string) => (relPath.includes('/') ? relPath.split('/')[0] : 'random');
const titleCase = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

type Sidecar = Partial<
  Pick<Asset, 'answer' | 'accepted' | 'theme' | 'hint' | 'difficulty' | 'sourceUrl' | 'creator' | 'licence'>
>;

/** Optional metadata file next to an image: `tiger.jpg.json` or `tiger.json`. */
function readSidecar(relPath: string): Sidecar {
  const abs = absPath(relPath);
  const candidates = [abs + '.json', abs.replace(/\.[^.]+$/, '') + '.json'];
  for (const file of candidates) {
    if (!fs.existsSync(/*turbopackIgnore: true*/ file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8"));
      const text = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
      return {
        answer: text(raw.answer, 80),
        accepted: cleanAccepted(raw.accepted ?? raw.acceptedAnswers),
        theme: text(raw.theme),
        hint: text(raw.hint),
        difficulty: DIFFICULTIES.includes(raw.difficulty) ? (raw.difficulty as Difficulty) : undefined,
        sourceUrl: text(raw.sourceUrl ?? raw.source, 500),
        creator: text(raw.creator ?? raw.photographer),
        licence: text(raw.licence ?? raw.license),
      };
    } catch (err) {
      console.warn(`[pixle] Ignoring unreadable metadata file ${file}:`, errorText(err));
    }
  }
  return {};
}

/** Registers a brand-new image as a DRAFT asset. It is never published automatically. */
async function createAsset(relPath: string, hash: string): Promise<string> {
  const id = 'px_' + crypto.randomBytes(5).toString('hex');
  const processed = await processImage(id, absPath(relPath), null);
  const meta = readSidecar(relPath);
  const category = categoryOf(relPath);
  run(
    `INSERT INTO assets (id, hash, rel_path, filename, category, width, height, answer, accepted, theme,
       hint, difficulty, source_url, creator, licence, status, stage_sig, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    id,
    hash,
    relPath,
    path.posix.basename(relPath),
    category,
    processed.width,
    processed.height,
    meta.answer ?? '',
    JSON.stringify(meta.accepted ?? []),
    meta.theme || titleCase(category),
    meta.hint ?? '',
    meta.difficulty ?? 'medium',
    meta.sourceUrl ?? '',
    meta.creator ?? '',
    meta.licence ?? '',
    processed.signature,
    new Date().toISOString(),
  );
  return id;
}

async function scan(): Promise<ScanResult> {
  ensureLibraryFolders();
  const result: ScanResult = {
    at: new Date().toISOString(),
    added: [],
    duplicates: [],
    errors: [],
    unsupported: [],
    moved: 0,
    reprocessed: 0,
    missing: 0,
  };

  const present = new Set<string>(); // every supported file currently on disk
  const files: { relPath: string; hash: string }[] = [];

  for (const full of walk(LIBRARY_DIR)) {
    const relPath = toPosix(path.relative(LIBRARY_DIR, full));
    const ext = path.extname(full).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      if (ext !== '.json' && ext !== '.md' && ext !== '.txt') result.unsupported.push(relPath);
      continue;
    }
    try {
      const stat = fs.statSync(full);
      const mtime = Math.round(stat.mtimeMs);
      const cached = get<{ size: number; mtime: number; hash: string }>(
        'SELECT size, mtime, hash FROM files WHERE rel_path = ?',
        relPath,
      );
      let hash = cached && cached.size === stat.size && cached.mtime === mtime ? cached.hash : '';
      if (!hash) {
        hash = sha256(fs.readFileSync(full));
        run(
          'INSERT OR REPLACE INTO files (rel_path, size, mtime, hash) VALUES (?, ?, ?, ?)',
          relPath,
          stat.size,
          mtime,
          hash,
        );
      }
      present.add(relPath);
      files.push({ relPath, hash });
    } catch (err) {
      result.errors.push({ relPath, error: errorText(err) });
    }
  }

  for (const { relPath, hash } of files) {
    const existing = get<{ id: string; rel_path: string }>('SELECT id, rel_path FROM assets WHERE hash = ?', hash);
    if (existing) {
      if (existing.rel_path === relPath) continue;
      if (present.has(existing.rel_path)) {
        // Same bytes as an image that is already registered: skip it.
        result.duplicates.push({ relPath, duplicateOf: existing.rel_path });
      } else {
        // The registered file is gone and this one has identical content: it was moved or renamed.
        run(
          'UPDATE assets SET rel_path = ?, filename = ?, category = ? WHERE id = ?',
          relPath,
          path.posix.basename(relPath),
          categoryOf(relPath),
          existing.id,
        );
        result.moved++;
      }
      continue;
    }
    try {
      await validateImage(absPath(relPath));
      const id = await createAsset(relPath, hash);
      result.added.push({ id, relPath });
    } catch (err) {
      // Usually a corrupt file, or one that is still being copied (it is retried on the next scan).
      run('DELETE FROM files WHERE rel_path = ?', relPath);
      result.errors.push({ relPath, error: errorText(err) });
    }
  }

  // Flag assets whose original has disappeared, and re-render any whose pixelation settings changed.
  for (const row of all('SELECT * FROM assets')) {
    const asset = toAsset(row);
    const missing = !present.has(asset.relPath);
    if (missing !== asset.fileMissing) {
      run('UPDATE assets SET file_missing = ? WHERE id = ?', missing ? 1 : 0, asset.id);
    }
    if (missing) {
      result.missing++;
      continue;
    }
    // ...or whose generated files have been deleted.
    if (asset.stageSig !== stageSignature(asset.stageBlocks) || !fs.existsSync(stagePath(asset.id, 1))) {
      try {
        const processed = await processImage(asset.id, absPath(asset.relPath), asset.stageBlocks);
        run(
          'UPDATE assets SET stage_sig = ?, width = ?, height = ? WHERE id = ?',
          processed.signature,
          processed.width,
          processed.height,
          asset.id,
        );
        result.reprocessed++;
      } catch (err) {
        result.errors.push({ relPath: asset.relPath, error: errorText(err) });
      }
    }
  }

  for (const row of all<{ rel_path: string }>('SELECT rel_path FROM files')) {
    if (!present.has(row.rel_path)) run('DELETE FROM files WHERE rel_path = ?', row.rel_path);
  }

  if (result.added.length || result.duplicates.length || result.errors.length) {
    console.log(
      `[pixle] Library scan: ${result.added.length} new, ${result.duplicates.length} duplicate, ${result.errors.length} failed.`,
    );
  }
  g.__pixleLastScan = result;
  return result;
}

/** Scans the asset folder: registers new images, skips duplicates, re-renders stale ones. */
export const scanLibrary = () => enqueue(scan);
export const lastScan = () => g.__pixleLastScan ?? null;

/** Re-renders one asset (after its per-image pixelation override changed). */
export const reprocessAsset = (asset: Asset) =>
  enqueue(async () => {
    const processed = await processImage(asset.id, absPath(asset.relPath), asset.stageBlocks);
    run('UPDATE assets SET stage_sig = ? WHERE id = ?', processed.signature, asset.id);
  });

export type UploadOutcome =
  | { name: string; status: 'added'; id: string }
  | { name: string; status: 'duplicate'; duplicateOf: string }
  | { name: string; status: 'error'; error: string };

export const safeCategory = (input: unknown) =>
  String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'random';

/** Saves an uploaded image into the library folder and registers it as a draft. */
export const ingestUpload = (name: string, data: Buffer, categoryInput: unknown) =>
  enqueue(async (): Promise<UploadOutcome> => {
    try {
      const ext = path.extname(name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        return { name, status: 'error', error: 'Unsupported format (use JPG, PNG or WEBP)' };
      }
      const hash = sha256(data);
      const existing = get<{ rel_path: string }>('SELECT rel_path FROM assets WHERE hash = ?', hash);
      if (existing) return { name, status: 'duplicate', duplicateOf: existing.rel_path };
      await validateImage(data);

      const category = safeCategory(categoryInput);
      const stem =
        path
          .basename(name, path.extname(name))
          .replace(/[^a-zA-Z0-9 _-]+/g, '')
          .trim()
          .replace(/\s+/g, '-')
          .slice(0, 60) || 'image';
      fs.mkdirSync(absPath(category), { recursive: true });
      let relPath = `${category}/${stem}${ext}`;
      for (let i = 2; fs.existsSync(absPath(relPath)); i++) relPath = `${category}/${stem}-${i}${ext}`;

      fs.writeFileSync(absPath(relPath), data);
      const stat = fs.statSync(absPath(relPath));
      run(
        'INSERT OR REPLACE INTO files (rel_path, size, mtime, hash) VALUES (?, ?, ?, ?)',
        relPath,
        stat.size,
        Math.round(stat.mtimeMs),
        hash,
      );
      try {
        const id = await createAsset(relPath, hash);
        return { name, status: 'added', id };
      } catch (err) {
        fs.rmSync(absPath(relPath), { force: true });
        run('DELETE FROM files WHERE rel_path = ?', relPath);
        throw err;
      }
    } catch (err) {
      return { name, status: 'error', error: errorText(err) };
    }
  });

/** Watches the asset folder so images dropped into it are picked up automatically. */
export function startLibraryWatcher() {
  if (g.__pixleWatcher) return;
  ensureLibraryFolders(true);
  let timer: NodeJS.Timeout | null = null;
  const trigger = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      scanLibrary().catch((err) => console.error('[pixle] Library scan failed:', err));
    }, 1500);
  };
  try {
    g.__pixleWatcher = fs.watch(LIBRARY_DIR, { recursive: true }, trigger);
    g.__pixleWatcher.on('error', (err) => console.warn('[pixle] Library watcher error:', err));
  } catch (err) {
    console.warn('[pixle] Could not watch the asset folder (use "Rescan" in the admin dashboard):', err);
  }
  trigger();
}
