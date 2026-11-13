'use client';

import { useEffect, useRef } from 'react';
import type { ScreenView } from './painter';

type Engine = {
  monitor: import('./createMonitor').Monitor;
  painter: ReturnType<typeof import('./painter').createPainter>;
};

/**
 * The 3D monitor with `view` painted on its screen.
 *
 * `onPick` receives the id of the on-screen control that was clicked, or null
 * for a click anywhere else. `onFail` is called when WebGL is unavailable (or
 * the context is lost) so the caller can show the plain HTML version instead.
 */
export default function MonitorScreen({
  view,
  portrait,
  onPick,
  onReady,
  onFail,
}: {
  view: ScreenView;
  portrait: boolean;
  onPick: (id: string | null) => void;
  onReady: () => void;
  onFail: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const latest = useRef({ view, onPick, onReady, onFail });
  latest.current = { view, onPick, onReady, onFail };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // three.js is only downloaded here, after the page itself is interactive.
        const [{ createMonitor }, { createPainter }] = await Promise.all([import('./createMonitor'), import('./painter')]);
        if (cancelled || !host.current) return;
        const family =
          (getComputedStyle(document.documentElement).getPropertyValue('--font-vt323').trim() || 'VT323') + ', monospace';
        const monitor = createMonitor(host.current, { portrait, onLost: () => latest.current.onFail() });
        const painter = createPainter(monitor, family);
        engine.current = { monitor, painter };
        painter.setView(latest.current.view);
        latest.current.onReady();
        document.fonts.load(`40px ${family}`).then(() => {
          if (engine.current?.monitor !== monitor) return;
          monitor.setBadge(family);
          painter.repaint();
        });
      } catch {
        if (!cancelled) latest.current.onFail();
      }
    })();
    return () => {
      cancelled = true;
      engine.current?.painter.dispose();
      engine.current?.monitor.dispose();
      engine.current = null;
    };
  }, [portrait]);

  useEffect(() => {
    engine.current?.painter.setView(view);
  }, [view]);

  const controlAt = (e: { clientX: number; clientY: number }) => {
    const en = engine.current;
    const p = en?.monitor.pick(e.clientX, e.clientY);
    return p && en ? en.painter.hit(p.x, p.y) : null;
  };

  return (
    <div
      ref={host}
      className="monitor-host"
      aria-hidden="true"
      onClick={(e) => onPick(controlAt(e))}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') e.currentTarget.style.cursor = controlAt(e) ? 'pointer' : 'default';
      }}
    />
  );
}
