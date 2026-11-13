import { MAX_GUESSES, getConfig } from './config';
import { all, get, getAsset, run, scheduledAssetId, type Asset } from './db';
import { addDays, daysBetween, isDateString, secondsUntilTomorrow, today } from './dates';
import { isCorrectGuess, normalizeAnswer } from './answers';
import { effectiveStages } from './images';

export type Mode = 'daily' | 'practice' | 'preview';
type Guess = { text: string; correct: boolean };
type Play = {
  id: number;
  player_id: string;
  mode: Mode;
  ref: string;
  asset_id: string;
  guesses: string;
  hint_used: number;
  status: 'playing' | 'won' | 'lost';
  score: number;
};

export class GameError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Puzzle #1 is the launch date (config) or, by default, the first date ever scheduled. */
export function launchDate(): string | null {
  return (
    getConfig().launchDate ?? get<{ d: string | null }>('SELECT MIN(date) AS d FROM schedule')?.d ?? null
  );
}

export function puzzleNumber(date: string): number | null {
  const launch = launchDate();
  if (!launch) return null;
  const n = daysBetween(launch, date) + 1;
  return n >= 1 ? n : null;
}

type Target = { mode: Mode; ref: string; date: string | null; asset: Asset };

/**
 * Turns a game key into a concrete puzzle. The server decides what "today" is,
 * so a player can never reach a future puzzle by changing their clock or the key.
 *   daily                  today's puzzle
 *   practice:YYYY-MM-DD    a past daily puzzle (does not count towards stats)
 *   preview:<assetId>      admin-only test play of any asset
 */
function resolve(key: string, admin: boolean): Target | null {
  if (key === 'daily') {
    const date = today();
    const asset = getAsset(scheduledAssetId(date) ?? '');
    return asset ? { mode: 'daily', ref: date, date, asset } : null;
  }
  if (key.startsWith('practice:')) {
    const date = key.slice(9);
    if (!isDateString(date)) throw new GameError(400, 'bad_key', 'Unknown puzzle.');
    if (date >= today()) throw new GameError(403, 'locked', 'That puzzle is not in the archive yet.');
    const asset = getAsset(scheduledAssetId(date) ?? '');
    if (!asset) throw new GameError(404, 'not_found', 'No puzzle was published on that date.');
    return { mode: 'practice', ref: date, date, asset };
  }
  if (key.startsWith('preview:')) {
    if (!admin) throw new GameError(401, 'unauthorized', 'Admin sign-in required.');
    const asset = getAsset(key.slice(8));
    if (!asset) throw new GameError(404, 'not_found', 'Asset not found.');
    return { mode: 'preview', ref: asset.id, date: null, asset };
  }
  throw new GameError(400, 'bad_key', 'Unknown puzzle.');
}

function loadPlay(playerId: string, target: Target): Play {
  const find = () =>
    get<Play>('SELECT * FROM plays WHERE player_id = ? AND mode = ? AND ref = ?', playerId, target.mode, target.ref);
  let play = find();
  if (!play) {
    run(
      'INSERT INTO plays (player_id, mode, ref, asset_id, started_at) VALUES (?, ?, ?, ?, ?)',
      playerId,
      target.mode,
      target.ref,
      target.asset.id,
      new Date().toISOString(),
    );
    play = find()!;
  }
  return play;
}

const parseGuesses = (play: Play): Guess[] => {
  try {
    return JSON.parse(play.guesses) as Guess[];
  } catch {
    return [];
  }
};

/** Stage 1 is shown before the first guess; each wrong guess runs one more enhancement pass. */
export function unlockedStage(play: Pick<Play, 'status' | 'guesses'>): number {
  if (play.status !== 'playing') return MAX_GUESSES;
  const wrong = parseGuesses(play as Play).filter((x) => !x.correct).length;
  return Math.min(MAX_GUESSES, wrong + 1);
}

export function scoreFor(guessNumber: number, hintUsed: boolean): number {
  const { points, hintPenalty } = getConfig().scoring;
  return Math.max(0, (points[guessNumber - 1] ?? 0) - (hintUsed ? hintPenalty : 0));
}

function view(play: Play, target: Target) {
  const { scoring } = getConfig();
  const { asset } = target;
  const guesses = parseGuesses(play);
  const finished = play.status !== 'playing';
  const stages = effectiveStages(asset.stageBlocks);
  return {
    available: true as const,
    key: target.mode === 'daily' ? 'daily' : `${target.mode}:${target.ref}`,
    mode: target.mode,
    number: target.date ? puzzleNumber(target.date) : null,
    date: target.date,
    status: play.status,
    guesses,
    maxGuesses: MAX_GUESSES,
    stage: unlockedStage(play),
    stages: [
      ...stages.map((s) => ({ blocks: s.blocks, levels: s.levels, mono: s.mono })),
      { blocks: 0, levels: 256, mono: false },
    ],
    imageBase: `/api/image/${play.id}`,
    imageVersion: asset.stageSig,
    width: asset.width,
    height: asset.height,
    hintUsed: Boolean(play.hint_used),
    // The hint text is only sent once the player has asked for it.
    hint: play.hint_used ? asset.hint || asset.theme : null,
    hintPenalty: scoring.hintPenalty,
    points: scoring.points,
    maxScore: scoring.points[0],
    score: finished ? play.score : null,
    // The answer never leaves the server until the game is over.
    answer: finished ? asset.answer : null,
    credit: finished
      ? { creator: asset.creator, sourceUrl: asset.sourceUrl, licence: asset.licence }
      : null,
    nextInSeconds: secondsUntilTomorrow(),
  };
}

export type GameState =
  | ReturnType<typeof view>
  | { available: false; date: string; nextInSeconds: number; hasArchive: boolean };

function unavailable(): GameState {
  const date = today();
  return {
    available: false,
    date,
    nextInSeconds: secondsUntilTomorrow(),
    hasArchive: Boolean(get('SELECT 1 FROM schedule WHERE date < ? LIMIT 1', date)),
  };
}

export function getGame(key: string, playerId: string, admin: boolean): GameState {
  const target = resolve(key, admin);
  if (!target) return unavailable();
  return view(loadPlay(playerId, target), target);
}

export type GuessResult = 'correct' | 'incorrect' | 'duplicate' | 'empty' | 'finished';

export function submitGuess(key: string, playerId: string, admin: boolean, raw: string) {
  const target = resolve(key, admin);
  if (!target) return { result: 'finished' as GuessResult, state: unavailable() };
  const play = loadPlay(playerId, target);
  const done = (result: GuessResult, p: Play = play) => ({ result, state: view(p, target) });

  if (play.status !== 'playing') return done('finished');
  const text = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const normalized = normalizeAnswer(text);
  if (!normalized) return done('empty');

  const guesses = parseGuesses(play);
  // Repeating an earlier guess does not cost a guess.
  if (guesses.some((x) => normalizeAnswer(x.text) === normalized)) return done('duplicate');

  const correct = isCorrectGuess(text, target.asset.answer, target.asset.accepted);
  guesses.push({ text, correct });
  const status = correct ? 'won' : guesses.length >= MAX_GUESSES ? 'lost' : 'playing';
  const score = correct ? scoreFor(guesses.length, Boolean(play.hint_used)) : 0;
  run(
    'UPDATE plays SET guesses = ?, status = ?, score = ?, finished_at = ? WHERE id = ?',
    JSON.stringify(guesses),
    status,
    score,
    status === 'playing' ? null : new Date().toISOString(),
    play.id,
  );
  return done(correct ? 'correct' : 'incorrect', { ...play, guesses: JSON.stringify(guesses), status, score });
}

/** Reveals the theme hint. Costs points, never a guess. */
export function useHint(key: string, playerId: string, admin: boolean): GameState {
  const target = resolve(key, admin);
  if (!target) return unavailable();
  const play = loadPlay(playerId, target);
  if (play.status === 'playing' && !play.hint_used) {
    run('UPDATE plays SET hint_used = 1 WHERE id = ?', play.id);
    play.hint_used = 1;
  }
  return view(play, target);
}

/** Practice and preview games can be replayed; the daily game cannot. */
export function resetGame(key: string, playerId: string, admin: boolean): GameState {
  const target = resolve(key, admin);
  if (!target) return unavailable();
  if (target.mode === 'daily') throw new GameError(403, 'locked', 'The daily puzzle cannot be reset.');
  run('DELETE FROM plays WHERE player_id = ? AND mode = ? AND ref = ?', playerId, target.mode, target.ref);
  return view(loadPlay(playerId, target), target);
}

/** Checks that a play belongs to this player and that the requested stage has been unlocked. */
export function authorizeImage(playId: number, stage: number, playerId: string): string | null {
  const play = get<Play>('SELECT * FROM plays WHERE id = ? AND player_id = ?', playId, playerId);
  if (!play || !Number.isInteger(stage) || stage < 1 || stage > unlockedStage(play)) return null;
  return play.asset_id;
}

// ---------------------------------------------------------------- archive + stats

export function getArchive(playerId: string | null) {
  const rows = all<{ date: string }>('SELECT date FROM schedule WHERE date < ? ORDER BY date DESC', today());
  const plays = playerId
    ? all<Play>("SELECT * FROM plays WHERE player_id = ? AND mode IN ('daily', 'practice')", playerId)
    : [];
  const find = (mode: Mode, date: string) => plays.find((p) => p.mode === mode && p.ref === date);
  return rows.map(({ date }) => {
    const daily = find('daily', date);
    const practice = find('practice', date);
    const best = daily && daily.status !== 'playing' ? daily : practice;
    return {
      date,
      number: puzzleNumber(date),
      // Finished daily plays can be replayed as practice; the official result is kept.
      official: Boolean(daily && daily.status !== 'playing'),
      status: best ? best.status : ('new' as const),
      guesses: best ? parseGuesses(best).length : 0,
      score: best && best.status !== 'playing' ? best.score : null,
    };
  });
}

/** Statistics count official daily games only - practice and preview never affect them. */
export function getStats(playerId: string | null) {
  const { scoring } = getConfig();
  const plays = playerId
    ? all<Play>(
        "SELECT * FROM plays WHERE player_id = ? AND mode = 'daily' AND status != 'playing' ORDER BY ref",
        playerId,
      )
    : [];
  const wins = plays.filter((p) => p.status === 'won');
  const distribution = Array.from({ length: MAX_GUESSES }, () => 0);
  for (const p of wins) distribution[Math.min(MAX_GUESSES, parseGuesses(p).length) - 1]++;

  // Streak = consecutive calendar days won.
  let maxStreak = 0;
  let streak = 0;
  let previous: string | null = null;
  for (const p of plays) {
    if (p.status !== 'won') streak = 0;
    else streak = previous && addDays(previous, 1) === p.ref && streak > 0 ? streak + 1 : 1;
    maxStreak = Math.max(maxStreak, streak);
    previous = p.ref;
  }
  // The current streak survives until a day is actually missed.
  const now = today();
  const currentStreak = previous && (previous === now || previous === addDays(now, -1)) ? streak : 0;

  const totalPoints = plays.reduce((sum, p) => sum + p.score, 0);
  const totalGuesses = plays.reduce((sum, p) => sum + parseGuesses(p).length, 0);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    played: plays.length,
    won: wins.length,
    winRate: plays.length ? Math.round((wins.length / plays.length) * 100) : 0,
    currentStreak,
    maxStreak,
    averageGuesses: plays.length ? round(totalGuesses / plays.length) : 0,
    averageScore: plays.length ? Math.round(totalPoints / plays.length) : 0,
    totalPoints,
    hintsUsed: plays.filter((p) => p.hint_used).length,
    distribution,
    lost: plays.length - wins.length,
    maxScore: scoring.points[0],
    recent: plays
      .slice(-10)
      .reverse()
      .map((p) => ({
        date: p.ref,
        number: puzzleNumber(p.ref),
        status: p.status,
        guesses: parseGuesses(p).length,
        score: p.score,
        hintUsed: Boolean(p.hint_used),
      })),
  };
}
