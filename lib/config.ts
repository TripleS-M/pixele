import fs from 'node:fs';
import path from 'node:path';

export const ROOT = process.cwd();
/** The content library: drop images here (in any sub-folder). */
export const LIBRARY_DIR = path.join(ROOT, 'assets', 'pixle');
export const PROCESSED_DIR = path.join(ROOT, 'storage', 'pixle', 'processed');
export const THUMBS_DIR = path.join(ROOT, 'storage', 'pixle', 'thumbnails');
export const DATA_DIR = path.join(ROOT, 'data');
export const CONFIG_FILE = path.join(ROOT, 'pixle.config.json');

export const DEFAULT_CATEGORIES = [
  'animals',
  'anime',
  'architecture',
  'food',
  'technology',
  'vehicles',
  'nature',
  'random',
];

/** Five guesses, five low-resolution stages. The untouched original is only shown once the game is over. */
export const MAX_GUESSES = 5;
/** Pseudo-stage number of the original image (revealed after the game ends). */
export const FINAL_STAGE = MAX_GUESSES + 1;

export type StageConfig = {
  /** Resolution of this stage: number of pixels along the longer side of the image. */
  blocks: number;
  /** Optional retro effect: colour levels per channel with dithering (256 = off). */
  levels: number;
  /** Optional retro effect: render as 1-bit monochrome. */
  mono: boolean;
};

export type Config = {
  timezone: string;
  /** Date of puzzle #1 (YYYY-MM-DD). null = the earliest scheduled date. */
  launchDate: string | null;
  scoring: { points: number[]; hintPenalty: number };
  pixelation: { outputSize: number; stages: StageConfig[] };
};

export const DEFAULT_CONFIG: Config = {
  timezone: 'Australia/Melbourne',
  launchDate: null,
  scoring: { points: [500, 400, 300, 200, 100], hintPenalty: 50 },
  pixelation: {
    outputSize: 960,
    stages: [
      { blocks: 20, levels: 256, mono: false },
      { blocks: 32, levels: 256, mono: false },
      { blocks: 56, levels: 256, mono: false },
      { blocks: 110, levels: 256, mono: false },
      { blocks: 480, levels: 256, mono: false },
    ],
  },
};

let cache: { mtime: number; config: Config } | null = null;

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function validTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Reads pixle.config.json (re-read whenever the file changes). Invalid values fall back to defaults. */
export function getConfig(): Config {
  let mtime = 0;
  try {
    mtime = fs.statSync(CONFIG_FILE).mtimeMs;
  } catch {
    return DEFAULT_CONFIG;
  }
  if (cache && cache.mtime === mtime) return cache.config;

  let raw: Record<string, any> = {};
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (err) {
    console.warn('[pixle] pixle.config.json is not valid JSON - using defaults.', err);
  }

  const d = DEFAULT_CONFIG;
  const points = raw?.scoring?.points;
  const stages = raw?.pixelation?.stages;
  const config: Config = {
    timezone: validTimezone(raw.timezone) ? raw.timezone : d.timezone,
    launchDate: isDate(raw.launchDate) ? raw.launchDate : null,
    scoring: {
      points:
        Array.isArray(points) &&
        points.length === MAX_GUESSES &&
        points.every((p) => Number.isFinite(p) && p >= 0)
          ? points.map(Number)
          : d.scoring.points,
      hintPenalty:
        Number.isFinite(raw?.scoring?.hintPenalty) && raw.scoring.hintPenalty >= 0
          ? Number(raw.scoring.hintPenalty)
          : d.scoring.hintPenalty,
    },
    pixelation: {
      outputSize: clampInt(raw?.pixelation?.outputSize, 320, 2400, d.pixelation.outputSize),
      stages:
        Array.isArray(stages) && stages.length === MAX_GUESSES
          ? stages.map((s, i) => ({
              blocks: clampInt(s?.blocks, 2, 1600, d.pixelation.stages[i].blocks),
              levels: clampInt(s?.levels, 2, 256, 256),
              mono: Boolean(s?.mono),
            }))
          : d.pixelation.stages,
    },
  };
  cache = { mtime, config };
  return config;
}

export function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
