// <ox-eagle> — detailed sculpted eagle head bust (three.js).
// Head + gaze track the pointer, idle look-around + blink, rise-in entrance, feather ruffle + head-cock
// on window 'ox-eagle-flap' (or click), scroll turn, reduced-motion static pose, WebGL fallback.
(function () {
  if (customElements.get('ox-eagle')) return;
  const THREE_URL = 'https://unpkg.com/three@0.160.0/build/three.module.js';
  const C = { orange: 0xF07824, orangeDeep: 0xC95A12, cere: 0xF59A4A, iris: 0xF7A64F, blue: 0x2864DC, blueDeep: 0x1C4BB4, white: 0xFFFFFF, ink: 0x172033 };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const damp = (c, t, l, dt) => c + (t - c) * (1 - Math.exp(-l * dt));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Head surface: a sculpted deformation of the unit sphere.
  function deform(x, y, z) {
    let X = x * 0.76, Y = y * 0.84, Z = z * 1.02;
    if (z > 0) Z *= 1 + 0.2 * z * (1 - Math.max(y, 0) * 0.8);
    if (y > 0.55) Y -= (y - 0.55) * 0.3;
    const front = clamp((z - 0.15) / 0.45, 0, 1);
    const len = Math.hypot(X, Y, Z);
    const brow = Math.exp(-Math.pow((y - 0.4) / 0.12, 2)) * front * Math.exp(-Math.pow((Math.abs(x) - 0.42) / 0.3, 2));
    X += (X / len) * 0.13 * brow; Y += (Y / len) * 0.13 * brow + 0.05 * brow; Z += (Z / len) * 0.15 * brow;
    const sock = Math.exp(-Math.pow((y - 0.18) / 0.11, 2)) * front * Math.exp(-Math.pow((Math.abs(x) - 0.56) / 0.17, 2));
    X -= (X / len) * 0.05 * sock; Z -= (Z / len) * 0.05 * sock;
    if (y < 0 && z > 0) X *= 1 - 0.18 * -y * z;
    if (z < 0) Z *= 0.8 + (y < -0.2 ? 0.1 * -z : 0);
    return [X, Y, Z];
  }

  class OxEagle extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;
      Object.assign(this.style, { display: 'block', position: 'relative', width: '100%', height: '100%' });
      this._loader = document.createElement('div');
      Object.assign(this._loader.style, { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', font: '500 12px ui-monospace, Menlo, monospace', color: '#475467', letterSpacing: '.04em' });
      this._loader.textContent = 'Loading eagle…';
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
      console.warn('ox-eagle fallback', e);
      this._loader.innerHTML = '';
      const d = document.createElement('div');
      Object.assign(d.style, { width: '62%', aspectRatio: '1', borderRadius: '50%', background: '#FDEBDD', display: 'grid', placeItems: 'center', textAlign: 'center', padding: '24px', boxSizing: 'border-box', color: '#475467', font: '500 12px ui-monospace, Menlo, monospace' });
      d.textContent = 'Interactive eagle needs WebGL — static fallback';
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
      if (reduced()) { this._renderStatic(); const retry = (n) => { if (this._dead || n > 40) return; if (this._resize()) this._renderStatic(); if (!this._sz) setTimeout(() => retry(n + 1), 100); }; setTimeout(() => retry(0), 50); }
      else this._loop();
    }
    _lights() {
      const T = this.T, s = this.scene;
      s.add(new T.HemisphereLight(0xffffff, 0xf1d2bb, 0.9));
      const key = new T.DirectionalLight(0xfff6ee, 2.6);
      key.position.set(-2.5, 4.5, 5);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      Object.assign(key.shadow.camera, { left: -2.6, right: 2.6, top: 2.6, bottom: -2.6, near: 0.5, far: 15 });
      key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
      s.add(key);
      const rim = new T.DirectionalLight(0xa9c2f5, 1.8); rim.position.set(4, 2.5, -4); s.add(rim);
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
      return { p, n };
    }
    _build() {
      const T = this.T;
      const std = (color, o = {}) => new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0 }, o));
      const phys = (color, o = {}) => new T.MeshPhysicalMaterial(Object.assign({ color, roughness: 0.4, metalness: 0 }, o));
      const M = {
        head: phys(C.white, { roughness: 0.72, sheen: 1, sheenColor: new T.Color(0xdfe7f7), sheenRoughness: 0.45 }),
        feather: std(0xffffff, { roughness: 0.62 }),
        beak: phys(C.orange, { roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.25 }),
        beakLow: phys(C.orangeDeep, { roughness: 0.38, clearcoat: 0.4 }),
        cere: phys(C.cere, { roughness: 0.5 }),
        iris: phys(C.iris, { roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }),
        ink: phys(C.ink, { roughness: 0.1, clearcoat: 1 }),
        shine: new T.MeshBasicMaterial({ color: 0xffffff }),
        ring: phys(C.orangeDeep, { roughness: 0.45 }),
      };
      const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

      const root = new T.Group(); this.scene.add(root); this.root = root;
      const bust = new T.Group(); root.add(bust); this.bust = bust;

      // neck (lathe), mostly hidden under feathers
      const prof = [[0.6, -0.4], [0.66, -0.8], [0.75, -1.1], [0.88, -1.4], [1.02, -1.7], [1.08, -1.9]].map(([r, y]) => new T.Vector2(r, y));
      bust.add(shadowy(new T.Mesh(new T.LatheGeometry(prof, 48), M.head)));

      // head
      const headPivot = new T.Group(); headPivot.position.set(0, -0.45, -0.12); bust.add(headPivot); this.headPivot = headPivot;
      const head = new T.Group(); head.position.set(0, 0.45, 0.12); headPivot.add(head); this.head = head;
      const hg = new T.SphereGeometry(1, 120, 90);
      const hp = hg.attributes.position;
      for (let i = 0; i < hp.count; i++) { const [X, Y, Z] = deform(hp.getX(i), hp.getY(i), hp.getZ(i)); hp.setXYZ(i, X, Y, Z); }
      hg.computeVertexNormals();
      head.add(shadowy(new T.Mesh(hg, M.head)));
      const chin = shadowy(new T.Mesh(new T.SphereGeometry(1, 48, 32), M.head)); chin.scale.set(0.56, 0.5, 0.55); chin.position.set(0, -0.62, 0.22); head.add(chin);

      // beak: lofted along a curved spine (hooked raptor profile)
      const loft = (pts, hFn, wFn, segs = 64, ring = 36) => {
        const curve = new T.CatmullRomCurve3(pts.map((p) => new T.Vector3(...p)));
        const pos = [], idx = [];
        const side = new T.Vector3(1, 0, 0);
        for (let i = 0; i <= segs; i++) {
          const u = i / segs, P = curve.getPointAt(u), tg = curve.getTangentAt(u);
          const up = new T.Vector3().crossVectors(tg, side).normalize();
          const h = hFn(u), w = wFn(u);
          for (let j = 0; j < ring; j++) {
            const a = (j / ring) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
            const xk = ca > 0 ? 1 - 0.38 * Math.pow(ca, 1.5) : 1 + 0.06 * ca;
            const q = P.clone().addScaledVector(side, (w / 2) * sa * xk).addScaledVector(up, (h / 2) * ca);
            pos.push(q.x, q.y, q.z);
          }
        }
        for (let i = 0; i < segs; i++) for (let j = 0; j < ring; j++) {
          const a = i * ring + j, b = i * ring + ((j + 1) % ring), c = a + ring, d = b + ring;
          idx.push(a, c, b, b, c, d);
        }
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
        return g;
      };
      const beak = new T.Group(); beak.position.set(0, 0.1, 0.74); beak.scale.setScalar(1.32); head.add(beak); this.beak = beak;
      const upper = shadowy(new T.Mesh(loft([[0, 0.06, 0], [0, 0.08, 0.3], [0, 0.0, 0.58], [0, -0.2, 0.78], [0, -0.44, 0.76]], (u) => lerp(0.66, 0.03, Math.pow(u, 0.8)), (u) => lerp(0.4, 0.03, Math.pow(u, 1.1))), M.beak));
      beak.add(upper);
      const lower = shadowy(new T.Mesh(loft([[0, -0.2, 0], [0, -0.23, 0.26], [0, -0.27, 0.44]], (u) => lerp(0.18, 0.03, u), (u) => lerp(0.32, 0.05, u)), M.beakLow));
      beak.add(lower);
      this.lowerBeak = lower;
      const cere = shadowy(new T.Mesh(new T.SphereGeometry(1, 32, 20), M.cere));
      cere.scale.set(0.3, 0.17, 0.3); cere.position.set(0, 0.28, 0.8); head.add(cere);
      [-1, 1].forEach((s) => { const n = new T.Mesh(new T.SphereGeometry(1, 12, 8), M.ink); n.scale.set(0.035, 0.022, 0.05); n.position.set(s * 0.14, 0.26, 1.0); n.rotation.y = s * 0.4; head.add(n); });

      // eyes with hooded lids
      this.eyes = [];
      [-1, 1].forEach((s) => {
        const { p, n } = this._surf(s * 0.62, 0.2, 0.76);
        const eye = new T.Group(); eye.position.copy(p).addScaledVector(n, -0.03);
        const look = eye.position.clone().add(n.clone().multiplyScalar(0.6)).add(new T.Vector3(-s * 0.22, 0, 0.35));
        head.add(eye); eye.lookAt(look);
        const ball = new T.Group(); eye.add(ball);
        ball.add(new T.Mesh(new T.SphereGeometry(0.145, 32, 24), M.iris));
        const pupil = new T.Mesh(new T.SphereGeometry(0.068, 24, 16), M.ink); pupil.scale.z = 0.45; pupil.position.z = 0.122; ball.add(pupil);
        const hl = new T.Mesh(new T.SphereGeometry(0.022, 10, 8), M.shine); hl.position.set(0.04, 0.05, 0.138); ball.add(hl);
        const ring = new T.Mesh(new T.TorusGeometry(0.146, 0.022, 10, 40), M.ring); ring.position.z = 0.02; eye.add(ring);
        const lid = shadowy(new T.Mesh(new T.SphereGeometry(0.162, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.head));
        const lidW = new T.Group(); lidW.rotation.z = s * 0.4; eye.add(lidW); lidW.add(lid);
        this.eyes.push({ ball, lid, s });
      });

      // instanced feathers
      const fg = new T.SphereGeometry(1, 14, 8);
      const fp = fg.attributes.position;
      for (let i = 0; i < fp.count; i++) {
        const x = fp.getX(i), y = fp.getY(i), z = fp.getZ(i);
        const t = (z + 1) / 2;
        fp.setXYZ(i, x * (1 - 0.6 * t * t) * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, t + 0.25))), y * 0.22 - 0.12 * t * t, t);
      }
      fg.computeVertexNormals();
      const items = [];
      const col = new T.Color();
      const flowHead = new T.Vector3(0, -0.45, -1).normalize();
      const N = 2200, ga = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < N; i++) {
        const y = 1 - (i / (N - 1)) * 2, rr = Math.sqrt(1 - y * y), th = ga * i;
        const x = Math.cos(th) * rr, z = Math.sin(th) * rr;
        if (y < -0.92) continue;
        const dEye = Math.min(Math.hypot(x - 0.62, y - 0.2, z - 0.76), Math.hypot(x + 0.62, y - 0.2, z - 0.76));
        if (dEye < 0.3) continue;
        if (z > 0.72 && Math.abs(x) < 0.34 && y < 0.32 && y > -0.5) continue;
        const face = z > 0.3 && y < 0.62;
        const { p, n } = this._surf(x, y, z);
        const nape = y < -0.15 && z < -0.25;
        const f = flowHead.clone().addScaledVector(n, -flowHead.dot(n)).normalize();
        const tint = 0.94 + Math.random() * 0.06;
        items.push({ p: p.addScaledVector(n, -0.012), n, f, w: (face ? 0.055 : 0.075) + Math.random() * 0.02, len: (nape ? 0.22 : face ? 0.11 : 0.17) + Math.random() * 0.04, lift: (face ? 0.06 : 0.14) + Math.random() * 0.08, color: col.setRGB(tint, tint, Math.min(1, tint + 0.03)).clone(), parent: 'head' });
      }
      // neck rows
      const rows = 12;
      for (let r = 0; r < rows; r++) {
        const k = r / (rows - 1);
        const y = lerp(-0.62, -1.88, k);
        const radAt = (yy) => { for (let j = 0; j < prof.length - 1; j++) { const a = prof[j], b = prof[j + 1]; if (yy <= a.y && yy >= b.y) return lerp(a.x, b.x, (a.y - yy) / (a.y - b.y)); } return prof[prof.length - 1].x; };
        const R = radAt(y) + 0.01, dr = (radAt(y - 0.05) - radAt(y + 0.05)) / 0.1;
        const count = Math.round(lerp(34, 46, k));
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + (r % 2) * (Math.PI / count);
          const sa = Math.sin(a), ca = Math.cos(a);
          const p = new T.Vector3(R * sa, y, R * ca);
          const n = new T.Vector3(sa, dr, ca).normalize();
          const f = new T.Vector3(sa * dr, -1, ca * dr).normalize();
          let c;
          if (k < 0.3) c = new T.Color(0xffffff).lerp(new T.Color(0xeef2fa), Math.random());
          else if (k < 0.5) c = new T.Color(0xffffff).lerp(new T.Color(C.blue), (k - 0.3) / 0.2);
          else if (r === rows - 1) c = new T.Color(C.orange);
          else c = new T.Color(r % 2 ? C.blue : C.blueDeep);
          c.offsetHSL(0, 0, (Math.random() - 0.5) * 0.03);
          items.push({ p, n, f, w: lerp(0.1, 0.19, k) + Math.random() * 0.02, len: lerp(0.26, 0.5, k), lift: lerp(0.1, 0.22, k) + Math.random() * 0.06, color: c, parent: 'bust' });
        }
      }
      const mk = (list, parent) => {
        const im = new T.InstancedMesh(fg, M.feather, list.length);
        im.castShadow = true; im.receiveShadow = true;
        list.forEach((it, i) => {
          const z = it.f, y = it.n, x = new T.Vector3().crossVectors(y, z).normalize();
          it.basis = new T.Matrix4().makeBasis(x, y, z);
          it.phase = Math.random() * Math.PI * 2;
          im.setColorAt(i, it.color);
        });
        parent.add(im);
        return { im, list };
      };
      this.featherSets = [mk(items.filter((i) => i.parent === 'head'), head), mk(items.filter((i) => i.parent === 'bust'), bust)];
      this._m = { rx: new T.Matrix4(), s: new T.Matrix4(), t: new T.Matrix4(), out: new T.Matrix4() };
      this.state = { yaw: 0.9, pitch: 0, tilt: 0, bodyYaw: 0, scroll: 0, rootYaw: this.facingYaw, ruffle: 0, cock: 0, gx: 0, gy: 0, nextBlink: 2.2, blink: -1, lastRuffle: -1 };
      this._feathers(true);
      this._pose(0);
    }
    _feathers(force) {
      const S = this.state, m = this._m, t = this.t || 0;
      if (!force && Math.abs(S.ruffle - S.lastRuffle) < 0.002 && S.ruffle < 0.002) return;
      S.lastRuffle = S.ruffle;
      this.featherSets.forEach(({ im, list }) => {
        list.forEach((it, i) => {
          const lift = it.lift + S.ruffle * (0.35 + 0.15 * Math.sin(t * 22 + it.phase));
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
      const onFlap = () => this.flap();
      const onVis = () => { if (!document.hidden) this._last = performance.now(); };
      window.addEventListener('pointermove', onMove, { passive: true });
      document.addEventListener('pointerout', onLeave);
      window.addEventListener('ox-eagle-flap', onFlap);
      this._renderer.domElement.addEventListener('pointerdown', onFlap);
      document.addEventListener('visibilitychange', onVis);
      const ro = new ResizeObserver(([en]) => { const r = en && en.contentRect; if (this._resize(r && r.width, r && r.height) && reduced()) this._renderStatic(); });
      ro.observe(this);
      this.visible = true;
      const io = new IntersectionObserver(([en]) => { this.visible = en.isIntersecting; if (this.visible) this._last = performance.now(); });
      io.observe(this);
      this._cleanup = () => { window.removeEventListener('pointermove', onMove); document.removeEventListener('pointerout', onLeave); window.removeEventListener('ox-eagle-flap', onFlap); document.removeEventListener('visibilitychange', onVis); ro.disconnect(); io.disconnect(); };
    }
    flap() { if (reduced() || !this.state) return; this.ruffleUntil = this.t + 0.7; this.cockUntil = this.t + 0.9; }
    _resize(cw, ch) {
      const w = Math.round(cw || this.clientWidth), h = Math.round(ch || this.clientHeight);
      if (w < 4 || h < 4) return false;
      if (this._sz && this._sz[0] === w && this._sz[1] === h) return false;
      this._sz = [w, h];
      this._renderer.setSize(w, h, false);
      const a = w / h; this.camera.aspect = a;
      const dist = a < 0.9 ? 7.6 * (0.9 / a) : 7.6;
      this.camera.position.set(0, 0.2, dist * 1.08); this.camera.lookAt(0, -0.55, 0.2);
      this.camera.updateProjectionMatrix();
      return true;
    }
    _pose(dt) {
      const S = this.state, t = this.t || 0, d = dt || 1, rm = reduced();
      const e = easeOut(clamp(this.entrance, 0, 1));
      this.root.position.y = lerp(-0.9, 0, e) - S.scroll * 0.2;
      // gaze target
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
      S.cock = damp(S.cock, cocking ? 1 : 0, cocking ? 14 : 5, d);
      S.yaw = damp(S.yaw, ty, 5.5, d); S.pitch = damp(S.pitch, tp, 5.5, d); S.tilt = damp(S.tilt, tt + S.cock * 0.28, 4.5, d);
      S.bodyYaw = damp(S.bodyYaw, ty * 0.25, 2, d);
      S.rootYaw = damp(S.rootYaw, this.facingYaw, 3, d);
      this.headPivot.rotation.set(S.pitch * 0.85 - S.cock * 0.08, S.yaw * 0.8, S.tilt);
      this.bust.rotation.set(S.pitch * 0.12, S.bodyYaw, 0);
      this.root.rotation.y = S.rootYaw + S.scroll * 0.7;
      const br = rm ? 0 : Math.sin(t * 1.7) * 0.012;
      this.bust.scale.set(1 + br * 0.6, 1 + br * 0.3, 1 + br * 0.6);
      this.lowerBeak.rotation.x = S.cock * 0.1;
      // eyes: saccade toward gaze beyond the head turn
      S.gx = damp(S.gx, clamp((ty - S.yaw * 0.8) * 1.4, -0.3, 0.3), 14, d);
      S.gy = damp(S.gy, clamp((tp - S.pitch * 0.85) * 1.2, -0.2, 0.2), 14, d);
      let lidK = 0;
      if (!rm) {
        if (S.blink < 0 && t > S.nextBlink) S.blink = 0;
        if (S.blink >= 0) { S.blink += d; const b = S.blink / 0.18; lidK = b >= 1 ? 0 : Math.sin(b * Math.PI); if (b >= 1) { S.blink = -1; S.nextBlink = t + 2.4 + Math.random() * 3.4; } }
      }
      this.eyes.forEach(({ ball, lid }) => {
        ball.rotation.set(S.gy, S.gx, 0);
        lid.rotation.x = lerp(-0.05 + S.gy * 0.4, 1.65, lidK);
      });
      // feather ruffle
      const ruff = this.ruffleUntil && t < this.ruffleUntil;
      S.ruffle = damp(S.ruffle, ruff ? 1 : 0, ruff ? 16 : 4, d);
      this._feathers(false);
    }
    _scroll() {
      const host = this.closest('[data-eagle-scope]') || this;
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
  customElements.define('ox-eagle', OxEagle);
})();
