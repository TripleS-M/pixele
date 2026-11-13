import fs from 'node:fs';
import { MAX_GUESSES, clampInt, getConfig } from './config';
import { all, get, getAsset, missingFields, run, toAsset, DIFFICULTIES, type Asset } from './db';
import { cleanAccepted, normalizeAnswer } from './answers';
import { isDateString, today } from './dates';
import { removeProcessed, stageSignature } from './images';
import { libraryPath, reprocessAsset, safeCategory } from './ingest';
import { puzzleNumber } from './game';

export class AdminError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function describeAsset(asset: Asset, now = today()) {
  const dates = all<{ date: string }>('SELECT date FROM schedule WHERE asset_id = ? ORDER BY date', asset.id).map(
    (r) => r.date,
  );
  const missing = missingFields(asset);
  return {
    ...asset,
    hash: asset.hash.slice(0, 12),
    scheduledDates: dates,
    // "Used" = it has already been (or is today) a live daily puzzle.
    used: dates.some((d) => d <= now),
    upcomingDates: dates.filter((d) => d > now),
    today: now,
    missing,
    needsConfig: missing.length > 0,
    defaultBlocks: getConfig().pixelation.stages.map((s) => s.blocks),
    stageMono: getConfig().pixelation.stages.map((s) => s.mono),
  };
}

export type AdminAsset = ReturnType<typeof describeAsset>;

export function listAssets(): AdminAsset[] {
  const now = today();
  return all('SELECT * FROM assets ORDER BY created_at DESC, id').map((r) => describeAsset(toAsset(r), now));
}

const text = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

export async function updateAsset(id: string, patch: Record<string, unknown>): Promise<AdminAsset> {
  const current = getAsset(id);
  if (!current) throw new AdminError(404, 'Asset not found.');
  const next: Asset = { ...current };

  if ('answer' in patch) next.answer = text(patch.answer, 80);
  if ('accepted' in patch) next.accepted = cleanAccepted(patch.accepted);
  if ('theme' in patch) next.theme = text(patch.theme, 80);
  if ('hint' in patch) next.hint = text(patch.hint, 160);
  if ('category' in patch) next.category = safeCategory(patch.category);
  if ('sourceUrl' in patch) next.sourceUrl = text(patch.sourceUrl, 500);
  if ('creator' in patch) next.creator = text(patch.creator, 160);
  if ('licence' in patch) next.licence = text(patch.licence, 160);
  if ('difficulty' in patch) {
    if (!DIFFICULTIES.includes(patch.difficulty as never)) throw new AdminError(400, 'Invalid difficulty.');
    next.difficulty = patch.difficulty as Asset['difficulty'];
  }
  if ('stageBlocks' in patch) {
    const raw = patch.stageBlocks;
    if (raw == null) next.stageBlocks = null;
    else if (Array.isArray(raw) && raw.length === MAX_GUESSES) {
      next.stageBlocks = raw.map((v) => clampInt(v, 2, 1600, 0));
      if (next.stageBlocks.some((v) => !v)) throw new AdminError(400, 'Resolutions must be numbers from 2 to 1600.');
    } else throw new AdminError(400, 'Provide one resolution for each of the five stages.');
  }
  if ('status' in patch) {
    if (!['draft', 'approved', 'archived'].includes(patch.status as string)) {
      throw new AdminError(400, 'Invalid status.');
    }
    next.status = patch.status as Asset['status'];
  }

  // The hint must never give the answer away.
  if (next.answer && ` ${normalizeAnswer(next.hint)} `.includes(` ${normalizeAnswer(next.answer)} `)) {
    throw new AdminError(400, 'The hint contains the answer. Use a broader theme instead.');
  }
  if (next.status === 'approved') {
    const missing = missingFields(next);
    if (missing.length) {
      throw new AdminError(400, `Approved puzzles need ${missing.join(' and ')}. Fill that in first.`);
    }
    if (next.fileMissing) throw new AdminError(400, 'The original image file is missing from the asset folder.');
  }
  if (next.status !== 'approved' && current.status === 'approved') {
    const upcoming = get<{ date: string }>(
      'SELECT date FROM schedule WHERE asset_id = ? AND date >= ? ORDER BY date LIMIT 1',
      id,
      today(),
    );
    if (upcoming) {
      throw new AdminError(409, `This puzzle is scheduled for ${upcoming.date}. Unschedule it first.`);
    }
  }

  run(
    `UPDATE assets SET answer = ?, accepted = ?, theme = ?, hint = ?, category = ?, source_url = ?, creator = ?,
       licence = ?, difficulty = ?, stage_blocks = ?, status = ? WHERE id = ?`,
    next.answer,
    JSON.stringify(next.accepted),
    next.theme,
    next.hint,
    next.category,
    next.sourceUrl,
    next.creator,
    next.licence,
    next.difficulty,
    next.stageBlocks ? JSON.stringify(next.stageBlocks) : null,
    next.status,
    id,
  );

  if (!next.fileMissing && stageSignature(next.stageBlocks) !== current.stageSig) {
    await reprocessAsset(next);
  }
  return describeAsset(getAsset(id)!);
}

/** Permanently removes an asset, its processed images and the original file. */
export function deleteAsset(id: string) {
  const asset = getAsset(id);
  if (!asset) throw new AdminError(404, 'Asset not found.');
  if (get('SELECT 1 FROM schedule WHERE asset_id = ? LIMIT 1', id)) {
    throw new AdminError(
      409,
      'This image is on the schedule (past or upcoming). Archive it instead, or unschedule it first.',
    );
  }
  run('DELETE FROM plays WHERE asset_id = ?', id);
  run('DELETE FROM assets WHERE id = ?', id);
  run('DELETE FROM files WHERE rel_path = ?', asset.relPath);
  removeProcessed(id);
  const original = libraryPath(asset.relPath);
  for (const file of [original, original + '.json', original.replace(/\.[^.]+$/, '') + '.json']) {
    fs.rmSync(file, { force: true });
  }
}

// ---------------------------------------------------------------- schedule

export function listSchedule(from: string, to: string) {
  const now = today();
  return all<Record<string, any>>(
    `SELECT s.date, a.id, a.answer, a.category, a.difficulty FROM schedule s
       JOIN assets a ON a.id = s.asset_id WHERE s.date >= ? AND s.date <= ? ORDER BY s.date`,
    from,
    to,
  ).map((r) => ({
    date: r.date as string,
    assetId: r.id as string,
    answer: r.answer as string,
    category: r.category as string,
    difficulty: r.difficulty as string,
    number: puzzleNumber(r.date),
    locked: r.date < now,
  }));
}

function assertEditableDate(date: unknown): asserts date is string {
  if (!isDateString(date)) throw new AdminError(400, 'Invalid date.');
  if (date < today()) throw new AdminError(409, 'Past puzzles are locked and cannot be changed.');
}

export function setSchedule(date: unknown, assetId: unknown) {
  assertEditableDate(date);
  const asset = getAsset(String(assetId ?? ''));
  if (!asset) throw new AdminError(404, 'Asset not found.');
  if (asset.status !== 'approved') throw new AdminError(400, 'Only approved puzzles can be scheduled.');
  if (asset.fileMissing) throw new AdminError(400, 'The original image file is missing.');
  const previous = get<{ asset_id: string }>('SELECT asset_id FROM schedule WHERE date = ?', date);
  if (previous?.asset_id === asset.id) return;
  run('INSERT OR REPLACE INTO schedule (date, asset_id) VALUES (?, ?)', date, asset.id);
  // Swapping today's live puzzle restarts it for anyone who had already begun.
  if (previous) run("DELETE FROM plays WHERE mode = 'daily' AND ref = ?", date);
}

export function clearSchedule(date: unknown) {
  assertEditableDate(date);
  run('DELETE FROM schedule WHERE date = ?', date);
  run("DELETE FROM plays WHERE mode = 'daily' AND ref = ?", date);
}
