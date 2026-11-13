/**
 * The 3D computer the game is played on.
 *
 * A beige CRT built in code from separate meshes (casing, inner bezel, convex
 * glass). Whatever is painted on `ctx` (an ordinary 2D canvas) appears on the
 * curved glass. Nothing is rendered unless something changed, so an idle game
 * costs no GPU time.
 */

import * as THREE from 'three';

/** How far the centre of the glass rises above its edges (world units). */
const BULGE = 0.2;
/** How much each side of the glass outline bows outward (fraction of its size). */
const BOW = 0.045;
/** Glass edges sit this far behind the front of the inner bezel rim (z = 0). */
const EDGE_Z = -0.1;
/** The bezel lip covers this much of the glass edge. */
const LIP = 0.965;

function roundedRect(w: number, h: number, r: number, cx = 0, cy = 0, seg = 12): THREE.Vector2[] {
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

function framed(outer: THREE.Vector2[], hole: THREE.Vector2[] | null, depth: number, bevel: number) {
  const shape = new THREE.Shape(outer);
  if (hole) shape.holes.push(new THREE.Path(hole));
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
  const uv = new Float32Array(n * 2 * 2);
  for (let i = 0; i < n; i++) {
    pos.set([a[i].x, a[i].y, za], i * 3);
    pos.set([b[i].x, b[i].y, zb], (n + i) * 3);
    uv.set([a[i].x, a[i].y], i * 2);
    uv.set([b[i].x, b[i].y], (n + i) * 2);
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i, j, n + i, j, n + j, n + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Fine speckle used as the bump and roughness of the moulded plastic. */
function plasticGrain() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  // Coarse blotches (8px cells, smoothed) plus per-texel grain.
  const cells = size / 8;
  const coarse = Array.from({ length: cells * cells }, () => Math.random());
  const at = (x: number, y: number) => coarse[((y + cells) % cells) * cells + ((x + cells) % cells)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x / 8;
      const fy = y / 8;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const blot =
        at(x0, y0) * (1 - tx) * (1 - ty) + at(x0 + 1, y0) * tx * (1 - ty) + at(x0, y0 + 1) * (1 - tx) * ty + at(x0 + 1, y0 + 1) * tx * ty;
      const v = Math.round(150 + blot * 45 + Math.random() * 60);
      const o = (y * size + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.9, 0.9);
  return tex;
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
    float open = smoothstep(0.0, 0.07, e);
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

export type Monitor = ReturnType<typeof createMonitor>;

/**
 * @param portrait  a tall monitor for narrow screens (the display is 3:4 instead of 4:3)
 * Throws if WebGL is not available — the caller falls back to the plain CSS computer.
 */
export function createMonitor(host: HTMLElement, { portrait, onLost }: { portrait: boolean; onLost: () => void }) {
  let disposed = false;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearAlpha(0);
  const el = renderer.domElement;
  el.style.display = 'block';
  el.addEventListener('webglcontextlost', onLost);
  host.appendChild(el);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);

  // A warm window light from the upper left, a weak cool fill from the right,
  // soft sky light, and the screen's own amber glow spilling onto the bezel.
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x3d3426, 0.8));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.1);
  key.position.set(-4, 6, 7);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbdd0ff, 0.4);
  fill.position.set(5, 1, 4);
  scene.add(fill);
  const glow = new THREE.PointLight(0xffa514, 1.1, 3.2, 1.6);
  glow.position.set(0, 0, 0.55);
  scene.add(glow);

  // --- sizes, all derived from the glass -----------------------------------
  const GW = portrait ? 2.7 : 3.6;
  const GH = portrait ? 3.6 : 2.7;
  const rim = portrait ? 0.15 : 0.25; // casing border beside and above the recess
  const chin = portrait ? 0.42 : 0.55;
  const holeW = GW + 0.65;
  const holeH = GH + 0.65;
  const caseW = holeW + rim * 2;
  const caseH = holeH + rim + chin;
  const cy = (rim - chin) / 2;
  const bottom = cy - caseH / 2;

  // --- casing ---------------------------------------------------------------
  const grain = plasticGrain();
  const plastic = { roughness: 1, roughnessMap: grain, bumpMap: grain, bumpScale: 1.4, metalness: 0 };
  const beige = new THREE.MeshStandardMaterial({ color: '#cbbd97', ...plastic });
  const beigeDark = new THREE.MeshStandardMaterial({ color: '#aea17d', ...plastic, side: THREE.DoubleSide });
  const beigePlain = new THREE.MeshStandardMaterial({ color: '#b5a882', roughness: 0.9 });
  const charcoal = new THREE.MeshStandardMaterial({ color: '#221f1a', roughness: 0.55 });

  const casing = new THREE.Group();
  const frontDepth = 0.8;
  const front = new THREE.Mesh(
    framed(roundedRect(caseW, caseH, 0.28, 0, cy), roundedRect(holeW, holeH, 0.18), frontDepth, 0.035),
    beige,
  );
  front.position.z = 0.335 - frontDepth; // front face ends up at z ≈ 0.37
  casing.add(front);

  // Sloped recess that funnels down from the casing front to the inner bezel.
  casing.add(
    new THREE.Mesh(loft(roundedRect(GW + 0.77, GH + 0.77, 0.2), 0.35, roundedRect(GW + 0.28, GH + 0.28, 0.1), 0), beigeDark),
  );

  const rearA = new THREE.Mesh(framed(roundedRect(caseW - 0.35, caseH - 0.35, 0.3, 0, cy), null, 1.7, 0.06), beige);
  rearA.position.z = -0.4 - 1.7;
  casing.add(rearA);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 0.4, 28), beigePlain);
  neck.position.set(0, bottom - 0.16, -1.0);
  casing.add(neck);
  const baseR = Math.min(1.6, caseW * 0.36);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(baseR, baseR + 0.1, 0.14, 40), beigePlain);
  base.scale.z = 0.85;
  base.position.set(0, bottom - 0.42, -1.0);
  casing.add(base);

  // Badge and power light on the chin.
  const badgeCanvas = document.createElement('canvas');
  badgeCanvas.width = 256;
  badgeCanvas.height = 64;
  const badgeTex = new THREE.CanvasTexture(badgeCanvas);
  badgeTex.colorSpace = THREE.SRGBColorSpace;
  const chinY = -holeH / 2 - chin / 2;
  const badge = new THREE.Mesh(
    new THREE.PlaneGeometry(0.88, 0.22),
    new THREE.MeshBasicMaterial({ map: badgeTex, transparent: true }),
  );
  badge.position.set(-caseW / 2 + 0.76, chinY, 0.375);
  casing.add(badge);
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.045, 16), new THREE.MeshBasicMaterial({ color: '#ffb000' }));
  led.position.set(caseW / 2 - 0.42, chinY, 0.375);
  casing.add(led);
  scene.add(casing);

  // --- glass + inner bezel ---------------------------------------------------
  const glassPoint = (u: number, v: number, bulge: number, out: THREE.Vector3) => {
    const a = 1 - u * u;
    const b = 1 - v * v;
    return out.set(
      (GW / 2) * u * (1 + BOW * b),
      (GH / 2) * v * (1 + BOW * a),
      EDGE_Z + bulge * (0.75 * a * b + 0.125 * (a + b)),
    );
  };
  const tmp = new THREE.Vector3();

  // The outline of the glass: every side bows outward.
  const outline: THREE.Vector2[] = [];
  const perEdge = 24;
  const edge = (u: number, v: number) => {
    glassPoint(u, v, 0, tmp);
    outline.push(new THREE.Vector2(tmp.x * LIP, tmp.y * LIP));
  };
  for (let i = 0; i < perEdge; i++) edge(-1 + (2 * i) / perEdge, -1);
  for (let i = 0; i < perEdge; i++) edge(1, -1 + (2 * i) / perEdge);
  for (let i = 0; i < perEdge; i++) edge(1 - (2 * i) / perEdge, 1);
  for (let i = 0; i < perEdge; i++) edge(-1, 1 - (2 * i) / perEdge);

  const bezel = new THREE.Mesh(framed(roundedRect(GW + 0.3, GH + 0.3, 0.1), outline, -EDGE_Z, 0), charcoal);
  bezel.position.z = EDGE_Z; // extruded forward so its rim ends at z = 0
  scene.add(bezel);

  const canvas = document.createElement('canvas');
  canvas.width = portrait ? 768 : 1024;
  canvas.height = portrait ? 1024 : 768;
  const ctx = canvas.getContext('2d')!;
  const screenTex = new THREE.CanvasTexture(canvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  screenTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const glassGeo = new THREE.PlaneGeometry(2, 2, 40, 40);
  const pos = glassGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    glassPoint(pos.getX(i), pos.getY(i), portrait ? BULGE * 0.85 : BULGE, tmp);
    pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
  }
  glassGeo.computeVertexNormals();
  glassGeo.computeBoundingSphere();
  const glass = new THREE.Mesh(
    glassGeo,
    new THREE.ShaderMaterial({ uniforms: { map: { value: screenTex } }, vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG }),
  );
  scene.add(glass);

  // --- camera: straight on, fitted to the casing ------------------------------
  function placeCamera() {
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fitH = caseH + (portrait ? 0.3 : 0.34);
    const fitW = caseW + 0.05;
    const dist = Math.max(fitH / 2 / half, fitW / 2 / (half * camera.aspect)) + (portrait ? 0.4 : 0.3);
    const ty = cy - (portrait ? 0.1 : 0.14);
    camera.position.set(0, ty, dist);
    camera.lookAt(0, ty, 0);
  }

  let raf = 0;
  function invalidate() {
    if (!raf && !disposed) raf = requestAnimationFrame(frame);
  }
  function frame() {
    raf = 0;
    renderer.render(scene, camera);
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
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  return {
    canvas,
    ctx,
    /** Call after painting on `ctx`. */
    commit() {
      screenTex.needsUpdate = true;
      invalidate();
    },
    /** Page coordinates → the point on the display canvas under them (or null if off the glass). */
    pick(clientX: number, clientY: number): { x: number; y: number } | null {
      const r = el.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(glass, false)[0];
      if (!hit?.uv) return null;
      return { x: hit.uv.x * canvas.width, y: (1 - hit.uv.y) * canvas.height };
    },
    /** Draws the name badge once the display font has loaded. */
    setBadge(font: string) {
      const b = badgeCanvas.getContext('2d')!;
      b.clearRect(0, 0, 256, 64);
      b.font = `60px ${font}`;
      b.fillStyle = '#5b5238';
      b.textBaseline = 'middle';
      b.fillText('Pixle', 4, 34);
      badgeTex.needsUpdate = true;
      invalidate();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('webglcontextlost', onLost);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      grain.dispose();
      screenTex.dispose();
      badgeTex.dispose();
      renderer.dispose();
      el.remove();
    },
  };
}
