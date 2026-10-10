// <ox-fox> — original sculpted fox head mascot (three.js). Head + eyes track the pointer, ears twitch,
// idle look-around + blink, rise-in entrance, ear flick + head tilt on click / window 'ox-mascot-react',
// scroll turn, reduced-motion static pose, WebGL fallback.
(function () {
  if (customElements.get('ox-fox')) return;
  const THREE_URL = 'https://unpkg.com/three@0.160.0/build/three.module.js';
  const C = { orange: 0xF07824, orangeDeep: 0xD25E14, white: 0xFFFFFF, cream: 0xFFF4EA, blue: 0x2864DC, blueDeep: 0x1C4BB4, ink: 0x172033, iris: 0xF5A548 };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const damp = (c, t, l, dt) => c + (t - c) * (1 - Math.exp(-l * dt));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Sculpted head surface from unit-sphere direction.
  function deform(x, y, z) {
    let X = x * 0.88, Y = y * 0.8, Z = z * 0.82;
    // tapered snout
    const sn = Math.exp(-Math.pow((y + 0.22) / 0.3, 2)) * Math.exp(-Math.pow(x / 0.42, 2)) * Math.pow(clamp(z, 0, 1), 2.2);
    Z += sn * 0.95; Y -= sn * 0.06;
    if (z > 0) X *= 1 - 0.32 * smooth(0.3, 1, z) * smooth(-0.6, 0.1, -Math.abs(y + 0.2) + 0.1);
    // cheek flare
    const ck = Math.exp(-Math.pow((y + 0.3) / 0.25, 2)) * smooth(0.45, 0.95, Math.abs(x)) * smooth(-0.6, 0.3, z);
    X += Math.sign(x) * ck * 0.16; Y -= ck * 0.05;
    // brow ridge + flat forehead
    const br = Math.exp(-Math.pow((y - 0.32) / 0.14, 2)) * smooth(0.2, 0.7, z) * Math.exp(-Math.pow((Math.abs(x) - 0.36) / 0.25, 2));
    Z += br * 0.05; Y += br * 0.03;
    if (y > 0.5) Y -= (y - 0.5) * 0.22;
    if (z < 0) Z *= 0.88;
    return [X, Y, Z];
  }
  function furColor(x, y, z) {
    // white muzzle + cheeks, orange crown, deeper orange at top/back
    const muzzle = smooth(0.0, -0.18, y) * smooth(-0.05, 0.35, z);
    const cheek = smooth(-0.02, -0.25, y) * smooth(0.55, 0.85, Math.abs(x));
    const m = clamp(Math.max(muzzle, cheek * 0.95), 0, 1);
    const top = smooth(0.35, 0.95, y) * 0.55 + smooth(0.1, -0.7, z) * 0.35;
    return { m, top };
  }

  class OxFox extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;
      Object.assign(this.style, { display: 'block', position: 'relative', width: '100%', height: '100%' });
      this._loader = document.createElement('div');
      Object.assign(this._loader.style, { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', font: '500 12px ui-monospace, Menlo, monospace', color: '#475467', letterSpacing: '.04em' });
      this._loader.textContent = 'Loading fox…';
      this.appendChild(this._loader);
      this._boot().catch((e) => this._fallback(e));
    }
    disconnectedCallback() {
      this._dead = true;
      cancelAnimationFrame(this._raf);
      this._cleanup && this._cleanup();
      this._renderer && this._renderer.dispose();
    }
    get facingYaw() {
      const f = this.facing || this.getAttribute('facing') || 'left';
      return f === 'center' ? 0 : f === 'right' ? 0.38 : -0.38;
    }
    _fallback(e) {
      console.warn('ox-fox fallback', e);
      this._loader.innerHTML = '';
      const d = document.createElement('div');
      Object.assign(d.style, { width: '62%', aspectRatio: '1', borderRadius: '50%', background: '#FDEBDD', display: 'grid', placeItems: 'center', textAlign: 'center', padding: '24px', boxSizing: 'border-box', color: '#475467', font: '500 12px ui-monospace, Menlo, monospace' });
      d.textContent = 'Interactive fox needs WebGL — static fallback';
      this._loader.appendChild(d);
    }
    async _boot() {
      const test = document.createElement('canvas');
      if (!(test.getContext('webgl2') || test.getContext('webgl'))) throw new Error('no webgl');
      const T = await import(THREE_URL);
      if (this._dead) return;
      this.T = T;
      const r = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.outputColorSpace = T.SRGBColorSpace;
      r.toneMapping = T.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.0;
      r.shadowMap.enabled = true;
      r.shadowMap.type = T.PCFSoftShadowMap;
      const cv = r.domElement;
      Object.assign(cv.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', opacity: '0', transition: 'opacity .7s ease', touchAction: 'pan-y', cursor: 'pointer' });
      this.appendChild(cv);
      this._renderer = r;
      this.scene = new T.Scene();
      this.camera = new T.PerspectiveCamera(28, 1, 0.1, 100);
      this._lights();
      this._build();
      this._resize();
      this._wire();
      this._loader.remove();
      setTimeout(() => (cv.style.opacity = '1'), 30);
      this.t = 0;
      this.entrance = reduced() ? 1 : 0;
      this._last = performance.now();
      if (reduced()) {
        this._renderStatic();
        const retry = (n) => { if (this._dead || n > 40) return; if (this._resize()) this._renderStatic(); if (!this._sz) setTimeout(() => retry(n + 1), 100); };
        setTimeout(() => retry(0), 50);
      } else this._loop();
    }
    _lights() {
      const T = this.T, s = this.scene;
      s.add(new T.HemisphereLight(0xffffff, 0xf1d2bb, 0.95));
      const key = new T.DirectionalLight(0xfff6ee, 2.5);
      key.position.set(-2.5, 4.5, 5);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      Object.assign(key.shadow.camera, { left: -2.8, right: 2.8, top: 2.8, bottom: -2.8, near: 0.5, far: 15 });
      key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
      s.add(key);
      const rim = new T.DirectionalLight(0xa9c2f5, 1.9); rim.position.set(4, 2.5, -4); s.add(rim);
      const rim2 = new T.DirectionalLight(0xffc49a, 0.8); rim2.position.set(-4, 0, -3); s.add(rim2);
      const fill = new T.DirectionalLight(0xffffff, 0.45); fill.position.set(3, -1, 4); s.add(fill);
    }
    _surf(dx, dy, dz) {
      const T = this.T;
      const d = new T.Vector3(dx, dy, dz).normalize();
      const p = new T.Vector3(...deform(d.x, d.y, d.z));
      const u = new T.Vector3().crossVectors(d, Math.abs(d.y) < 0.95 ? new T.Vector3(0, 1, 0) : new T.Vector3(1, 0, 0)).normalize();
      const v = new T.Vector3().crossVectors(d, u).normalize();
      const e = 0.01;
      const d1 = d.clone().addScaledVector(u, e).normalize(), d2 = d.clone().addScaledVector(v, e).normalize();
      const p1 = new T.Vector3(...deform(d1.x, d1.y, d1.z)).sub(p), p2 = new T.Vector3(...deform(d2.x, d2.y, d2.z)).sub(p);
      const n = new T.Vector3().crossVectors(p1, p2).normalize();
      if (n.dot(p) < 0) n.negate();
      return { p, n, d };
    }
    _build() {
      const T = this.T;
      const std = (color, o = {}) => new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0 }, o));
      const phys = (color, o = {}) => new T.MeshPhysicalMaterial(Object.assign({ color, roughness: 0.4, metalness: 0 }, o));
      const M = {
        fur: phys(0xffffff, { vertexColors: true, roughness: 0.78, sheen: 1, sheenColor: new T.Color(0xffd9b8), sheenRoughness: 0.5 }),
        orange: phys(C.orange, { roughness: 0.75, sheen: 1, sheenColor: new T.Color(0xffd9b8), sheenRoughness: 0.5 }),
        innerEar: phys(C.cream, { roughness: 0.85 }),
        tuft: std(0xffffff, { roughness: 0.7 }),
        nose: phys(C.ink, { roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.15 }),
        iris: phys(C.iris, { roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }),
        ink: phys(C.ink, { roughness: 0.1, clearcoat: 1 }),
        shine: new T.MeshBasicMaterial({ color: 0xffffff }),
        collar: phys(C.blue, { roughness: 0.35, clearcoat: 0.6 }),
        tag: phys(C.orange, { roughness: 0.25, metalness: 0.2, clearcoat: 1 }),
      };
      const sh = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
      const cOr = new T.Color(C.orange), cDeep = new T.Color(C.orangeDeep), cW = new T.Color(C.white);

      const root = new T.Group(); this.scene.add(root); this.root = root;
      const bust = new T.Group(); root.add(bust); this.bust = bust;

      // neck + collar
      const prof = [[0.6, -0.3], [0.68, -0.62], [0.82, -0.9], [1.05, -1.18], [1.3, -1.45], [1.4, -1.7]].map(([r, y]) => new T.Vector2(r, y));
      const neckG = new T.LatheGeometry(prof, 56);
      { const p = neckG.attributes.position, col = []; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const front = smooth(-0.1, 0.7, z / Math.hypot(x, z)); const c = cOr.clone().lerp(cW, front * 0.95); col.push(c.r, c.g, c.b); } neckG.setAttribute('color', new T.Float32BufferAttribute(col, 3)); }
      bust.add(sh(new T.Mesh(neckG, M.fur)));
      const collar = sh(new T.Mesh(new T.TorusGeometry(0.78, 0.075, 18, 72), M.collar)); collar.rotation.x = Math.PI / 2 + 0.14; collar.position.set(0, -0.8, 0.04); bust.add(collar);
      const tag = sh(new T.Mesh(new T.CylinderGeometry(0.13, 0.13, 0.035, 36), M.tag)); tag.rotation.x = Math.PI / 2; tag.position.set(0, -1.02, 0.86); bust.add(tag); this.tag = tag;
      const ringT = sh(new T.Mesh(new T.TorusGeometry(0.045, 0.014, 8, 20), M.collar)); ringT.position.set(0, -0.88, 0.84); bust.add(ringT);

      // head
      const headPivot = new T.Group(); headPivot.position.set(0, -0.4, -0.1); bust.add(headPivot); this.headPivot = headPivot;
      const head = new T.Group(); head.position.set(0, 0.48, 0.1); headPivot.add(head); this.head = head;
      const hg = new T.SphereGeometry(1, 140, 100);
      const hp = hg.attributes.position, hcol = [];
      for (let i = 0; i < hp.count; i++) {
        const x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i);
        const { m, top } = furColor(x, y, z);
        const c = cOr.clone().lerp(cDeep, top).lerp(cW, m);
        hcol.push(c.r, c.g, c.b);
        const [X, Y, Z] = deform(x, y, z); hp.setXYZ(i, X, Y, Z);
      }
      hg.setAttribute('color', new T.Float32BufferAttribute(hcol, 3));
      hg.computeVertexNormals();
      head.add(sh(new T.Mesh(hg, M.fur)));

      // nose + mouth
      const tip = this._surf(0, -0.24, 1);
      const nose = sh(new T.Mesh(new T.SphereGeometry(1, 40, 28), M.nose));
      nose.scale.set(0.15, 0.1, 0.11); nose.position.copy(tip.p).addScaledVector(tip.n, -0.02).add(new T.Vector3(0, 0.03, 0)); head.add(nose);
      const nhl = new T.Mesh(new T.SphereGeometry(0.03, 10, 8), M.shine); nhl.scale.set(1.4, 0.6, 0.6); nhl.position.copy(nose.position).add(new T.Vector3(-0.04, 0.06, 0.07)); head.add(nhl);
      const mouthPts = [[-0.17, -0.06], [-0.08, -0.02], [0, -0.07], [0.08, -0.02], [0.17, -0.06]].map(([x, dy]) => { const s = this._surf(x, -0.36 + dy, 0.95); return s.p.addScaledVector(s.n, 0.006); });
      const mouth = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(mouthPts), 40, 0.012, 8, false), M.ink); head.add(mouth);
      const philtrum = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([nose.position.clone().add(new T.Vector3(0, -0.08, -0.02)), mouthPts[2]]), 10, 0.011, 6, false), M.ink); head.add(philtrum);

      // eyes
      this.eyes = [];
      [-1, 1].forEach((s) => {
        const { p, n } = this._surf(s * 0.42, 0.16, 0.84);
        const eye = new T.Group(); eye.position.copy(p).addScaledVector(n, -0.035);
        head.add(eye); eye.lookAt(eye.position.clone().add(n).add(new T.Vector3(-s * 0.35, 0, 0.5)));
        eye.rotation.z += s * 0.18;
        const ball = new T.Group(); eye.add(ball);
        const irisM = new T.Mesh(new T.SphereGeometry(0.135, 32, 24), M.iris); irisM.scale.set(1.12, 0.92, 1); ball.add(irisM);
        const pupil = new T.Mesh(new T.SphereGeometry(0.07, 24, 16), M.ink); pupil.scale.set(0.42, 1.05, 0.45); pupil.position.z = 0.112; ball.add(pupil);
        const hl = new T.Mesh(new T.SphereGeometry(0.024, 10, 8), M.shine); hl.position.set(0.045, 0.05, 0.128); ball.add(hl);
        const rim = new T.Mesh(new T.TorusGeometry(0.142, 0.017, 10, 44), M.ink); rim.scale.set(1.12, 0.92, 1); rim.position.z = 0.018; eye.add(rim);
        const lidG = new T.Group(); eye.add(lidG);
        const lid = sh(new T.Mesh(new T.SphereGeometry(0.158, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.orange)); lid.scale.set(1.12, 1, 1); lidG.add(lid);
        this.eyes.push({ ball, lid, s });
      });

      // ears
      this.ears = [];
      const earGeo = (h, r, inner) => {
        const g = new T.ConeGeometry(r, h, 48, 24, true);
        g.translate(0, h / 2, 0);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
          const t = y / h;
          z *= inner ? 0.35 : 0.5; if (z > 0 && !inner) z *= 0.35; // cupped front
          z -= Math.pow(t, 2) * 0.18 * h; // tips curl back
          x *= 1 + 0.12 * Math.sin(t * Math.PI);
          p.setXYZ(i, x, y, z);
        }
        g.computeVertexNormals();
        return g;
      };
      const earOuterG = earGeo(0.92, 0.44, false);
      { const p = earOuterG.attributes.position, col = []; const cB = new T.Color(C.blueDeep); for (let i = 0; i < p.count; i++) { const t = p.getY(i) / 0.92; const c = cOr.clone().lerp(cDeep, smooth(0.3, 0.7, t)).lerp(cB, smooth(0.74, 0.86, t)); col.push(c.r, c.g, c.b); } earOuterG.setAttribute('color', new T.Float32BufferAttribute(col, 3)); }
      const earMat = phys(0xffffff, { vertexColors: true, roughness: 0.75, side: T.DoubleSide, sheen: 1, sheenColor: new T.Color(0xffd9b8) });
      [-1, 1].forEach((s) => {
        const { p } = this._surf(s * 0.5, 0.78, -0.1);
        const base = new T.Group(); base.position.copy(p).add(new T.Vector3(-s * 0.04, -0.26, 0.02)); head.add(base);
        base.rotation.set(-0.18, s * 0.22, -s * 0.36);
        const pivot = new T.Group(); base.add(pivot);
        const outer = sh(new T.Mesh(earOuterG, earMat)); pivot.add(outer);
        const inner = sh(new T.Mesh(earGeo(0.66, 0.28, true), M.innerEar)); inner.position.set(0, 0.08, 0.04); pivot.add(inner);
        this.ears.push({ pivot, s, twitch: 0, phase: Math.random() * 10 });
      });

      // fur tufts (instanced): cheek ruffs, ear fluff, neck mane
      const fg = new T.SphereGeometry(1, 12, 8);
      const fp = fg.attributes.position;
      for (let i = 0; i < fp.count; i++) { const x = fp.getX(i), y = fp.getY(i), z = fp.getZ(i); const t = (z + 1) / 2; fp.setXYZ(i, x * (1 - 0.85 * t * t) * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, t + 0.25))), y * 0.22 - 0.1 * t * t, t); }
      fg.computeVertexNormals();
      const items = [];
      const N = 2600, ga = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < N; i++) {
        const y = 1 - (i / (N - 1)) * 2, rr = Math.sqrt(1 - y * y), th = ga * i;
        const x = Math.cos(th) * rr, z = Math.sin(th) * rr;
        // cheek ruffs only
        const ruff = Math.abs(x) > 0.6 && y < 0.05 && y > -0.75 && z < 0.55;
        const back = z < -0.35 && y < 0.35 && y > -0.85;
        if (!ruff && !back) continue;
        if (Math.random() < 0.35) continue;
        const { p, n } = this._surf(x, y, z);
        const out = new T.Vector3(Math.sign(x) * 0.9, -0.55, -0.35).normalize();
        const f = out.addScaledVector(n, -out.dot(n)).normalize();
        const { m, top } = furColor(x, y, z);
        const c = cOr.clone().lerp(cDeep, top).lerp(cW, ruff ? Math.max(m, 0.85) : m).offsetHSL(0, 0, (Math.random() - 0.5) * 0.03);
        items.push({ p: p.addScaledVector(n, -0.015), n, f, w: (ruff ? 0.09 : 0.08) + Math.random() * 0.025, len: (ruff ? 0.3 : 0.2) + Math.random() * 0.08, lift: (ruff ? 0.26 : 0.14) + Math.random() * 0.1, color: c });
      }
      const mk = (list, parent) => {
        const im = new T.InstancedMesh(fg, M.tuft, list.length);
        im.castShadow = true; im.receiveShadow = true;
        list.forEach((it, i) => {
          const z = it.f, y = it.n, x = new T.Vector3().crossVectors(y, z).normalize();
          const yy = new T.Vector3().crossVectors(z, x).normalize();
          it.basis = new T.Matrix4().makeBasis(x, yy, z);
          it.phase = Math.random() * Math.PI * 2;
          im.setColorAt(i, it.color);
        });
        parent.add(im);
        return { im, list };
      };
      // neck mane rows
      const mane = [];
      const radAt = (yy) => { for (let j = 0; j < prof.length - 1; j++) { const a = prof[j], b = prof[j + 1]; if (yy <= a.y && yy >= b.y) return lerp(a.x, b.x, (a.y - yy) / (a.y - b.y)); } return prof[prof.length - 1].x; };
      const rows = 9;
      for (let r = 0; r < rows; r++) {
        const k = r / (rows - 1);
        const y = lerp(-0.3, -0.56, k);
        const R = radAt(y) + 0.01, dr = (radAt(y - 0.05) - radAt(y + 0.05)) / 0.1;
        const count = Math.round(lerp(36, 44, k));
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + (r % 2) * (Math.PI / count);
          const sa = Math.sin(a), ca = Math.cos(a);
          const p = new T.Vector3(R * sa, y, R * ca);
          const n = new T.Vector3(sa, dr, ca).normalize();
          const f = new T.Vector3(sa * dr, -1, ca * dr).normalize();
          const front = smooth(-0.1, 0.7, ca);
          const c = cOr.clone().lerp(cW, front * 0.95).offsetHSL(0, 0, (Math.random() - 0.5) * 0.03);
          mane.push({ p, n, f, w: lerp(0.1, 0.14, k) + Math.random() * 0.02, len: lerp(0.22, 0.2, k), lift: lerp(0.18, 0.12, k) + Math.random() * 0.06, color: c });
        }
      }
      this.furSets = [mk(items, head), mk(mane, bust)];
      this._m = { rx: new T.Matrix4(), s: new T.Matrix4(), t: new T.Matrix4(), out: new T.Matrix4() };
      this.state = { yaw: 0.9, pitch: 0, tilt: 0, bodyYaw: 0, scroll: 0, rootYaw: this.facingYaw, ruffle: 0, cock: 0, gx: 0, gy: 0, nextBlink: 2.2, blink: -1, lastRuffle: -1, nextTwitch: 3 };
      this._fur(true);
      this._pose(0);
    }
    _fur(force) {
      const S = this.state, m = this._m, t = this.t || 0;
      if (!force && Math.abs(S.ruffle - S.lastRuffle) < 0.002 && S.ruffle < 0.002) return;
      S.lastRuffle = S.ruffle;
      this.furSets.forEach(({ im, list }) => {
        list.forEach((it, i) => {
          const lift = it.lift + S.ruffle * (0.3 + 0.15 * Math.sin(t * 22 + it.phase));
          m.t.makeTranslation(it.p.x, it.p.y, it.p.z);
          m.rx.makeRotationX(-lift);
          m.s.makeScale(it.w, it.w, it.len);
          m.out.copy(m.t).multiply(it.basis).multiply(m.rx).multiply(m.s);
          im.setMatrixAt(i, m.out);
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      });
    }
    _wire() {
      this.pointer = { x: 0, y: 0, active: false, lastMove: -10 };
      const onMove = (e) => {
        const r = this.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height * 0.4;
        this.pointer.x = clamp((e.clientX - cx) / (window.innerWidth * 0.5), -1.4, 1.4);
        this.pointer.y = clamp((e.clientY - cy) / (window.innerHeight * 0.5), -1.2, 1.4);
        this.pointer.active = true; this.pointer.lastMove = this.t;
      };
      const onLeave = (e) => { if (!e.relatedTarget) this.pointer.active = false; };
      const onReact = () => this.react();
      const onVis = () => { if (!document.hidden) this._last = performance.now(); };
      window.addEventListener('pointermove', onMove, { passive: true });
      document.addEventListener('pointerout', onLeave);
      window.addEventListener('ox-mascot-react', onReact);
      window.addEventListener('ox-eagle-flap', onReact);
      this._renderer.domElement.addEventListener('pointerdown', onReact);
      document.addEventListener('visibilitychange', onVis);
      const ro = new ResizeObserver(([en]) => { const r = en && en.contentRect; if (this._resize(r && r.width, r && r.height) && reduced()) this._renderStatic(); });
      ro.observe(this);
      this.visible = true;
      const io = new IntersectionObserver(([en]) => { this.visible = en.isIntersecting; if (this.visible) this._last = performance.now(); });
      io.observe(this);
      this._cleanup = () => { window.removeEventListener('pointermove', onMove); document.removeEventListener('pointerout', onLeave); window.removeEventListener('ox-mascot-react', onReact); window.removeEventListener('ox-eagle-flap', onReact); document.removeEventListener('visibilitychange', onVis); ro.disconnect(); io.disconnect(); };
    }
    react() { if (reduced() || !this.state) return; this.ruffleUntil = this.t + 0.6; this.cockUntil = this.t + 1.0; this.ears.forEach((e) => (e.twitch = 1)); }
    _resize(cw, ch) {
      const w = Math.round(cw || this.clientWidth), h = Math.round(ch || this.clientHeight);
      if (w < 4 || h < 4) return false;
      if (this._sz && this._sz[0] === w && this._sz[1] === h) return false;
      this._sz = [w, h];
      this._renderer.setSize(w, h, false);
      const a = w / h; this.camera.aspect = a;
      const dist = (a < 0.9 ? 7.6 * (0.9 / a) : 7.6) * 1.1;
      this.camera.position.set(0, 0.35, dist * 0.95); this.camera.lookAt(0, -0.25, 0.2);
      this.camera.updateProjectionMatrix();
      return true;
    }
    _pose(dt) {
      const S = this.state, t = this.t || 0, d = dt || 1, rm = reduced();
      const e = easeOut(clamp(this.entrance, 0, 1));
      this.root.position.y = lerp(-0.9, 0, e) - S.scroll * 0.2;
      const idle = !this.pointer || !this.pointer.active || t - this.pointer.lastMove > 3.2;
      let ty, tp, tt;
      if (rm) { ty = 0.1; tp = 0.04; tt = 0; }
      else if (idle) { ty = Math.sin(t * 0.42) * 0.4 + Math.sin(t * 0.17) * 0.12; tp = Math.sin(t * 0.31) * 0.08 + 0.05; tt = Math.sin(t * 0.7) * 0.06; }
      else { ty = this.pointer.x * 0.85; tp = this.pointer.y * 0.4; tt = -this.pointer.x * 0.08; }
      if (!idle) ty -= S.rootYaw * 0.7;
      tp += S.scroll * 0.35;
      ty = clamp(ty, -1, 1); tp = clamp(tp, -0.45, 0.5);
      if (this.entrance < 1) ty = lerp(0.9, ty, e);
      const cocking = this.cockUntil && t < this.cockUntil;
      S.cock = damp(S.cock, cocking ? 1 : 0, cocking ? 12 : 5, d);
      S.yaw = damp(S.yaw, ty, 5.5, d); S.pitch = damp(S.pitch, tp, 5.5, d); S.tilt = damp(S.tilt, tt + S.cock * 0.26, 4.5, d);
      S.bodyYaw = damp(S.bodyYaw, ty * 0.25, 2, d);
      S.rootYaw = damp(S.rootYaw, this.facingYaw, 3, d);
      this.headPivot.rotation.set(S.pitch * 0.85, S.yaw * 0.8, S.tilt);
      this.bust.rotation.set(S.pitch * 0.12, S.bodyYaw, 0);
      this.root.rotation.y = S.rootYaw + S.scroll * 0.7;
      const br = rm ? 0 : Math.sin(t * 1.7) * 0.012;
      this.bust.scale.set(1 + br * 0.6, 1 + br * 0.3, 1 + br * 0.6);
      this.tag.rotation.z = rm ? 0 : Math.sin(t * 2.1) * 0.15 + S.bodyYaw * -0.6;
      // ears: idle twitch + orient toward pointer side
      if (!rm && t > S.nextTwitch) { const ear = this.ears[Math.random() < 0.5 ? 0 : 1]; ear.twitch = 1; S.nextTwitch = t + 2.5 + Math.random() * 4; }
      this.ears.forEach((ear) => {
        ear.twitch = damp(ear.twitch, 0, 7, d);
        const k = ear.twitch;
        const toward = clamp(-S.yaw * ear.s, -0.4, 0.4);
        ear.pivot.rotation.set(-k * 0.35 + S.pitch * -0.15, ear.s * toward * 0.25, ear.s * k * 0.18 + (rm ? 0 : Math.sin(t * 1.3 + ear.phase) * 0.015));
      });
      // eyes
      S.gx = damp(S.gx, clamp((ty - S.yaw * 0.8) * 1.4, -0.3, 0.3), 14, d);
      S.gy = damp(S.gy, clamp((tp - S.pitch * 0.85) * 1.2, -0.2, 0.2), 14, d);
      let lidK = 0;
      if (!rm) {
        if (S.blink < 0 && t > S.nextBlink) S.blink = 0;
        if (S.blink >= 0) { S.blink += d; const b = S.blink / 0.18; lidK = b >= 1 ? 0 : Math.sin(b * Math.PI); if (b >= 1) { S.blink = -1; S.nextBlink = t + 2.4 + Math.random() * 3.4; } }
      }
      this.eyes.forEach(({ ball, lid }) => {
        ball.rotation.set(S.gy, S.gx, 0);
        lid.rotation.x = lerp(-0.25 + S.gy * 0.4, 1.65, lidK);
      });
      const ruff = this.ruffleUntil && t < this.ruffleUntil;
      S.ruffle = damp(S.ruffle, ruff ? 1 : 0, ruff ? 16 : 4, d);
      this._fur(false);
    }
    _scroll() {
      const host = this.closest('[data-eagle-scope],[data-mascot-scope]') || this;
      const hr = host.getBoundingClientRect();
      const p = clamp(-hr.top / Math.max(1, hr.height * 0.9), 0, 1);
      this.state.scroll = damp(this.state.scroll, p, 5, this._dt || 0.016);
    }
    _renderStatic() { if (!this.state || !this._sz) return; this.entrance = 1; this.state.yaw = 0.1; this._pose(1); this._renderer.render(this.scene, this.camera); }
    _loop() {
      const tick = (now) => {
        if (this._dead) return;
        this._raf = requestAnimationFrame(tick);
        if (!this.visible || document.hidden) return;
        this._resize();
        const dt = Math.min(0.05, (now - this._last) / 1000); this._last = now; this._dt = dt;
        this.t += dt;
        if (this.entrance < 1) this.entrance = Math.min(1, this.entrance + dt / 1.6);
        this._scroll();
        this._pose(dt);
        this._renderer.render(this.scene, this.camera);
      };
      this._raf = requestAnimationFrame(tick);
    }
  }
  customElements.define('ox-fox', OxFox);
})();
