'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState, GuessResult } from '@/lib/game';

type Playable = Extract<GameState, { available: true }>;

const PASS_NAMES = ['Raw signal', 'Colour recovery', 'Edge reconstruction', 'Detail synthesis', 'Full restoration'];

const caseNumber = (n: number | null) => (n ? `#${String(n).padStart(3, '0')}` : '');

function stageSpec(s: Playable['stages'][number]): string {
  if (!s.blocks) return 'Source image';
  const depth = s.mono ? '1-bit' : `${Math.min(s.levels ** 3, 16777216).toLocaleString('en')} colours`;
  return `${s.blocks}px grid · ${depth}`;
}

function clock(total: number): string {
  const t = Math.max(0, total);
  const part = (n: number) => String(Math.floor(n)).padStart(2, '0');
  return `${part(t / 3600)}:${part((t % 3600) / 60)}:${part(t % 60)}`;
}

/** The share text never includes the image or the answer. */
function shareText(s: Playable): string {
  const title =
    s.mode === 'preview' ? 'PIXLE PREVIEW' : `PIXLE ${caseNumber(s.number)}${s.mode === 'practice' ? ' (practice)' : ''}`;
  const used = s.guesses.length;
  const row =
    s.status === 'won'
      ? '🟩'.repeat(used) + '⬛'.repeat(s.maxGuesses - used)
      : '🟥'.repeat(s.maxGuesses);
  return `${title.trim()}\n${row}\n${s.score ?? 0}/${s.maxScore}${s.hintUsed ? ' 💡' : ''}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function Countdown({ seconds, onZero }: { seconds: number; onZero?: () => void }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const end = Date.now() + seconds * 1000;
    const timer = setInterval(() => {
      const remaining = Math.round((end - Date.now()) / 1000);
      setLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        onZero?.();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds, onZero]);
  return <span>{clock(left)}</span>;
}

export default function Game({ gameKey }: { gameKey: string }) {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [guess, setGuess] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // Stage currently on screen, and the sharper stage being drawn over it.
  const [shown, setShown] = useState(0);
  const [incoming, setIncoming] = useState<number | null>(null);
  const [incomingReady, setIncomingReady] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const apply = useCallback((next: GameState, animate: boolean) => {
    setState(next);
    if (!next.available) return;
    setShown((current) => {
      if (animate && current > 0 && next.stage > current) {
        setIncomingReady(false);
        setIncoming(next.stage);
        return current;
      }
      setIncoming(null);
      return next.stage;
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/game?key=${encodeURIComponent(gameKey)}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the puzzle.');
      setError('');
      apply(data as GameState, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the puzzle.');
    }
  }, [gameKey, apply]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch('/api/game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: gameKey, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed.');
      return data as { state: GameState; result?: GuessResult };
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Connection lost. Try again.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const finishEnhance = () => {
    setIncoming((stage) => {
      if (stage) setShown(stage);
      return null;
    });
  };

  if (error) {
    return (
      <div className="window">
        <div className="titlebar">
          <span>System error</span>
        </div>
        <div className="window-body empty">
          <h2>Signal lost</h2>
          <p>{error}</p>
          <div className="row">
            <button className="btn" onClick={load}>
              Retry
            </button>
            <Link className="btn" href="/">
              Daily case
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <p className="label cursor" role="status">
        Establishing uplink
      </p>
    );
  }

  if (!state.available) {
    return (
      <div className="window">
        <div className="titlebar">
          <span>No transmission</span>
        </div>
        <div className="window-body empty">
          <div className="static" aria-hidden="true" />
          <h1>No case today</h1>
          <p>
            Nothing has been transmitted for {state.date}. The next case is expected in{' '}
            <strong>
              <Countdown seconds={state.nextInSeconds} onZero={load} />
            </strong>
            .
          </p>
          {state.hasArchive && (
            <Link className="btn primary" href="/archive">
              Practise on past cases
            </Link>
          )}
        </div>
      </div>
    );
  }

  const s = state;
  const finished = s.status !== 'playing';
  const enhancing = incoming !== null;
  const viewStage = incoming ?? shown;
  const guessNumber = s.guesses.length + 1;
  const penalty = s.hintUsed ? s.hintPenalty : 0;
  const src = (stage: number) => `${s.imageBase}/${stage}?v=${s.imageVersion}`;
  const layerClass = (stage: number) =>
    `layer${s.stages[stage - 1]?.mono ? ' mono' : ''}${stage >= s.maxGuesses ? ' final' : ''}`;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || finished || !guess.trim()) return;
    const data = await act({ action: 'guess', guess });
    if (!data) return;
    apply(data.state, true);
    const next = data.state as Playable;
    switch (data.result) {
      case 'correct':
        setMessage('Match confirmed. Restoring full image.');
        setGuess('');
        break;
      case 'incorrect':
        setGuess('');
        setMessage(
          next.status === 'lost'
            ? 'No match. Out of guesses.'
            : `No match. Running enhancement pass ${next.stage} of ${next.maxGuesses}.`,
        );
        break;
      case 'duplicate':
        setMessage('Already tried that one — not counted.');
        break;
      case 'empty':
        setMessage('Enter a guess first.');
        break;
      default:
        setMessage('');
    }
    if (next.available && next.status === 'playing') input.current?.focus();
  };

  const requestHint = async () => {
    if (busy || finished || s.hintUsed) return;
    const data = await act({ action: 'hint' });
    if (data) {
      apply(data.state, false);
      setMessage(`Theme hint decoded. ${s.hintPenalty} points deducted.`);
    }
  };

  const replay = async () => {
    const data = await act({ action: 'reset' });
    if (data) {
      setMessage('');
      setGuess('');
      setShown(0);
      apply(data.state, false);
    }
  };

  const share = shareText(s);
  const title =
    s.mode === 'preview' ? 'Preview' : `Case ${caseNumber(s.number)}`;

  return (
    <section className="game" aria-label="Pixle puzzle">
      {s.mode === 'practice' && (
        <p className="banner">
          <span>Practice mode — archive case from {s.date}. Does not affect your streak or statistics.</span>
        </p>
      )}
      {s.mode === 'preview' && (
        <p className="banner">
          <span>Admin preview — exactly what players see. Nothing here is recorded or scheduled.</span>
        </p>
      )}

      <div className="casebar">
        <h1>{title}</h1>
        <span className="dim">
          {s.mode === 'daily' ? `Daily · ${s.date}` : s.mode === 'practice' ? `Archive · ${s.date}` : 'Test play'}
        </span>
      </div>

      <div className="viewport-frame">
        <div className="viewport-pad">
          <div
            className="viewport"
            style={{
              aspectRatio: `${s.width} / ${s.height}`,
              width: `min(100%, calc(min(56vh, 560px) * ${s.width} / ${s.height}))`,
            }}
          >
            {shown > 0 && (
              <div className={layerClass(shown)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src(shown)}
                  alt={finished ? s.answer ?? 'The mystery image' : `Mystery image, enhancement pass ${shown} of ${s.maxGuesses}`}
                  draggable={false}
                />
              </div>
            )}
            {incoming !== null && (
              <>
                <div
                  className={`${layerClass(incoming)} incoming${incomingReady ? ' run' : ''}`}
                  onAnimationEnd={finishEnhance}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src(incoming)}
                    alt=""
                    draggable={false}
                    onLoad={() => setIncomingReady(true)}
                    onError={finishEnhance}
                  />
                </div>
                {incomingReady && <div className="scanbar" aria-hidden="true" />}
              </>
            )}
          </div>
        </div>
        <div className="readout">
          <span className={enhancing ? 'cursor' : undefined}>
            {enhancing ? `Enhancing — pass ${viewStage}/${s.maxGuesses}` : `Pass ${viewStage}/${s.maxGuesses} — ${PASS_NAMES[viewStage - 1]}`}
          </span>
          <span className="dim">{stageSpec(s.stages[viewStage - 1])}</span>
        </div>
      </div>

      <ol className="passes" aria-label="Guesses">
        {Array.from({ length: s.maxGuesses }, (_, i) => {
          const g = s.guesses[i];
          const kind = g ? (g.correct ? 'hit' : 'miss') : !finished && i === s.guesses.length ? 'current' : 'idle';
          const points = Math.max(0, s.points[i] - penalty);
          return (
            <li key={i} className={`pass ${kind}`}>
              <span>
                {g ? (g.correct ? 'Match' : 'Miss') : `Guess ${i + 1}`}
              </span>
              <b>
                {g && !g.correct ? (
                  '✕'
                ) : (
                  <>
                    {points}
                    <span className="pts-label" style={{ fontSize: 14 }}> pts</span>
                  </>
                )}
              </b>
            </li>
          );
        })}
      </ol>

      {s.guesses.length > 0 && (
        <ol className="log" aria-label="Guess log">
          {s.guesses.map((g, i) => (
            <li key={i}>
              <span className="dim">{String(i + 1).padStart(2, '0')}</span>
              <span className="g">{g.text}</span>
              <span className="dots" aria-hidden="true" />
              <span className={`verdict${g.correct ? ' ok' : ''}`}>{g.correct ? 'MATCH' : 'NO MATCH'}</span>
            </li>
          ))}
        </ol>
      )}

      <p className="status-line" role="status" aria-live="polite">
        {message && `> ${message}`}
      </p>

      {!finished && (
        <>
          <form className="guess-form" onSubmit={submit}>
            <label className="prompt">
              <span aria-hidden="true">&gt;</span>
              <input
                ref={input}
                value={guess}
                onChange={(e) => setGuess(e.target.value)}
                placeholder="Identify the subject"
                aria-label={`Guess ${guessNumber} of ${s.maxGuesses}: what is in the image?`}
                maxLength={80}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="send"
              />
            </label>
            <button className="btn primary" disabled={busy || !guess.trim()}>
              Submit
            </button>
          </form>

          <div className="hint-row">
            {s.hintUsed ? (
              <div className="hint-box">
                <span>
                  <span className="label">Theme hint</span>
                  <strong>{s.hint}</strong>
                </span>
                <span className="label">−{s.hintPenalty} pts applied</span>
              </div>
            ) : (
              <button type="button" className="btn hint" onClick={requestHint} disabled={busy}>
                <span>? Decode theme hint · −{s.hintPenalty} pts</span>
              </button>
            )}
          </div>
        </>
      )}

      {finished && (
        <div className="window result">
          <div className="titlebar">
            <span>{s.status === 'won' ? 'Case closed' : 'Case unsolved'}</span>
          </div>
          <div className="window-body">
            <div>
              <h2>{s.mode === 'preview' ? 'Pixle preview' : `Pixle ${caseNumber(s.number)}`}</h2>
              <p className="headline">
                {s.status === 'won'
                  ? `Solved in ${s.guesses.length}/${s.maxGuesses} guesses!`
                  : `Not identified in ${s.maxGuesses} guesses.`}
              </p>
            </div>
            <p className="answer-line">
              <span className="label">The subject was</span>
              <strong>{s.answer}</strong>
            </p>
            <dl className="facts">
              <div>
                <dt>Score</dt>
                <dd>
                  {s.score}/{s.maxScore}
                </dd>
              </div>
              <div>
                <dt>Guesses</dt>
                <dd>
                  {s.guesses.length}/{s.maxGuesses}
                </dd>
              </div>
              <div>
                <dt>Hints used</dt>
                <dd>{s.hintUsed ? 1 : 0}</dd>
              </div>
            </dl>
            {s.hintUsed && <p className="dim">Theme hint: {s.hint}</p>}
            <pre className="share" aria-label="Shareable result">
              {share.split('\n').map((line, i) => (
                <span key={i} className={i === 1 ? 'emoji' : undefined}>
                  {line + '\n'}
                </span>
              ))}
            </pre>
            <div className="row">
              <button
                className="btn primary"
                onClick={async () => {
                  setCopied(await copyText(share));
                  setTimeout(() => setCopied(false), 2500);
                }}
              >
                {copied ? 'Copied ✓' : 'Copy result'}
              </button>
              {s.mode !== 'daily' && (
                <button className="btn" onClick={replay} disabled={busy}>
                  Replay
                </button>
              )}
              {s.mode !== 'preview' && (
                <>
                  <Link className="btn" href="/stats">
                    View statistics
                  </Link>
                  <Link className="btn" href="/archive">
                    {s.mode === 'daily' ? 'Practise older cases' : 'Back to archive'}
                  </Link>
                </>
              )}
            </div>
            {s.mode === 'daily' && (
              <p className="label">
                Next case in <Countdown seconds={s.nextInSeconds} onZero={load} />
              </p>
            )}
            {s.credit && (s.credit.creator || s.credit.licence || s.credit.sourceUrl) && (
              <p className="credit">
                Image: {[s.credit.creator, s.credit.licence].filter(Boolean).join(' · ')}
                {s.credit.sourceUrl && /^https?:\/\//.test(s.credit.sourceUrl) && (
                  <>
                    {' · '}
                    <a href={s.credit.sourceUrl} target="_blank" rel="noreferrer noopener">
                      source
                    </a>
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
