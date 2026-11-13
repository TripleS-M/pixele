import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './config';

/**
 * SQLite via Node's built-in driver (no native add-on to compile).
 *
 * Data model notes: `players` are anonymous today (an id held in a cookie) but
 * every play is already recorded server-side against a player id, so accounts
 * and leaderboards can be layered on later by attaching identity to `players`.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS assets (
  id            TEXT PRIMARY KEY,
  hash          TEXT NOT NULL UNIQUE,
  rel_path      TEXT NOT NULL,
  filename      TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT '',
  width         INTEGER NOT NULL DEFAULT 0,
  height        INTEGER NOT NULL DEFAULT 0,
  answer        TEXT NOT NULL DEFAULT '',
  accepted      TEXT NOT NULL DEFAULT '[]',
  theme         TEXT NOT NULL DEFAULT '',
  hint          TEXT NOT NULL DEFAULT '',
  difficulty    TEXT NOT NULL DEFAULT 'medium',
  source_url    TEXT NOT NULL DEFAULT '',
  creator       TEXT NOT NULL DEFAULT '',
  licence       TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'draft',
  stage_blocks  TEXT,
  stage_sig     TEXT NOT NULL DEFAULT '',
  file_missing  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  rel_path TEXT PRIMARY KEY,
  size     INTEGER NOT NULL,
  mtime    INTEGER NOT NULL,
  hash     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schedule (
  date     TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id)
);
CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plays (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   TEXT NOT NULL,
  mode        TEXT NOT NULL,
  ref         TEXT NOT NULL,
  asset_id    TEXT NOT NULL,
  guesses     TEXT NOT NULL DEFAULT '[]',
  hint_used   INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'playing',
  score       INTEGER NOT NULL DEFAULT 0,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (player_id, mode, ref)
);
CREATE INDEX IF NOT EXISTS plays_by_ref ON plays (mode, ref);
`;

const g = globalThis as unknown as { __pixleDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (!g.__pixleDb) {
    // Loaded through getBuiltinModule so bundlers never try to resolve it.
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const database = new DatabaseSync(path.join(DATA_DIR, 'pixle.db'));
    database.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    database.exec(SCHEMA);
    g.__pixleDb = database;
  }
  return g.__pixleDb;
}

type Param = string | number | null;

export function all<T = Record<string, any>>(sql: string, ...params: Param[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}
export function get<T = Record<string, any>>(sql: string, ...params: Param[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}
export function run(sql: string, ...params: Param[]) {
  return db().prepare(sql).run(...params);
}

// ---------------------------------------------------------------- assets

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
export type AssetStatus = 'draft' | 'approved' | 'archived';

export type Asset = {
  id: string;
  hash: string;
  relPath: string;
  filename: string;
  category: string;
  width: number;
  height: number;
  answer: string;
  accepted: string[];
  theme: string;
  hint: string;
  difficulty: Difficulty;
  sourceUrl: string;
  creator: string;
  licence: string;
  status: AssetStatus;
  stageBlocks: number[] | null;
  stageSig: string;
  fileMissing: boolean;
  createdAt: string;
};

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function toAsset(r: Record<string, any>): Asset {
  return {
    id: r.id,
    hash: r.hash,
    relPath: r.rel_path,
    filename: r.filename,
    category: r.category,
    width: r.width,
    height: r.height,
    answer: r.answer,
    accepted: parseJson<string[]>(r.accepted, []),
    theme: r.theme,
    hint: r.hint,
    difficulty: r.difficulty,
    sourceUrl: r.source_url,
    creator: r.creator,
    licence: r.licence,
    status: r.status,
    stageBlocks: parseJson<number[] | null>(r.stage_blocks, null),
    stageSig: r.stage_sig,
    fileMissing: Boolean(r.file_missing),
    createdAt: r.created_at,
  };
}

export function getAsset(id: string): Asset | null {
  const row = get('SELECT * FROM assets WHERE id = ?', id);
  return row ? toAsset(row) : null;
}

/** An asset needs configuration until it has at least an answer and a hint. */
export function missingFields(a: Asset): string[] {
  const missing: string[] = [];
  if (!a.answer.trim()) missing.push('answer');
  if (!a.hint.trim()) missing.push('hint');
  return missing;
}

export function scheduledAssetId(date: string): string | null {
  return get<{ asset_id: string }>('SELECT asset_id FROM schedule WHERE date = ?', date)?.asset_id ?? null;
}
