// <ox-origami-fox> — original folded-paper fox head (three.js).
// Folds itself up on entrance, head + eyes track the pointer, ears twitch on folded hinges,
// idle look-around + blink, ear flick + head tilt on click / 'ox-mascot-react', scroll turn,
// reduced-motion static pose, WebGL fallback.
(function () {
  if (customElements.get('ox-origami-fox')) return;
  const THREE_URL = 'https://unpkg.com/three@0.160.0/build/three.module.js';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const damp = (c, t, l, dt) => c + (t - c) * (1 - Math.exp(-l * dt));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COL = { o: [0xF7901E, 0xF28A1C], o2: [0xEE6A12, 0xE8620E], o3: [0xFBA23A, 0xF89A30], w: [0xFFFFFF, 0xF3F4F8], g: [0xDADFEA, 0xD3D9E6], b: [0x1F4FE0, 0x1A46CF], n: [0x10205E, 0x14286E], k: [0x0E1A45, 0x0E1A45] };

  class OxOrigamiFox extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;
      Object.assign(this.style, { display: 'block', position: 'relative', width: '100%', height: '100%' });
      this._loader = document.createElement('div');
      Object.assign(this._loader.style, { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', font: '500 12px ui-monospace, Menlo, monospace', color: '#475467', letterSpacing: '.04em' });
      this._loader.textContent = 'Folding…';
      this.appendChild(this._loader);
      this._boot().catch((e) => this._fallback(e));
    }
    disconnectedCallback() { this._dead = true; cancelAnimationFrame(this._raf); this._cleanup && this._cleanup(); this._renderer && this._renderer.dispose(); }
    get facingYaw() { const f = this.facing || this.getAttribute('facing') || 'left'; return f === 'center' ? 0 : f === 'right' ? 0.34 : -0.34; }
    _fallback(e) {
      console.warn('ox-origami-fox fallback', e);
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
      r.toneMappingExposure = 1.12;
      r.shadowMap.enabled = true;
      r.shadowMap.type = T.PCFSoftShadowMap;
      const cv = r.domElement;
      Object.assign(cv.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', opacity: '0', transition: 'opacity .5s ease', touchAction: 'pan-y', cursor: 'pointer' });
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
      s.add(new T.HemisphereLight(0xffffff, 0xf6e6da, 1.35));
      const key = new T.DirectionalLight(0xfff8f0, 2.4);
      key.position.set(-3, 4, 5);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 16 });
      key.shadow.bias = -0.0006; key.shadow.normalBias = 0.01; key.shadow.radius = 3;
      s.add(key);
      const rim = new T.DirectionalLight(0xb6cbf7, 1.4); rim.position.set(4, 2, -4); s.add(rim);
      const fill = new T.DirectionalLight(0xffffff, 0.55); fill.position.set(3, -2, 4); s.add(fill);
    }
    _points(f, earL, earR) {
      const T = this.T, V = (a) => new T.Vector3(a[0], a[1], a[2] * f);
      const P = { F: V([0, 0.55, 0.42]), N: V([0, -0.16, 0.8]), S: V([0, -1.14, 0.96]), BK: V([0, 0.38, -0.78]), BB: V([0, -0.58, -0.46]) };
      [['l', -1, earL], ['r', 1, earR]].forEach(([k, s, ear]) => {
        const EI = V([s * 0.34, 0.68, 0.24]), EO = V([s * 1.08, 0.42, -0.06]);
        const flat = new T.Vector3(s * 1.02, 1.62, 0);
        let ET = V([s * 0.98, 1.64, -0.22]);
        ET = flat.lerp(ET, f);
        const axis = EO.clone().sub(EI).normalize();
        const rot = (p) => p.clone().sub(EI).applyAxisAngle(axis, s * ear).add(EI);
        ET = rot(ET);
        Object.assign(P, { ['EI' + k]: EI, ['EO' + k]: EO, ['ET' + k]: ET, ['L' + k]: V([s * 1.3, 0.02, -0.02]), ['J' + k]: V([s * 0.6, -0.62, 0.38]), ['SK' + k]: V([s * 0.15, 0.52, 0.5]), ['NK' + k]: V([s * 0.11, -0.3, 0.84]), ['M' + k]: V([s * 0.86, -0.16, 0.3]) });
      });
      return P;
    }
    _tris(P) {
      const out = [];
      ['l', 'r'].forEach((k) => {
        const EI = P['EI' + k], EO = P['EO' + k], ET = P['ET' + k], L = P['L' + k], J = P['J' + k], SK = P['SK' + k], NK = P['NK' + k], M = P['M' + k];
        // white centre stripe forehead -> nose
        out.push([P.F, SK, P.N, 'w'], [SK, NK, P.N, 'w'], [P.N, NK, P.S, 'w']);
        // forehead + upper cheek
        out.push([P.F, EI, SK, 'o'], [EI, L, SK, 'o3', 'eyeplane'], [EI, EO, L, 'o2']);
        // eye band + lower cheek
        out.push([SK, L, M, 'o'], [SK, M, NK, 'o2']);
        out.push([L, J, M, 'o2'], [M, J, NK, 'g'], [NK, J, P.S, 'w']);
        // ears: orange outer, blue inner flap
        out.push([EI, EO, ET, 'o', 'ear']);
        // back of head
        out.push([P.F, P.BK, EI, 'o2'], [EI, P.BK, EO, 'o2'], [EO, P.BK, L, 'o2'], [L, P.BK, P.BB, 'o2'], [L, P.BB, J, 'n'], [J, P.BB, P.S, 'n']);
        const c = EI.clone().add(EO).add(ET).multiplyScalar(1 / 3).add(new this.T.Vector3(0, -0.04, 0));
        const sh = (p, k2) => c.clone().lerp(p, k2);
        out.push([sh(EI, 0.72), sh(EO, 0.72), sh(ET, 0.8), 'b', 'flap']);
        out.push([sh(EI, 0.4), sh(EO, 0.4), sh(ET, 0.55), 'n', 'flap2']);
        const tip = P.S, up = tip.clone().lerp(P.N, 0.24), side = tip.clone().lerp(NK, 0.32).lerp(J, 0.08);
        out.push([tip, up, side, 'k', 'nose']);
      });
      return out;
    }
    _build() {
      const T = this.T;
      const root = new T.Group(); this.scene.add(root); this.root = root;
      const head = new T.Group(); root.add(head); this.head = head;
      const P = this._points(1, 0, 0), tris = this._tris(P);
      const n = tris.length * 3;
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(n * 3), 3));
      const col = [];
      const c = new T.Color();
      tris.forEach((tr, i) => { const pal = COL[tr[3]]; c.setHex(pal[i % 2]); const v = tr[3] === 'k' || tr[3] === 'n' ? 1 : 0.97 + ((i * 37) % 7) / 200; for (let j = 0; j < 3; j++) col.push(c.r * v, c.g * v, c.b * v); });
      geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      this.geo = geo;
      const front = new T.Mesh(geo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05, flatShading: true, side: T.FrontSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
      const back = new T.Mesh(geo, new T.MeshStandardMaterial({ color: 0x1F4FE0, roughness: 0.85, flatShading: true, side: T.BackSide }));
      front.castShadow = back.castShadow = true; front.receiveShadow = back.receiveShadow = true;
      head.add(front, back);
      this.creases = new T.LineSegments(new T.BufferGeometry(), new T.LineBasicMaterial({ color: 0x8a3c0c, transparent: true, opacity: 0.28 }));
      head.add(this.creases);
      // eyes: flat folded-paper almonds on the cheek planes
      this.eyes = [-1, 1].map((s) => {
        const g = new T.Group(); head.add(g);
        const almond = new T.Shape();
        almond.moveTo(-0.17, 0); almond.quadraticCurveTo(0, 0.12, 0.17, 0.02); almond.quadraticCurveTo(0.02, -0.08, -0.17, 0);
        const mask = new T.Mesh(new T.ShapeGeometry(almond, 16), new T.MeshBasicMaterial({ color: 0x0E1A45, side: T.DoubleSide }));
        mask.scale.set(1.55, 1.9, 1); mask.position.set(-0.02, -0.01, -0.001); g.add(mask);
        const eye = new T.Mesh(new T.ShapeGeometry(almond, 16), new T.MeshBasicMaterial({ color: 0x3FA9FF, side: T.DoubleSide }));
        eye.scale.set(0.92, 0.85, 1);
        const glow = new T.Mesh(new T.ShapeGeometry(almond, 16), new T.MeshBasicMaterial({ color: 0x2E6BFF, transparent: true, opacity: 0.45, side: T.DoubleSide, depthWrite: false }));
        glow.scale.set(1.25, 1.45, 1); glow.position.z = 0.001;
        const hl = new T.Mesh(new T.CircleGeometry(0.03, 12), new T.MeshBasicMaterial({ color: 0xE6F6FF }));
        hl.scale.set(1.6, 0.6, 1); hl.position.set(0.02, 0.012, 0.003);
        const lidPivot = new T.Group(); g.add(lidPivot); lidPivot.add(glow, eye, hl);
        return { g, lidPivot, hl, s };
      });
      // soft contact shadow
      const sc = document.createElement('canvas'); sc.width = sc.height = 128;
      const x = sc.getContext('2d'); const gr = x.createRadialGradient(64, 64, 2, 64, 64, 64);
      gr.addColorStop(0, 'rgba(23,32,51,.22)'); gr.addColorStop(1, 'rgba(23,32,51,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
      const shadow = new T.Mesh(new T.PlaneGeometry(2.8, 1.1), new T.MeshBasicMaterial({ map: new T.CanvasTexture(sc), transparent: true, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.75; this.scene.add(shadow); this.shadow = shadow;
      this.state = { yaw: 0.6, pitch: 0, tilt: 0, scroll: 0, rootYaw: this.facingYaw, cock: 0, gx: 0, gy: 0, nextBlink: 2.4, blink: -1, nextTwitch: 3, earL: 0, earR: 0, kL: 0, kR: 0, fold: -1 };
      this._fold(reduced() ? 1 : 0, 0, 0);
    }
    _fold(f, earL, earR) {
      const T = this.T;
      const P = this._points(f, earL, earR), tris = this._tris(P);
      const pos = this.geo.attributes.position, C = new T.Vector3(0, 0.12, -0.05);
      const a = new T.Vector3(), b = new T.Vector3(), nrm = new T.Vector3();
      tris.forEach((tr, i) => {
        let [p0, p1, p2, , tag] = tr;
        a.subVectors(p1, p0); b.subVectors(p2, p0); nrm.crossVectors(a, b).normalize();
        const cen = p0.clone().add(p1).add(p2).multiplyScalar(1 / 3);
        const outward = tag ? nrm.z >= 0 || f < 0.05 : nrm.dot(cen.sub(C)) >= 0;
        if (!outward) { [p1, p2] = [p2, p1]; nrm.negate(); }
        const off = tag === 'flap' ? 0.012 : tag === 'flap2' ? 0.022 : tag === 'nose' ? 0.008 : 0;
        [p0, p1, p2].forEach((p, j) => pos.setXYZ(i * 3 + j, p.x + nrm.x * off, p.y + nrm.y * off, p.z + nrm.z * off));
      });
      pos.needsUpdate = true;
      this.geo.computeVertexNormals();
      this.geo.computeBoundingSphere();
      this.creases.geometry.dispose();
      this.creases.geometry = new T.EdgesGeometry(this.geo, 8);
      // place eyes on cheek planes [EI, N, L]
      this.eyes.forEach(({ g, s }) => {
        const k = s < 0 ? 'l' : 'r';
        const EI = P['EI' + k], L = P['L' + k], N = P['SK' + k], EO = P['EO' + k];
        a.subVectors(N, EI); b.subVectors(L, EI); nrm.crossVectors(a, b).normalize(); if (nrm.z < 0) nrm.negate();
        const at = EI.clone().multiplyScalar(0.18).add(L.clone().multiplyScalar(0.34)).add(N.clone().multiplyScalar(0.48)).add(new T.Vector3(0, -0.12, 0));
        let xd = EO.clone().sub(P['NK' + k]); xd.addScaledVector(nrm, -xd.dot(nrm)).normalize(); if (s < 0) xd.negate();
        const yd = new T.Vector3().crossVectors(nrm, xd).normalize();
        const m = new T.Matrix4().makeBasis(xd, yd, nrm);
        g.position.copy(at).addScaledVector(nrm, 0.02);
        g.quaternion.setFromRotationMatrix(m);
        g.scale.set(s < 0 ? -1.7 : 1.7, 1.7, 1);
        g.visible = f > 0.6;
      });
    }
    _wire() {
      this.pointer = { x: 0, y: 0, active: false, lastMove: -10 };
      const onMove = (e) => {
        const r = this.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height * 0.45;
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
    react() { if (reduced() || !this.state) return; this.cockUntil = this.t + 0.9; this.state.kL = 1; this.state.kR = 1; }
    _resize(cw, ch) {
      const w = Math.round(cw || this.clientWidth), h = Math.round(ch || this.clientHeight);
      if (w < 4 || h < 4) return false;
      if (this._sz && this._sz[0] === w && this._sz[1] === h) return false;
      this._sz = [w, h];
      this._renderer.setSize(w, h, false);
      const a = w / h; this.camera.aspect = a;
      const dist = a < 0.85 ? 8 * (0.85 / a) : 8;
      this.camera.position.set(0, 0.3, dist); this.camera.lookAt(0, 0.12, 0);
      this.camera.updateProjectionMatrix();
      return true;
    }
    _pose(dt) {
      const S = this.state, t = this.t || 0, d = dt || 1, rm = reduced();
      const fe = easeInOut(clamp(this.entrance, 0, 1));
      const idle = !this.pointer || !this.pointer.active || t - this.pointer.lastMove > 3.2;
      let ty, tp, tt;
      if (rm) { ty = 0.08; tp = 0.03; tt = 0; }
      else if (idle) { ty = Math.sin(t * 0.42) * 0.42 + Math.sin(t * 0.17) * 0.12; tp = Math.sin(t * 0.31) * 0.08 + 0.04; tt = Math.sin(t * 0.7) * 0.06; }
      else { ty = this.pointer.x * 0.85; tp = this.pointer.y * 0.42; tt = -this.pointer.x * 0.08; }
      if (!idle) ty -= S.rootYaw * 0.7;
      tp += S.scroll * 0.35;
      ty = clamp(ty, -1, 1); tp = clamp(tp, -0.45, 0.5);
      const cocking = this.cockUntil && t < this.cockUntil;
      S.cock = damp(S.cock, cocking ? 1 : 0, cocking ? 12 : 5, d);
      S.yaw = damp(S.yaw, ty, 5.5, d); S.pitch = damp(S.pitch, tp, 5.5, d); S.tilt = damp(S.tilt, tt + S.cock * 0.24, 4.5, d);
      S.rootYaw = damp(S.rootYaw, this.facingYaw, 3, d);
      const yaw = lerp(0, S.yaw, fe), pitch = lerp(-0.25, S.pitch, fe);
      this.head.rotation.set(pitch, yaw, S.tilt + lerp(0.5, 0, fe));
      this.root.rotation.y = S.rootYaw * fe + S.scroll * 0.7;
      const bob = rm ? 0 : Math.sin(t * 1.5) * 0.04;
      this.root.position.y = lerp(0.35, 0, fe) + bob * fe - S.scroll * 0.25;
      this.shadow.scale.setScalar(1 - bob * 0.8);
      this.shadow.material.opacity = fe;
      // ear twitch on hinges
      if (!rm && fe >= 1 && t > S.nextTwitch) { if (Math.random() < 0.5) S.kL = 1; else S.kR = 1; S.nextTwitch = t + 2.4 + Math.random() * 4; }
      S.kL = damp(S.kL, 0, 6, d); S.kR = damp(S.kR, 0, 6, d);
      const lean = clamp(S.yaw, -0.6, 0.6) * 0.18;
      const eL = -S.kL * 0.5 + lean + (rm ? 0 : Math.sin(t * 1.1) * 0.02), eR = -S.kR * 0.5 - lean + (rm ? 0 : Math.sin(t * 1.1 + 1) * 0.02);
      const changed = Math.abs(fe - S.fold) > 1e-4 || Math.abs(eL - S.earL) > 1e-4 || Math.abs(eR - S.earR) > 1e-4;
      if (changed) { S.fold = fe; S.earL = eL; S.earR = eR; this._fold(Math.max(0.001, fe), eL, eR); }
      // eyes: gaze shift + blink
      S.gx = damp(S.gx, clamp((ty - S.yaw) * 0.12, -0.03, 0.03), 14, d);
      S.gy = damp(S.gy, clamp((tp - S.pitch) * 0.1, -0.02, 0.02), 14, d);
      let lidK = 0;
      if (!rm && fe >= 1) {
        if (S.blink < 0 && t > S.nextBlink) S.blink = 0;
        if (S.blink >= 0) { S.blink += d; const b = S.blink / 0.16; lidK = b >= 1 ? 0 : Math.sin(b * Math.PI); if (b >= 1) { S.blink = -1; S.nextBlink = t + 2.4 + Math.random() * 3.4; } }
      }
      this.eyes.forEach(({ lidPivot, hl }) => { lidPivot.scale.y = 1 - lidK * 0.9; lidPivot.position.set(S.gx, -S.gy, 0); hl.visible = lidK < 0.5; });
    }
    _scroll() {
      const host = this.closest('[data-eagle-scope],[data-mascot-scope]') || this;
      const hr = host.getBoundingClientRect();
      const p = clamp(-hr.top / Math.max(1, hr.height * 0.9), 0, 1);
      this.state.scroll = damp(this.state.scroll, p, 5, this._dt || 0.016);
    }
    _renderStatic() { if (!this.state || !this._sz) return; this.entrance = 1; this._pose(1); this._renderer.render(this.scene, this.camera); }
    _loop() {
      const tick = (now) => {
        if (this._dead) return;
        this._raf = requestAnimationFrame(tick);
        if (!this.visible || document.hidden) return;
        this._resize();
        const dt = Math.min(0.05, (now - this._last) / 1000); this._last = now; this._dt = dt;
        this.t += dt;
        if (this.t > 0.25 && this.entrance < 1) this.entrance = Math.min(1, this.entrance + dt / 1.4);
        this._scroll();
        this._pose(dt);
        this._renderer.render(this.scene, this.camera);
      };
      this._raf = requestAnimationFrame(tick);
    }
  }
  customElements.define('ox-origami-fox', OxOrigamiFox);
})();
