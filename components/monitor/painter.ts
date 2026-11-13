/**
 * Paints the game's screen (the same text and controls as the plain HTML
 * version) onto the monitor's display canvas.
 */

import type { Monitor } from './createMonitor';

export type Seg = string | { chip: string } | { soft: string } | { btn: string; id: string };
export type Line = { segs: Seg[]; soft?: boolean; cursor?: boolean; gap?: boolean };

export type ScreenView = {
  /** Changes when a different game is loaded or replayed (stops the enhance wipe). */
  session: string;
  /** Id of the control that has keyboard focus, if any. */
  focus: string | null;
  /** Bump to flash the MATCH box. */
  flash: number;
} & (
  | { kind: 'lines'; lines: Line[]; footer?: string }
  | {
      kind: 'play';
      image: { url: string; stage: number; aspect: number; smooth: boolean };
      readout: [string, string];
      lines: Line[];
      console: null | { info: string; text: string; placeholder: string; typing: boolean; hint: string | null };
    }
);

const BG = '#120a01';
const AMBER = '#ffb000';
const DIM = '#b37b00';
const WIPE_MS = 1100;
const FLASH_STEP_MS = 260;
const FLASH_STEPS = 7; // on, off, on, off, on, off, on → then gone

type Token = { text: string; style: 'n' | 'soft' | 'chip' | 'btn'; id?: string };
type Placed = Token & { x: number; w: number };
type Row = { items: Placed[]; cursor: boolean; gap: boolean };
type Region = { id: string; x: number; y: number; w: number; h: number };

export function createPainter(monitor: Monitor, fontFamily: string) {
  const { ctx, canvas } = monitor;
  const W = canvas.width;
  const H = canvas.height;
  const portrait = H > W;
  const M = portrait ? 46 : 58; // keeps content clear of the bezel shadow
  const F = portrait ? 40 : 34; // body text
  const LH = F + 2;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const font = (px: number) => `${px}px ${fontFamily}`;

  let view: ScreenView | null = null;
  let regions: Region[] = [];
  let cursorOn = true;
  let disposed = false;
  let raf = 0;

  // Picture state: what is on screen now, and the sharper one being wiped in.
  type Pic = { url: string; stage: number; smooth: boolean; img: HTMLImageElement; session: string };
  let pic: Pic | null = null;
  let prev: Pic | null = null;
  let wipeStart = 0;
  let wantUrl = '';
  let flashSeen = 0;
  let flashStart = 0;

  const wiping = () => prev !== null && performance.now() - wipeStart < WIPE_MS;
  const flashing = () => flashStart > 0 && performance.now() - flashStart < FLASH_STEP_MS * FLASH_STEPS;

  function animate() {
    if (raf || disposed) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      paint();
      if (wiping() || flashing()) animate();
    });
  }

  function wantImage(image: { url: string; stage: number; smooth: boolean }, session: string) {
    if (image.url === wantUrl) return;
    wantUrl = image.url;
    const img = new Image();
    img.onload = () => {
      if (disposed || wantUrl !== image.url) return;
      const next: Pic = { ...image, img, session };
      if (pic && pic.session === session && next.stage > pic.stage && !reduced) {
        prev = pic;
        wipeStart = performance.now();
      } else {
        prev = null;
      }
      pic = next;
      animate();
    };
    img.onerror = () => {
      if (wantUrl === image.url) wantUrl = '';
    };
    img.src = image.url;
  }

  // ------------------------------------------------------------ text layout

  function tokens(line: Line): Token[] {
    const out: Token[] = [];
    for (const seg of line.segs) {
      if (typeof seg === 'string' || 'soft' in seg) {
        const text = typeof seg === 'string' ? seg : seg.soft;
        const style = typeof seg === 'string' && !line.soft ? 'n' : 'soft';
        for (const word of text.toUpperCase().split(/\s+/)) if (word) out.push({ text: word, style });
      } else if ('chip' in seg) {
        out.push({ text: seg.chip.toUpperCase(), style: 'chip' });
      } else {
        out.push({ text: seg.btn.toUpperCase(), style: 'btn', id: seg.id });
      }
    }
    return out;
  }

  function layout(lines: Line[], width: number, px: number): Row[] {
    ctx.font = font(px);
    const space = ctx.measureText(' ').width;
    const rows: Row[] = [];
    for (const line of lines) {
      let row: Row = { items: [], cursor: false, gap: !!line.gap };
      let x = 0;
      const wrap = () => {
        rows.push(row);
        row = { items: [], cursor: false, gap: false };
        x = 0;
      };
      for (const tok of tokens(line)) {
        const pad = tok.style === 'chip' ? 9 : tok.style === 'btn' ? 14 : 0;
        let text = tok.text;
        // Break anything longer than a whole line.
        while (ctx.measureText(text).width + pad * 2 > width && text.length > 1) {
          if (x > 0) wrap();
          let n = text.length - 1;
          while (n > 1 && ctx.measureText(text.slice(0, n)).width + pad * 2 > width) n--;
          row.items.push({ ...tok, text: text.slice(0, n), x: 0, w: ctx.measureText(text.slice(0, n)).width + pad * 2 });
          wrap();
          text = text.slice(n);
        }
        const w = ctx.measureText(text).width + pad * 2;
        if (x > 0 && x + w > width) wrap();
        row.items.push({ ...tok, text, x, w });
        x += w + space;
      }
      row.cursor = !!line.cursor;
      rows.push(row);
    }
    return rows;
  }

  function button(id: string, label: string, x: number, y: number, w: number, h: number, px: number, solid = false) {
    const lit = solid || view?.focus === id;
    ctx.lineWidth = 3;
    ctx.strokeStyle = AMBER;
    ctx.fillStyle = AMBER;
    if (lit) ctx.fillRect(x, y, w, h);
    else ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    if (solid && view?.focus === id) {
      ctx.strokeStyle = BG;
      ctx.strokeRect(x + 5.5, y + 5.5, w - 11, h - 11);
    }
    ctx.fillStyle = lit ? BG : AMBER;
    ctx.font = font(px);
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1, w - 12);
    ctx.textAlign = 'left';
    regions.push({ id, x: x - 6, y: y - 6, w: w + 12, h: h + 12 });
  }

  /** Draws rows inside a box; if there are too many, the newest (bottom) ones win. */
  function drawRows(rows: Row[], x: number, y: number, height: number, px: number) {
    const lh = px + 2;
    const heights = rows.map((r) => (r.items.some((i) => i.style === 'btn') ? lh + 16 : lh) + (r.gap ? lh * 0.45 : 0));
    let first = 0;
    let total = heights.reduce((a, b) => a + b, 0);
    while (total > height && first < rows.length - 1) total -= heights[first++];
    let cy = y;
    ctx.font = font(px);
    ctx.textAlign = 'left';
    for (let r = first; r < rows.length; r++) {
      const row = rows[r];
      const rh = heights[r] - (row.gap ? lh * 0.45 : 0);
      if (row.gap) cy += lh * 0.45;
      const mid = cy + rh / 2 + 1;
      let end = 0;
      for (const it of row.items) {
        end = it.x + it.w;
        if (it.style === 'btn') {
          button(it.id!, it.text, x + it.x, cy + 4, it.w, rh - 8, px - 4);
          ctx.font = font(px);
        } else if (it.style === 'chip') {
          ctx.fillStyle = AMBER;
          ctx.fillRect(x + it.x, cy + 2, it.w, rh - 4);
          ctx.fillStyle = BG;
          ctx.fillText(it.text, x + it.x + 9, mid);
        } else {
          ctx.fillStyle = it.style === 'soft' ? DIM : AMBER;
          ctx.fillText(it.text, x + it.x, mid);
        }
      }
      if (row.cursor && cursorOn) {
        ctx.fillStyle = AMBER;
        ctx.fillRect(x + end + (end ? 8 : 0), cy + 5, px * 0.45, rh - 10);
      }
      cy += rh;
    }
  }

  // ------------------------------------------------------------ screens

  function drawPicture(x: number, y: number, w: number, h: number, aspect: number) {
    let iw = w;
    let ih = iw / aspect;
    if (ih > h) {
      ih = h;
      iw = ih * aspect;
    }
    const ix = Math.round(x + (w - iw) / 2);
    const iy = Math.round(y + (h - ih) / 2);
    iw = Math.round(iw);
    ih = Math.round(ih);
    const put = (p: Pic, rows = 1) => {
      ctx.imageSmoothingEnabled = p.smooth;
      const sh = p.img.naturalHeight * rows;
      ctx.drawImage(p.img, 0, 0, p.img.naturalWidth, sh, ix, iy, iw, ih * rows);
    };
    if (!pic) {
      ctx.fillStyle = DIM;
      ctx.font = font(F);
      ctx.textAlign = 'center';
      ctx.fillText('RECEIVING IMAGE ...', ix + iw / 2, iy + ih / 2);
      ctx.textAlign = 'left';
    } else if (prev && wiping()) {
      const t = (performance.now() - wipeStart) / WIPE_MS;
      put(prev);
      put(pic, t);
      ctx.fillStyle = AMBER;
      ctx.fillRect(ix, iy + ih * t - 3, iw, 6);
    } else {
      prev = null;
      put(pic);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 3;
    ctx.strokeRect(ix - 1.5, iy - 1.5, iw + 3, ih + 3);
    return { x: ix, y: iy, w: iw, h: ih };
  }

  function drawConsole(c: NonNullable<Extract<ScreenView, { kind: 'play' }>['console']>, x: number, y: number, w: number) {
    const boxH = portrait ? 70 : 60;
    const hintH = portrait ? 56 : 48;
    ctx.fillStyle = DIM;
    ctx.font = font(F - 4);
    ctx.textAlign = 'left';
    ctx.fillText(c.info.toUpperCase(), x, y + LH / 2);
    const by = y + LH + 4;
    const enterW = portrait ? 130 : 112;
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, by + 1.5, w - enterW - 8 - 3, boxH - 3);
    // Typed text; when it is too long, keep the end in view.
    const big = F + 8;
    ctx.font = font(big);
    const room = w - enterW - 8 - 36 - big * 0.5;
    let text = c.text.toUpperCase();
    while (text && ctx.measureText('> ' + text).width > room) text = text.slice(1);
    ctx.fillStyle = AMBER;
    ctx.fillText('> ' + text, x + 14, by + boxH / 2 + 1);
    const tx = x + 14 + ctx.measureText('> ' + text).width;
    if (!text) {
      ctx.fillStyle = DIM;
      ctx.fillText(c.placeholder.toUpperCase(), tx + (c.typing ? big * 0.6 : 0), by + boxH / 2 + 1);
    }
    if (c.typing && cursorOn) {
      ctx.fillStyle = AMBER;
      ctx.fillRect(tx + 3, by + 12, big * 0.42, boxH - 24);
    }
    button('submit', 'ENTER', x + w - enterW, by, enterW, boxH, F, true);
    if (c.hint) button('hint', c.hint.toUpperCase(), x, by + boxH + 12, w, hintH, F - 6);
    return LH + 4 + boxH + (c.hint ? 12 + hintH : 0);
  }

  function paint() {
    if (disposed || !view) return;
    regions = [];
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    if (view.kind === 'lines') {
      const px = F + 4;
      drawRows(layout(view.lines, W - 2 * M - 30, px), M + 15, M + 14, H - 2 * M - 70, px);
      if (view.footer) {
        ctx.fillStyle = DIM;
        ctx.font = font(F - 4);
        ctx.textAlign = 'center';
        ctx.fillText(view.footer.toUpperCase(), W / 2, H - M - 22);
      }
    } else {
      const top = M;
      const bottom = H - M;
      const readoutH = LH + 6;
      const consoleH = view.console ? LH + 4 + (portrait ? 70 : 60) + (view.console.hint ? 12 + (portrait ? 56 : 48) : 0) : 0;
      let px: number, pw: number, logX: number, logY: number, logW: number, logH: number;
      let picBox: { x: number; y: number; w: number; h: number };
      if (portrait) {
        pw = W - 2 * M;
        picBox = drawPicture(M + 3, top + 3, pw - 6, 400, view.image.aspect);
        const ry = picBox.y + picBox.h + 4;
        px = M;
        let y = ry + readoutH + 6;
        if (view.console) y += drawConsole(view.console, M, y, pw) + 16;
        ctx.fillStyle = AMBER;
        ctx.fillRect(M, y - 8, pw, 2);
        logX = M;
        logY = y + 2;
        logW = pw;
        logH = bottom - logY;
      } else {
        pw = 390;
        px = M;
        picBox = drawPicture(M + 3, top + 3, pw - 6, bottom - top - readoutH - 6, view.image.aspect);
        logX = M + pw + 26;
        logW = W - M - logX;
        logY = top;
        logH = bottom - top - (consoleH ? consoleH + 18 : 0);
        if (view.console) {
          ctx.fillStyle = AMBER;
          ctx.fillRect(logX, bottom - consoleH - 10, logW, 2);
          drawConsole(view.console, logX, bottom - consoleH, logW);
        }
      }
      // readout under the picture
      const ry = picBox.y + picBox.h + 4 + readoutH / 2;
      ctx.font = font(F - 4);
      ctx.fillStyle = AMBER;
      ctx.textAlign = 'left';
      const enh = wiping();
      ctx.fillText(enh ? 'ENHANCING' + (cursorOn ? ' █' : '') : view.readout[0], px, ry);
      ctx.textAlign = 'right';
      ctx.fillStyle = DIM;
      ctx.fillText(view.readout[1], px + pw, ry);
      ctx.textAlign = 'left';

      drawRows(layout(view.lines, logW, F), logX, logY, logH, F);
    }

    // MATCH box: flashes in and out a few times in the middle of the screen.
    if (flashing()) {
      const step = Math.floor((performance.now() - flashStart) / FLASH_STEP_MS);
      if (step % 2 === 0) {
        const bw = portrait ? 520 : 560;
        const bh = portrait ? 210 : 200;
        const bx = (W - bw) / 2;
        const by = (H - bh) / 2;
        ctx.fillStyle = BG;
        ctx.fillRect(bx - 14, by - 14, bw + 28, bh + 28);
        ctx.fillStyle = AMBER;
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = BG;
        ctx.lineWidth = 5;
        ctx.strokeRect(bx + 12.5, by + 12.5, bw - 25, bh - 25);
        ctx.fillStyle = BG;
        ctx.font = font(150);
        ctx.textAlign = 'center';
        ctx.fillText('MATCH', W / 2, by + bh / 2 + 4);
        ctx.textAlign = 'left';
      }
    }

    monitor.commit();
  }

  const blink = window.setInterval(() => {
    cursorOn = !cursorOn;
    paint();
  }, 530);

  return {
    setView(next: ScreenView) {
      const first = view === null;
      if (view && next.session !== view.session) {
        pic = prev = null;
        wantUrl = '';
      }
      view = next;
      if (next.kind === 'play') wantImage(next.image, next.session);
      if (first) flashSeen = next.flash;
      else if (next.flash !== flashSeen) {
        flashSeen = next.flash;
        if (next.flash) {
          flashStart = performance.now();
          animate();
        }
      }
      cursorOn = true;
      paint();
    },
    /** The control (if any) at a point on the display canvas. */
    hit(x: number, y: number): string | null {
      for (let i = regions.length - 1; i >= 0; i--) {
        const r = regions[i];
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.id;
      }
      return null;
    },
    repaint: paint,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      clearInterval(blink);
    },
  };
}
