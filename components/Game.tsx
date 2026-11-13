'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState, GuessResult } from '@/lib/game';

type Playable = Extract<GameState, { available: true }>;

const BOOT_LINES = [
  'PIXLE BIOS V1.0   (C) PIXLE SYSTEMS',
  'CPU ............ OK',
  'MEMORY TEST .... 640K OK',
  'VIDEO .......... AMBER CRT',
  'DRIVE A: ....... MOUNTED',
  'LOADING IMAGE RECOVERY MODULE',
  'SCANNING FOR SIGNAL ........',
  'SIGNAL LOCKED. 1 CORRUPTED IMAGE FOUND.',
];
const BOOT_STEP_MS = 260;

/** The old computer the whole game lives in. Pure CSS: no WebGL, so it runs on anything. */
function Computer({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <div className="rig">
      <div className="computer">
        <div className="bezel">
          <div className="crt" onClick={onClick}>
            {children}
          </div>
        </div>
        <div className="chin" aria-hidden="true">
          <span className="chin-brand">PIXLE</span>
          <span className="chin-model">IR-5 Image Recovery Unit</span>
          <span className="chin-vents" />
          <span className="chin-led" />
        </div>
      </div>
      <div className="stand" aria-hidden="true" />
      <div className="foot" aria-hidden="true" />
    </div>
  );
}

export default function Game({ gameKey, boot = false }: { gameKey: string; boot?: boolean }) {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [guess, setGuess] = useState('');
  const [busy, setBusy] = useState(false);
  // Boot sequence: -1 = not needed / finished.
  const [bootStep, setBootStep] = useState(boot ? 0 : -1);
  // Stage currently on screen, and the sharper stage being drawn over it.
  const [shown, setShown] = useState(0);
  const [incoming, setIncoming] = useState<number | null>(null);
  const [incomingReady, setIncomingReady] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

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

  // Boot-up text, one line at a time. Skipped for people who prefer reduced motion.
  useEffect(() => {
    if (bootStep < 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || bootStep > BOOT_LINES.length) {
      setBootStep(-1);
      return;
    }
    const timer = setTimeout(() => setBootStep((n) => (n < 0 ? n : n + 1)), BOOT_STEP_MS);
    return () => clearTimeout(timer);
  }, [bootStep]);

  // Any key skips the boot sequence.
  useEffect(() => {
    if (bootStep < 0) return;
    const skip = () => setBootStep(-1);
    window.addEventListener('keydown', skip);
    return () => window.removeEventListener('keydown', skip);
  }, [bootStep]);

  // Keep the newest terminal output in view.
  const lineCount = state?.available ? state.guesses.length + (state.hintUsed ? 1 : 0) + (message ? 1 : 0) : 0;
  const status = state?.available ? state.status : '';
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lineCount, status, bootStep]);

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

  // ---------------------------------------------------------------- boot / loading / errors

  if (bootStep >= 0 || (!state && !error)) {
    const lines = bootStep >= 0 ? BOOT_LINES.slice(0, bootStep) : ['ACQUIRING SIGNAL'];
    return (
      <Computer onClick={bootStep >= 0 ? () => setBootStep(-1) : undefined}>
        <div className="screen boot" role="status" aria-label="Starting up">
          <div className="term">
            {lines.map((line, i) => (
              <p key={i} className={i === lines.length - 1 ? 'cursor' : undefined}>
                {line}
              </p>
            ))}
            {bootStep === 0 && <p className="cursor" />}
          </div>
          {bootStep >= 0 && <p className="boot-skip">Press any key to skip</p>}
        </div>
      </Computer>
    );
  }

  if (error) {
    return (
      <Computer>
        <div className="screen boot">
          <div className="term">
            <p>*** SYSTEM ERROR ***</p>
            <p>{error}</p>
            <p className="term-actions">
              <button className="tbtn" onClick={load}>
                Retry
              </button>
              <Link className="tbtn" href="/">
                Daily puzzle
              </Link>
            </p>
          </div>
        </div>
      </Computer>
    );
  }

  if (!state) return null;

  if (!state.available) {
    return (
      <Computer>
        <div className="screen boot">
          <div className="term">
            <p>SCANNING FOR SIGNAL ........</p>
            <p>
              <span className="chip">NO SIGNAL</span>
            </p>
            <p>NO IMAGE HAS BEEN TRANSMITTED TODAY.</p>
            <p className="cursor">CHECK BACK TOMORROW</p>
            {state.hasArchive && (
              <p className="term-actions">
                <Link className="tbtn" href="/archive">
                  Open the archive
                </Link>
              </p>
            )}
          </div>
        </div>
      </Computer>
    );
  }

  // ---------------------------------------------------------------- the game

  const s: Playable = state;
  const finished = s.status !== 'playing';
  const enhancing = incoming !== null;
  const viewStage = incoming ?? shown;
  const original = viewStage > s.maxGuesses;
  const guessNumber = s.guesses.length + 1;
  const penalty = s.hintUsed ? s.hintPenalty : 0;
  const worth = Math.max(0, (s.points[guessNumber - 1] ?? 0) - penalty);
  const src = (stage: number) => `${s.imageBase}/${stage}?v=${s.imageVersion}`;
  const layerClass = (stage: number) =>
    `layer${s.stages[stage - 1]?.mono ? ' mono' : ''}${stage > s.maxGuesses ? ' final' : ''}`;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || finished || !guess.trim()) return;
    const data = await act({ action: 'guess', guess });
    if (!data) return;
    apply(data.state, true);
    switch (data.result) {
      case 'correct':
      case 'incorrect':
        setGuess('');
        setMessage('');
        break;
      case 'duplicate':
        setMessage('ALREADY TRIED. NOT COUNTED.');
        break;
      case 'empty':
        setMessage('TYPE A GUESS FIRST.');
        break;
      default:
        setMessage('');
    }
    if (data.state.available && data.state.status === 'playing') input.current?.focus();
  };

  const requestHint = async () => {
    if (busy || finished || s.hintUsed) return;
    const data = await act({ action: 'hint' });
    if (data) {
      apply(data.state, false);
      setMessage('');
      input.current?.focus();
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

  return (
    <Computer>
      <section className="screen play" aria-label="Pixle puzzle">
        <div className="pane pane-image">
          <div
            className="viewport"
            style={{ aspectRatio: `${s.width} / ${s.height}`, ['--ratio' as string]: s.width / s.height }}
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
          <p className="readout">
            <span className={enhancing ? 'cursor' : undefined}>
              {enhancing
                ? 'ENHANCING'
                : original
                  ? 'ORIGINAL IMAGE'
                  : `ENHANCE PASS ${viewStage}/${s.maxGuesses}`}
            </span>
            {!original && <span>RES {s.stages[viewStage - 1]?.blocks}PX</span>}
          </p>
        </div>

        <div className="pane pane-term">
          <div className="term" ref={scroller} aria-live="polite">
            <p>IMAGE RECOVERY TERMINAL</p>
            {s.mode === 'practice' && <p className="soft">PRACTICE MODE. ARCHIVE {s.date}. NOT COUNTED.</p>}
            {s.mode === 'preview' && <p className="soft">ADMIN PREVIEW. NOTHING IS RECORDED.</p>}
            <p className="soft">
              UNKNOWN SUBJECT. IDENTIFY IT IN {s.maxGuesses} GUESSES. EACH MISS ENHANCES THE IMAGE.
            </p>

            {s.guesses.map((g, i) => (
              <div key={i} className="entry">
                <p className="entry-line">
                  <span className="entry-text">&gt; {g.text}</span>
                  <span className="chip">{g.correct ? 'MATCH' : 'NO MATCH'}</span>
                </p>
                {!g.correct && i < s.maxGuesses - 1 && (
                  <p className="soft">ENHANCING IMAGE ... PASS {i + 2}/{s.maxGuesses}</p>
                )}
              </div>
            ))}

            {s.hintUsed && (
              <p>
                THEME HINT: <span className="chip">{s.hint}</span>{' '}
                <span className="soft">(-{s.hintPenalty} PTS)</span>
              </p>
            )}

            {message && <p>{message}</p>}

            {finished && (
              <div className="outcome">
                <p>{s.status === 'won' ? '*** SUBJECT IDENTIFIED ***' : '*** OUT OF GUESSES ***'}</p>
                <p>
                  ANSWER: <span className="chip">{s.answer}</span>
                </p>
                <p>
                  {s.status === 'won'
                    ? `SOLVED IN ${s.guesses.length}/${s.maxGuesses} GUESSES`
                    : `NOT SOLVED IN ${s.maxGuesses} GUESSES`}
                </p>
                <p>
                  SCORE {s.score}/{s.maxScore} · HINTS USED {s.hintUsed ? 1 : 0}
                </p>
                {s.mode !== 'daily' && (
                  <p className="term-actions">
                    <button className="tbtn" onClick={replay} disabled={busy}>
                      Replay
                    </button>
                  </p>
                )}
                {s.credit && (s.credit.creator || s.credit.licence || s.credit.sourceUrl) && (
                  <p className="credit">
                    IMAGE: {[s.credit.creator, s.credit.licence].filter(Boolean).join(' · ')}
                    {s.credit.sourceUrl && /^https?:\/\//.test(s.credit.sourceUrl) && (
                      <>
                        {' · '}
                        <a href={s.credit.sourceUrl} target="_blank" rel="noreferrer noopener">
                          SOURCE
                        </a>
                      </>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>

          {!finished && (
            <div className="console">
              <p className="soft">
                GUESS {guessNumber}/{s.maxGuesses} · WORTH {worth} PTS
              </p>
              <form className="prompt" onSubmit={submit}>
                <span aria-hidden="true">&gt;</span>
                <input
                  ref={input}
                  value={guess}
                  onChange={(e) => setGuess(e.target.value)}
                  placeholder="WHAT IS IT?"
                  aria-label={`Guess ${guessNumber} of ${s.maxGuesses}: what is in the image?`}
                  maxLength={80}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="send"
                />
                <button className="tbtn solid" disabled={busy || !guess.trim()}>
                  Enter
                </button>
              </form>
              {!s.hintUsed && (
                <button type="button" className="tbtn hint" onClick={requestHint} disabled={busy}>
                  ? Theme hint (-{s.hintPenalty} pts, no guess used)
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </Computer>
  );
}
