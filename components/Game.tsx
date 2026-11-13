'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MonitorScreen from '@/components/monitor/MonitorScreen';
import type { Line, ScreenView } from '@/components/monitor/painter';
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

/**
 * The plain HTML/CSS computer. It is always in the page: when the 3D monitor is running it is
 * visually hidden and serves as the real controls (text input, buttons) and the accessible
 * version of the screen; when WebGL is not available it is simply shown instead.
 */
function Computer({
  children,
  onClick,
  overlay,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  overlay?: React.ReactNode;
}) {
  return (
    <div className="rig">
      <div className="computer">
        <div className="bezel">
          <div className="crt" onClick={onClick}>
            {children}
            {overlay}
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
  // How the computer is drawn: the 3D monitor, or plain CSS when WebGL is not available.
  const [renderer, setRenderer] = useState<'pending' | '3d' | 'css'>('pending');
  const [portrait, setPortrait] = useState<boolean | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [matchFlash, setMatchFlash] = useState(0);
  const root = useRef<HTMLDivElement>(null);
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

  // One request at a time: two first-visit requests at once would each be given a
  // different player cookie, and the picture would then be refused.
  const loading = useRef<{ key: string; done: Promise<void> } | null>(null);
  useEffect(() => {
    if (loading.current?.key === gameKey) return;
    const entry = { key: gameKey, done: load() };
    loading.current = entry;
    entry.done.finally(() => {
      if (loading.current === entry) loading.current = null;
    });
  }, [load, gameKey]);

  // Narrow screens get a tall monitor with the picture above the terminal.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 700px)');
    const update = () => setPortrait(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // With a keyboard and mouse, typing should work straight away.
  const playing = state?.available === true && state.status === 'playing' && bootStep < 0;
  useEffect(() => {
    if (renderer === '3d' && playing && window.matchMedia('(pointer: fine)').matches) {
      input.current?.focus({ preventScroll: true });
    }
  }, [renderer, playing]);

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
    const skip = (e: KeyboardEvent) => {
      // Swallow the key so it is not also typed into the guess box.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key !== 'Tab') e.preventDefault();
      setBootStep(-1);
    };
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

  // A click on the 3D screen: press the control under it, otherwise start typing.
  const pick = (id: string | null) => {
    if (id) {
      root.current?.querySelector<HTMLElement>(`[data-hit="${id}"]`)?.click();
      if (id !== 'submit') return;
    }
    if (bootStep >= 0) setBootStep(-1);
    else input.current?.focus();
  };

  const common = { focus: focusId, flash: matchFlash };
  let view: ScreenView;
  let content: React.ReactNode;
  let overlay: React.ReactNode = null;
  let onScreenClick: (() => void) | undefined;

  // ---------------------------------------------------------------- boot / loading / errors

  if (bootStep >= 0 || (!state && !error)) {
    const lines = bootStep >= 0 ? BOOT_LINES.slice(0, bootStep) : ['ACQUIRING SIGNAL'];
    view = {
      ...common,
      kind: 'lines',
      session: 'boot',
      lines: [
        ...lines.map((line, i): Line => ({ segs: [line], cursor: i === lines.length - 1 })),
        ...(lines.length === 0 ? [{ segs: [], cursor: true }] : []),
      ],
      footer: bootStep >= 0 ? 'Press any key to skip' : undefined,
    };
    onScreenClick = bootStep >= 0 ? () => setBootStep(-1) : undefined;
    content = (
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
    );
  } else if (error) {
    view = {
      ...common,
      kind: 'lines',
      session: 'error',
      lines: [
        { segs: ['*** SYSTEM ERROR ***'] },
        { segs: [error] },
        { segs: [{ btn: 'Retry', id: 'retry' }, { btn: 'Daily puzzle', id: 'home' }], gap: true },
      ],
    };
    content = (
        <div className="screen boot">
          <div className="term">
            <p>*** SYSTEM ERROR ***</p>
            <p>{error}</p>
            <p className="term-actions">
              <button className="tbtn" data-hit="retry" onClick={load}>
                Retry
              </button>
              <Link className="tbtn" data-hit="home" href="/">
                Daily puzzle
              </Link>
            </p>
          </div>
        </div>
    );
  } else if (!state) {
    return null;
  } else if (!state.available) {
    view = {
      ...common,
      kind: 'lines',
      session: 'none',
      lines: [
        { segs: ['SCANNING FOR SIGNAL ........'] },
        { segs: [{ chip: 'NO SIGNAL' }] },
        { segs: ['NO IMAGE HAS BEEN TRANSMITTED TODAY.'] },
        { segs: ['CHECK BACK TOMORROW'], cursor: true },
        ...(state.hasArchive ? [{ segs: [{ btn: 'Open the archive', id: 'archive' }], gap: true }] : []),
      ],
    };
    content = (
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
                <Link className="tbtn" data-hit="archive" href="/archive">
                  Open the archive
                </Link>
              </p>
            )}
          </div>
        </div>
    );
  } else {
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
        setMatchFlash((n) => n + 1);
      // falls through
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

  const hasCredit = !!s.credit && !!(s.credit.creator || s.credit.licence || s.credit.sourceUrl);
  const hasSource = !!s.credit?.sourceUrl && /^https?:\/\//.test(s.credit.sourceUrl);
  const lines: Line[] = [{ segs: ['IMAGE RECOVERY TERMINAL'] }];
  if (s.mode === 'practice') lines.push({ segs: [`PRACTICE MODE. ARCHIVE ${s.date}. NOT COUNTED.`], soft: true });
  if (s.mode === 'preview') lines.push({ segs: ['ADMIN PREVIEW. NOTHING IS RECORDED.'], soft: true });
  lines.push({
    segs: [`UNKNOWN SUBJECT. IDENTIFY IT IN ${s.maxGuesses} GUESSES. EACH MISS ENHANCES THE IMAGE.`],
    soft: true,
  });
  s.guesses.forEach((g, i) => {
    lines.push({ segs: [`> ${g.text}`, { chip: g.correct ? 'MATCH' : 'NO MATCH' }], gap: i === 0 });
    if (!g.correct && i < s.maxGuesses - 1) {
      lines.push({ segs: [`ENHANCING IMAGE ... PASS ${i + 2}/${s.maxGuesses}`], soft: true });
    }
  });
  if (s.hintUsed) lines.push({ segs: ['THEME HINT:', { chip: s.hint ?? '' }, { soft: `(-${s.hintPenalty} PTS)` }], gap: true });
  if (message) lines.push({ segs: [message] });
  if (finished) {
    lines.push(
      { segs: [s.status === 'won' ? '*** SUBJECT IDENTIFIED ***' : '*** OUT OF GUESSES ***'], gap: true },
      { segs: ['ANSWER:', { chip: s.answer ?? '' }] },
      {
        segs: [
          s.status === 'won'
            ? `SOLVED IN ${s.guesses.length}/${s.maxGuesses} GUESSES`
            : `NOT SOLVED IN ${s.maxGuesses} GUESSES`,
        ],
      },
      { segs: [`SCORE ${s.score}/${s.maxScore} · HINTS USED ${s.hintUsed ? 1 : 0}`] },
    );
    if (s.mode !== 'daily') lines.push({ segs: [{ btn: 'Replay', id: 'replay' }], gap: true });
    if (hasCredit) {
      lines.push({
        segs: [
          { soft: `IMAGE: ${[s.credit?.creator, s.credit?.licence].filter(Boolean).join(' · ')}` },
          ...(hasSource ? [{ btn: 'Source', id: 'source' }] : []),
        ],
        gap: true,
      });
    }
  }
  const paintStage = viewStage || s.stage;
  view = {
    ...common,
    kind: 'play',
    session: s.imageBase,
    image: { url: src(paintStage), stage: paintStage, aspect: s.width / s.height, smooth: paintStage > s.maxGuesses },
    readout: [
      original ? 'ORIGINAL IMAGE' : `ENHANCE PASS ${paintStage}/${s.maxGuesses}`,
      original ? '' : `RES ${s.stages[paintStage - 1]?.blocks}PX`,
    ],
    lines,
    console: finished
      ? null
      : {
          info: `GUESS ${guessNumber}/${s.maxGuesses} · WORTH ${worth} PTS`,
          text: guess,
          placeholder: 'WHAT IS IT?',
          typing: focusId === 'input',
          hint: s.hintUsed ? null : `? Theme hint (-${s.hintPenalty} pts, no guess used)`,
        },
  };
  overlay = matchFlash > 0 && (
    <div key={matchFlash} className="match-flash" aria-hidden="true">
      <span>MATCH</span>
    </div>
  );

  content = (
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
                    <button className="tbtn" data-hit="replay" onClick={replay} disabled={busy}>
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
                        <a data-hit="source" href={s.credit.sourceUrl} target="_blank" rel="noreferrer noopener">
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
                  data-hit="input"
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
                <button className="tbtn solid" data-hit="submit" disabled={busy || !guess.trim()}>
                  Enter
                </button>
              </form>
              {!s.hintUsed && (
                <button type="button" className="tbtn hint" data-hit="hint" onClick={requestHint} disabled={busy}>
                  ? Theme hint (-{s.hintPenalty} pts, no guess used)
                </button>
              )}
            </div>
          )}
        </div>
      </section>
  );
  }

  return (
    <GameFrame
      view={view}
      renderer={renderer}
      portrait={portrait}
      rootRef={root}
      onPick={pick}
      onRenderer={setRenderer}
      onFocusId={setFocusId}
    >
      <Computer onClick={onScreenClick} overlay={overlay}>
        {content}
      </Computer>
    </GameFrame>
  );
}

/** Puts the 3D monitor in front of the HTML computer (or shows the HTML one when there is no WebGL). */
function GameFrame({
  view,
  renderer,
  portrait,
  rootRef,
  onPick,
  onRenderer,
  onFocusId,
  children,
}: {
  view: ScreenView;
  renderer: 'pending' | '3d' | 'css';
  portrait: boolean | null;
  rootRef: React.RefObject<HTMLDivElement | null>;
  onPick: (id: string | null) => void;
  onRenderer: (r: '3d' | 'css') => void;
  onFocusId: (id: string | null) => void;
  children: React.ReactNode;
}) {
  // Only hand the painter a new object when something on screen really changed.
  const key = JSON.stringify(view);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => view, [key]);
  const css = renderer === 'css';
  return (
    <div ref={rootRef} className={css ? undefined : `rig3d${portrait ? ' portrait' : ''}`}>
      {!css && portrait !== null && (
        <MonitorScreen
          key={portrait ? 'p' : 'l'}
          view={stable}
          portrait={portrait}
          onPick={onPick}
          onReady={() => onRenderer('3d')}
          onFail={() => onRenderer('css')}
        />
      )}
      <div
        className={css ? undefined : 'rig-dom'}
        onFocus={(e) => onFocusId((e.target as HTMLElement).dataset.hit ?? null)}
        onBlur={() => onFocusId(null)}
      >
        {children}
      </div>
    </div>
  );
}
