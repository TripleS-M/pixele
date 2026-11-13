'use client';

/**
 * Three.js monitor prototype (visit /prototype).
 *
 * A beige CRT built in code from three separate meshes — casing, inner bezel,
 * convex glass — with the amber display drawn on a 2D canvas and UV-mapped onto
 * the glass. Typing goes through a real (invisible) <input> laid over the scene.
 *
 * Self-contained on purpose: the puzzle below is hard-coded and does not touch
 * the real game API.
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

/* ----------------------------- tweakables -------------------------------- */

/** How far the centre of the glass rises above its edges (world units). */
const DEFAULT_BULGE = 0.2;
/** How much each side of the glass outline bows outward (fraction of size). */
const DEFAULT_BOW = 0.045;

const GLASS_W = 3.6;
const GLASS_H = 2.7;
/** Glass edges sit this far behind the front of the inner bezel rim (z = 0). */
const EDGE_Z = -0.1;
/** The bezel lip covers this much of the glass edge. */
const LIP = 0.965;

const PUZZLE = { image: '/prototype/mystery.png', answer: 'lighthouse' };
const STAGE_RES = [20, 32, 56, 110, 228];
const MAX_GUESSES = STAGE_RES.length;

const TEX_W = 1024;
const TEX_H = 768;
const AMBER = '#ffb000';
const AMBER_DIM = '#9a6a00';
const SCREEN_BG = '#120a01';

/* ------------------------------ geometry --------------------------------- */

function roundedRect(w: number, h: number, r: number, cx = 0, cy = 0, seg = 6): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const corners: [number, number, number][] = [
    [cx + w / 2 - r, cy - h / 2 + r, -Math.PI / 2],
    [cx + w / 2 - r, cy + h / 2 - r, 0],
    [cx - w / 2 + r, cy + h / 2 - r, Math.PI / 2],
    [cx - w / 2 + r, cy - h / 2 + r, Math.PI],
  ];
  for (const [x, y, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push(new THREE.Vector2(x + Math.cos(a) * r, y + Math.sin(a) * r));
    }
  }
  return pts;
}

/** Glass surface: (u, v) in [-1, 1] → position. Sides bow outward, centre bulges. */
function glassPoint(u: number, v: number, bulge: number, bow: number, out: THREE.Vector3) {
  const a = 1 - u * u;
  const b = 1 - v * v;
  out.set(
    (GLASS_W / 2) * u * (1 + bow * b),
    (GLASS_H / 2) * v * (1 + bow * a),
    EDGE_Z + bulge * (0.75 * a * b + 0.125 * (a + b)),
  );
  return out;
}

/** The outline of the glass (the shape from the sketch), as a closed 2D loop. */
function glassOutline(bow: number, scale: number, perEdge = 24): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const p = new THREE.Vector3();
  const push = (u: number, v: number) => {
    glassPoint(u, v, 0, bow, p);
    pts.push(new THREE.Vector2(p.x * scale, p.y * scale));
  };
  for (let i = 0; i < perEdge; i++) push(-1 + (2 * i) / perEdge, -1);
  for (let i = 0; i < perEdge; i++) push(1, -1 + (2 * i) / perEdge);
  for (let i = 0; i < perEdge; i++) push(1 - (2 * i) / perEdge, 1);
  for (let i = 0; i < perEdge; i++) push(-1, 1 - (2 * i) / perEdge);
  return pts;
}

function framed(outer: THREE.Vector2[], hole: THREE.Vector2[], depth: number, bevel: number) {
  const shape = new THREE.Shape(outer);
  shape.holes.push(new THREE.Path(hole));
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
}

/** Joins two rings with the same number of points into a band. */
function loft(a: THREE.Vector2[], za: number, b: THREE.Vector2[], zb: number) {
  const n = a.length;
  const pos = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    pos.set([a[i].x, a[i].y, za], i * 3);
    pos.set([b[i].x, b[i].y, zb], (n + i) * 3);
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i, j, n + i, j, n + j, n + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const GLASS_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vP;
  void main() {
    vUv = uv;
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vP = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const GLASS_FRAG = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vP;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(-vP);
    vec3 col = texture2D(map, vUv).rgb;

    // Shadow where the glass tucks under the bezel lip.
    float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float open = smoothstep(0.0, 0.085, e);
    col *= mix(0.08, 1.0, open);

    // Soft reflection of a window, up and to the left, plus a rim sheen.
    vec3 h = normalize(normalize(vec3(-0.3, 0.42, 0.85)) + v);
    float nh = max(dot(n, h), 0.0);
    float spec = pow(nh, 220.0) * 0.2 + pow(nh, 20.0) * 0.07;
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.22;
    col += vec3(1.0, 0.96, 0.88) * (spec + rim) * mix(0.35, 1.0, open);

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/* ------------------------------- display --------------------------------- */

const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30,
  54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23,
  61, 29, 53, 21,
];

const DOTS = 228; // the picture is DOTS x DOTS amber dots, each 2 canvas pixels

/** One enhancement stage: the image at `res` pixels, drawn as 1-bit amber dither. */
function ditherStage(lum: Float32Array, size: number, res: number): HTMLCanvasElement {
  // Box-average down to res x res.
  const low = new Float32Array(res * res);
  const cnt = new Uint16Array(res * res);
  for (let y = 0; y < size; y++) {
    const ly = Math.min(res - 1, Math.floor((y * res) / size));
    for (let x = 0; x < size; x++) {
      const i = ly * res + Math.min(res - 1, Math.floor((x * res) / size));
      low[i] += lum[y * size + x];
      cnt[i]++;
    }
  }
  const small = document.createElement('canvas');
  small.width = small.height = DOTS;
  const sctx = small.getContext('2d')!;
  const img = sctx.createImageData(DOTS, DOTS);
  for (let y = 0; y < DOTS; y++) {
    const ly = Math.floor((y * res) / DOTS);
    for (let x = 0; x < DOTS; x++) {
      const i = ly * res + Math.floor((x * res) / DOTS);
      const l = cnt[i] ? low[i] / cnt[i] : 0;
      const on = l * 0.94 + 0.03 > (BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64;
      const o = (y * DOTS + x) * 4;
      img.data[o] = on ? 255 : 18;
      img.data[o + 1] = on ? 176 : 10;
      img.data[o + 2] = on ? 0 : 1;
      img.data[o + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);
  const big = document.createElement('canvas');
  big.width = big.height = DOTS * 2;
  const bctx = big.getContext('2d')!;
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(small, 0, 0, DOTS * 2, DOTS * 2);
  return big;
}

type GameState = {
  text: string;
  guesses: { text: string; ok: boolean }[];
  stage: number; // index into STAGE_RES currently shown
  prevStage: number;
  reveal: number; // 0..1 progress of the enhancement wipe
  over: null | 'won' | 'lost';
  cursor: boolean;
};

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/* ------------------------------ the engine ------------------------------- */

function createPrototype(host: HTMLDivElement, input: HTMLInputElement, form: HTMLFormElement, fontFamily: string) {
  let disposed = false;

  // --- renderer -----------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.domElement.style.display = 'block';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#15120d');
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);

  scene.add(new THREE.HemisphereLight(0xfff3dc, 0x2e261a, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(-3, 5, 6);
  scene.add(key);
  const glow = new THREE.PointLight(0xffa514, 1.1, 3.2, 1.6); // screen light spilling onto the bezel
  glow.position.set(0, 0, 0.55);
  scene.add(glow);

  // --- casing (one merged-looking group of beige meshes) -------------------
  const beige = new THREE.MeshStandardMaterial({ color: '#cdc09b', roughness: 0.78, metalness: 0 });
  const beigeDark = new THREE.MeshStandardMaterial({ color: '#b3a783', roughness: 0.85, side: THREE.DoubleSide });
  const charcoal = new THREE.MeshStandardMaterial({ color: '#221f1a', roughness: 0.6 });

  const BODY_CY = -0.15;
  const CASE_H = 4.15; // the casing is taller below the screen (the chin)
  const casing = new THREE.Group();
  casing.name = 'casing';

  const frontDepth = 0.8;
  const front = new THREE.Mesh(
    framed(roundedRect(4.75, CASE_H, 0.28, 0, BODY_CY, 12), roundedRect(4.25, 3.35, 0.18, 0, 0, 12), frontDepth, 0.035),
    beige,
  );
  front.position.z = 0.335 - frontDepth; // front face ends up at z ≈ 0.37
  casing.add(front);

  // Sloped recess that funnels down from the casing front to the inner bezel.
  casing.add(new THREE.Mesh(loft(roundedRect(4.37, 3.47, 0.2, 0, 0, 12), 0.35, roundedRect(3.88, 2.98, 0.1, 0, 0, 12), 0.0), beigeDark));

  const rearA = new THREE.Mesh(
    new THREE.ExtrudeGeometry(new THREE.Shape(roundedRect(4.4, 3.8, 0.3, 0, BODY_CY, 12)), {
      depth: 1.7,
      bevelEnabled: true,
      bevelThickness: 0.06,
      bevelSize: 0.06,
      bevelSegments: 2,
    }),
    beige,
  );
  rearA.position.z = -0.4 - 1.7;
  casing.add(rearA);
  const rearB = new THREE.Mesh(
    new THREE.ExtrudeGeometry(new THREE.Shape(roundedRect(3.5, 3.0, 0.3, 0, BODY_CY, 12)), {
      depth: 0.8,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.08,
      bevelSegments: 2,
    }),
    beigeDark,
  );
  rearB.position.z = -2.1 - 0.8;
  casing.add(rearB);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 0.4, 28), beigeDark);
  neck.position.set(0, BODY_CY - CASE_H / 2 - 0.16, -1.0);
  casing.add(neck);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.7, 0.14, 40), beige);
  base.scale.z = 0.85;
  base.position.set(0, BODY_CY - CASE_H / 2 - 0.42, -1.0);
  casing.add(base);

  // Badge and power light on the chin.
  const badgeCanvas = document.createElement('canvas');
  badgeCanvas.width = 256;
  badgeCanvas.height = 64;
  const badgeTex = new THREE.CanvasTexture(badgeCanvas);
  badgeTex.colorSpace = THREE.SRGBColorSpace;
  const badge = new THREE.Mesh(
    new THREE.PlaneGeometry(0.88, 0.22),
    new THREE.MeshBasicMaterial({ map: badgeTex, transparent: true }),
  );
  badge.position.set(-1.62, -1.95, 0.375);
  casing.add(badge);
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.045, 16), new THREE.MeshBasicMaterial({ color: '#ffb000' }));
  led.position.set(1.95, -1.95, 0.375);
  casing.add(led);
  scene.add(casing);

  // --- inner bezel + glass (rebuilt when the shape sliders move) ------------
  let bulge = DEFAULT_BULGE;
  let bow = DEFAULT_BOW;

  const bezel = new THREE.Mesh(new THREE.BufferGeometry(), charcoal);
  bezel.name = 'inner-bezel';
  bezel.position.z = EDGE_Z; // extruded forward so its rim ends at z = 0
  scene.add(bezel);

  const texCanvas = document.createElement('canvas');
  texCanvas.width = TEX_W;
  texCanvas.height = TEX_H;
  const ctx = texCanvas.getContext('2d')!;
  const screenTex = new THREE.CanvasTexture(texCanvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  screenTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const glassGeo = new THREE.PlaneGeometry(2, 2, 48, 36);
  const uvGrid = Float32Array.from(glassGeo.attributes.position.array); // x = u, y = v
  const glass = new THREE.Mesh(
    glassGeo,
    new THREE.ShaderMaterial({ uniforms: { map: { value: screenTex } }, vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG }),
  );
  glass.name = 'screen';
  scene.add(glass);

  const tmp = new THREE.Vector3();
  function buildShape() {
    const pos = glassGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      glassPoint(uvGrid[i * 3], uvGrid[i * 3 + 1], bulge, bow, tmp);
      pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
    pos.needsUpdate = true;
    glassGeo.computeVertexNormals();
    glassGeo.computeBoundingSphere();
    bezel.geometry.dispose();
    bezel.geometry = framed(roundedRect(3.9, 3.0, 0.1), glassOutline(bow, LIP), -EDGE_Z, 0);
    invalidate();
  }

  // --- camera -------------------------------------------------------------
  const target = new THREE.Vector3(0, -0.2, 0);
  let side = 0; // 0 = face-on, 1 = angled
  let sideGoal = 0;
  function placeCamera() {
    const t = side * side * (3 - 2 * side);
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(4.5 / 2 / half, 4.95 / 2 / (half * camera.aspect)) + 0.4;
    const yaw = THREE.MathUtils.degToRad(50) * t;
    const pitch = THREE.MathUtils.degToRad(11) * t;
    const d = dist * (1 + 0.22 * t);
    camera.position.set(
      target.x + d * Math.sin(yaw) * Math.cos(pitch),
      target.y + d * Math.sin(pitch),
      target.z + d * Math.cos(yaw) * Math.cos(pitch),
    );
    camera.lookAt(target.x, target.y, target.z - 0.9 * t);
  }

  // --- game + display canvas ----------------------------------------------
  const state: GameState = { text: '', guesses: [], stage: 0, prevStage: 0, reveal: 1, over: null, cursor: true };
  const stages: (HTMLCanvasElement | null)[] = STAGE_RES.map(() => null);
  let lum: Float32Array | null = null;
  let lumSize = 0;
  const font = (px: number) => `${px}px ${fontFamily}, monospace`;

  function stageCanvas(i: number) {
    if (!lum) return null;
    return (stages[i] ??= ditherStage(lum, lumSize, STAGE_RES[i]));
  }

  function panel(x: number, y: number, w: number, h: number, title: string, right = '') {
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    ctx.fillStyle = AMBER;
    ctx.fillRect(x, y, w, 34);
    ctx.fillStyle = SCREEN_BG;
    ctx.font = font(30);
    ctx.textAlign = 'left';
    ctx.fillText(title, x + 12, y + 18);
    if (right) {
      ctx.textAlign = 'right';
      ctx.fillText(right, x + w - 12, y + 18);
    }
  }

  function chip(text: string, right: number, y: number) {
    ctx.font = font(28);
    const w = ctx.measureText(text).width + 18;
    ctx.fillStyle = AMBER;
    ctx.fillRect(right - w, y - 16, w, 32);
    ctx.fillStyle = SCREEN_BG;
    ctx.textAlign = 'center';
    ctx.fillText(text, right - w / 2, y + 1);
  }

  function draw() {
    const M = 54;
    ctx.fillStyle = SCREEN_BG;
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    ctx.textBaseline = 'middle';

    // header
    ctx.fillStyle = AMBER;
    ctx.fillRect(M, M, TEX_W - 2 * M, 42);
    ctx.fillStyle = SCREEN_BG;
    ctx.font = font(36);
    ctx.textAlign = 'left';
    ctx.fillText('PIXLE // IMAGE RECOVERY TERMINAL', M + 14, M + 22);
    ctx.textAlign = 'right';
    ctx.fillText(state.over === 'won' ? 'IDENTIFIED' : state.over === 'lost' ? 'SIGNAL LOST' : 'CASE OPEN', TEX_W - M - 14, M + 22);

    // image panel
    const py = 110;
    const ph = 34 + 10 + DOTS * 2 + 10;
    const pw = DOTS * 2 + 20;
    const res = STAGE_RES[state.stage];
    panel(M, py, pw, ph, `SUBJECT  PASS ${state.stage + 1}/${MAX_GUESSES}`, `${res}PX`);
    const ix = M + 10;
    const iy = py + 44;
    const now = stageCanvas(state.stage);
    if (!now) {
      ctx.fillStyle = AMBER_DIM;
      ctx.font = font(34);
      ctx.textAlign = 'center';
      ctx.fillText('RECEIVING IMAGE...', ix + DOTS, iy + DOTS);
    } else if (state.reveal >= 1) {
      ctx.drawImage(now, ix, iy);
    } else {
      const cut = Math.round(DOTS * 2 * state.reveal);
      const prev = stageCanvas(state.prevStage)!;
      ctx.drawImage(prev, ix, iy);
      if (cut > 0) ctx.drawImage(now, 0, 0, DOTS * 2, cut, ix, iy, DOTS * 2, cut);
      ctx.fillStyle = AMBER;
      ctx.fillRect(ix, iy + cut - 3, DOTS * 2, 6);
    }

    // analysis panel
    const rx = M + pw + 16;
    const rw = TEX_W - M - rx;
    panel(rx, py, rw, ph, 'ANALYSIS LOG');
    const left = MAX_GUESSES - state.guesses.filter((g) => !g.ok).length;
    ctx.fillStyle = AMBER;
    ctx.font = font(32);
    ctx.textAlign = 'left';
    ctx.fillText('GUESSES REMAINING', rx + 16, py + 62);
    ctx.textAlign = 'right';
    ctx.font = font(44);
    ctx.fillText(String(left), rx + rw - 16, py + 62);
    const bw = (rw - 32 - 4 * 10) / MAX_GUESSES;
    for (let i = 0; i < MAX_GUESSES; i++) {
      const bx = rx + 16 + i * (bw + 10);
      if (i < left) ctx.fillRect(bx, py + 88, bw, 22);
      else {
        ctx.lineWidth = 2;
        ctx.strokeRect(bx + 1, py + 89, bw - 2, 20);
      }
    }
    ctx.fillRect(rx + 16, py + 128, rw - 32, 2);

    state.guesses.forEach((g, i) => {
      const y = py + 160 + i * 46;
      ctx.fillStyle = AMBER;
      ctx.font = font(34);
      ctx.textAlign = 'left';
      ctx.fillText(`${i + 1} ${g.text.slice(0, 14)}`, rx + 16, y);
      if (g.ok) chip('MATCH', rx + rw - 16, y);
      else chip('NO MATCH', rx + rw - 16, y);
    });

    ctx.textAlign = 'left';
    ctx.font = font(32);
    const sy = py + ph - 62;
    if (state.over) {
      ctx.fillStyle = AMBER;
      ctx.fillText(state.over === 'won' ? 'SUBJECT IDENTIFIED:' : 'OUT OF GUESSES. IT WAS:', rx + 16, sy - 38);
      ctx.font = font(44);
      ctx.fillText(PUZZLE.answer.toUpperCase(), rx + 16, sy);
      ctx.font = font(28);
      ctx.fillStyle = AMBER_DIM;
      ctx.fillText('PRESS ENTER TO RESTART', rx + 16, sy + 38);
    } else {
      ctx.fillStyle = AMBER_DIM;
      ctx.fillText(state.reveal < 1 ? 'ENHANCING IMAGE...' : 'AWAITING INPUT', rx + 16, sy + 34);
    }

    // prompt
    const qy = py + ph + 14;
    const qh = TEX_H - M - qy;
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 3;
    ctx.strokeRect(M + 1.5, qy + 1.5, TEX_W - 2 * M - 3, qh - 3);
    ctx.fillStyle = AMBER;
    ctx.font = font(48);
    ctx.textAlign = 'left';
    const line = state.over ? '> ' : `> ${state.text.toUpperCase()}`;
    ctx.fillText(line, M + 18, qy + qh / 2 + 1);
    if (state.cursor) {
      const cx = M + 18 + ctx.measureText(line).width + 4;
      ctx.fillRect(cx, qy + qh / 2 - 19, 20, 38);
    }
    if (!state.over && !state.text) {
      ctx.fillStyle = AMBER_DIM;
      ctx.font = font(34);
      ctx.textAlign = 'right';
      ctx.fillText('TYPE A GUESS, THEN ENTER', TEX_W - M - 18, qy + qh / 2 + 1);
    }

    screenTex.needsUpdate = true;
    invalidate();
  }

  function submit() {
    if (state.over) {
      Object.assign(state, { text: '', guesses: [], stage: 0, prevStage: 0, reveal: 1, over: null });
      input.value = '';
      draw();
      return;
    }
    const text = state.text.trim();
    if (!text || state.reveal < 1) return;
    const ok = normalize(text) === normalize(PUZZLE.answer);
    state.guesses.push({ text: text.toUpperCase(), ok });
    state.text = '';
    input.value = '';
    const misses = state.guesses.filter((g) => !g.ok).length;
    if (ok) state.over = 'won';
    else if (misses >= MAX_GUESSES) state.over = 'lost';
    const next = ok || state.over ? STAGE_RES.length - 1 : misses;
    if (next !== state.stage) {
      state.prevStage = state.stage;
      state.stage = next;
      state.reveal = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0;
    }
    draw();
  }

  // --- render on demand: nothing is drawn while nothing changes -------------
  let raf = 0;
  let last = 0;
  function invalidate() {
    if (!raf && !disposed) raf = requestAnimationFrame(frame);
  }
  function frame(t: number) {
    raf = 0;
    const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016);
    last = t;
    let busy = false;
    if (side !== sideGoal) {
      side = sideGoal > side ? Math.min(sideGoal, side + dt / 0.9) : Math.max(sideGoal, side - dt / 0.9);
      placeCamera();
      busy = true;
    }
    if (state.reveal < 1) {
      state.reveal = Math.min(1, state.reveal + dt / 0.8);
      draw();
      busy = true;
    }
    renderer.render(scene, camera);
    if (busy) invalidate();
    else last = 0;
  }

  function resize() {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    placeCamera();
    invalidate();
  }

  // --- wiring -------------------------------------------------------------
  const onInput = () => {
    if (input.value.length > 22) input.value = input.value.slice(0, 22);
    state.text = state.over ? '' : input.value;
    state.cursor = true;
    draw();
  };
  const onSubmit = (e: Event) => {
    e.preventDefault();
    submit();
  };
  input.addEventListener('input', onInput);
  form.addEventListener('submit', onSubmit);
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  const blink = window.setInterval(() => {
    state.cursor = !state.cursor;
    draw();
  }, 530);

  buildShape();
  resize();
  draw();

  // The font and the picture arrive a moment later; redraw when they do.
  document.fonts.load(font(40)).then(() => {
    if (disposed) return;
    const b = badgeCanvas.getContext('2d')!;
    b.font = font(60);
    b.fillStyle = '#5b5238';
    b.textBaseline = 'middle';
    b.fillText('Pixle', 4, 34);
    badgeTex.needsUpdate = true;
    draw();
  });
  const img = new Image();
  img.onload = () => {
    if (disposed) return;
    const size = Math.min(img.naturalWidth, img.naturalHeight, 400);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const cctx = c.getContext('2d', { willReadFrequently: true })!;
    cctx.drawImage(img, 0, 0, size, size);
    const d = cctx.getImageData(0, 0, size, size).data;
    lum = new Float32Array(size * size);
    lumSize = size;
    for (let i = 0; i < size * size; i++) {
      lum[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    }
    draw();
  };
  img.src = PUZZLE.image;

  return {
    setBulge(v: number) {
      bulge = v;
      buildShape();
    },
    setBow(v: number) {
      bow = v;
      buildShape();
    },
    setSide(on: boolean) {
      sideGoal = on ? 1 : 0;
      invalidate();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      clearInterval(blink);
      ro.disconnect();
      input.removeEventListener('input', onInput);
      form.removeEventListener('submit', onSubmit);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      screenTex.dispose();
      badgeTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/* ------------------------------ component -------------------------------- */

const ui: Record<string, React.CSSProperties> = {
  page: { position: 'fixed', inset: 0, background: '#15120d', overflow: 'hidden' },
  host: { position: 'absolute', inset: 0 },
  form: { position: 'absolute', inset: 0, margin: 0 },
  // Real input, invisible, covering the scene: tap or click anywhere to type.
  input: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    opacity: 0,
    border: 0,
    padding: 0,
    fontSize: 16, // stops iOS zooming the page on focus
    background: 'transparent',
    color: 'transparent',
    caretColor: 'transparent',
    cursor: 'default',
  },
  bar: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
    font: '12px/1.2 ui-monospace, Consolas, monospace',
    color: '#d8c9a0',
    pointerEvents: 'none',
  },
  ctl: {
    pointerEvents: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 10px',
    background: 'rgba(30, 26, 18, 0.85)',
    border: '1px solid #5f5437',
    color: '#d8c9a0',
    font: 'inherit',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
};

export default function MonitorPrototype({ fontFamily }: { fontFamily: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const api = useRef<ReturnType<typeof createPrototype> | null>(null);
  const [side, setSide] = useState(false);
  const [bulge, setBulge] = useState(DEFAULT_BULGE);
  const [bow, setBow] = useState(DEFAULT_BOW);
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      api.current = createPrototype(hostRef.current!, inputRef.current!, formRef.current!, fontFamily);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'WebGL is not available');
      return;
    }
    if (matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
    return () => {
      api.current?.dispose();
      api.current = null;
    };
  }, [fontFamily]);

  const refocus = () => {
    if (matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  };

  return (
    <div style={ui.page}>
      <div ref={hostRef} style={ui.host} />
      <form ref={formRef} style={ui.form}>
        <input
          ref={inputRef}
          style={ui.input}
          aria-label="Your guess"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="send"
          maxLength={22}
        />
      </form>
      {error && <p style={{ position: 'absolute', inset: 'auto 0 40% 0', textAlign: 'center', color: '#ffb000' }}>{error}</p>}

      {/* Temporary prototype controls */}
      <div style={ui.bar}>
        <button
          type="button"
          style={{ ...ui.ctl, cursor: 'pointer' }}
          onClick={() => {
            api.current?.setSide(!side);
            setSide(!side);
            refocus();
          }}
        >
          {side ? '← Front view' : 'Side view →'}
        </button>
        <label style={ui.ctl}>
          Bulge {bulge.toFixed(2)}
          <input
            type="range"
            min={0}
            max={0.4}
            step={0.01}
            value={bulge}
            onChange={(e) => {
              const v = Number(e.target.value);
              setBulge(v);
              api.current?.setBulge(v);
            }}
            onPointerUp={refocus}
          />
        </label>
        <label style={ui.ctl}>
          Edge bow {bow.toFixed(3)}
          <input
            type="range"
            min={0}
            max={0.1}
            step={0.005}
            value={bow}
            onChange={(e) => {
              const v = Number(e.target.value);
              setBow(v);
              api.current?.setBow(v);
            }}
            onPointerUp={refocus}
          />
        </label>
      </div>
    </div>
  );
}
