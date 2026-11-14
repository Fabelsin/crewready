'use strict';

/* =========================================================
   CrewReady — 3D views for the mission checks.
   Three.js is loaded on demand (import map in index.html).
   Game logic and metrics stay in app.js; a view only draws
   the current state, so a missing WebGL keeps the 2D check.
   ========================================================= */
(function () {
  const supportsWebGL = (() => {
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
  })();

  let libP = null;
  const lib = () => libP || (libP = Promise.all([
    import('three'),
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/environments/RoomEnvironment.js'),
  ]).then(([THREE, g, r]) => ({ THREE, GLTFLoader: g.GLTFLoader, RoomEnvironment: r.RoomEnvironment })));

  const glbCache = {};
  const loadGLB = (L, url) => glbCache[url] || (glbCache[url] = new Promise((res, rej) => {
    new L.GLTFLoader().load(url, (g) => res(g.scene), undefined, rej);
  }));

  // One renderer for the whole site: its canvas moves into whichever check is open.
  let core = null;
  function getCore(L) {
    if (core) return core;
    const { THREE } = L;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new L.RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    renderer.domElement.className = 'gl-canvas';
    core = { renderer, env, canvas: renderer.domElement };
    return core;
  }

  // Stars + Earth limb + sunlight, shared look for every orbital scene.
  function orbitBackdrop(THREE, scene) {
    const own = [];
    const n = 1400, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 220;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = r * s * Math.cos(a); pos[i * 3 + 1] = r * u; pos[i * 3 + 2] = r * s * Math.sin(a);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false }));
    scene.add(stars); own.push(sg, stars.material);

    const earthGeo = new THREE.SphereGeometry(150, 64, 48);
    const earth = new THREE.Mesh(earthGeo, new THREE.MeshStandardMaterial({ color: 0x24609f, roughness: 0.85, metalness: 0, emissive: 0x081a33, emissiveIntensity: 0.6 }));
    earth.position.set(0, -182, -130);
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(154, 64, 48), new THREE.MeshBasicMaterial({ color: 0x6fb6ff, transparent: true, opacity: 0.28, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    atmo.position.copy(earth.position);
    const sky = new THREE.Group(); sky.add(earth, atmo); scene.add(sky);
    own.push(earthGeo, earth.material, atmo.geometry, atmo.material);

    const sun = new THREE.DirectionalLight(0xfff4e6, 3.4); sun.position.set(6, 5, 7); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 1.1); fill.position.set(-3, -1, 8); scene.add(fill);   // camera-side fill, keeps the hull readable
    scene.add(new THREE.HemisphereLight(0x9cc8ff, 0x1a3350, 0.6));
    return { stars, sky, own };
  }

  /**
   * Mount a 3D view into `box`. `setup(THREE, scene, camera, model, box)` returns
   * { frame(state, now), ...extra }. Rendering happens only when frame() is called,
   * i.e. while the check loop runs — an idle page costs nothing.
   */
  function mountView(box, url, getState, setup) {
    const view = { ready: false, frame() {}, api: null, dispose() {}, pumpUntil: 0, pumpRaf: 0 };
    // Checks without their own animation loop ask the view to keep rendering for `ms`.
    view.pump = (ms) => {
      view.pumpUntil = Math.max(view.pumpUntil, performance.now() + ms);
      if (view.pumpRaf) return;
      const tick = (now) => {
        if (view.cancelled || now > view.pumpUntil) { view.pumpRaf = 0; return; }
        if (view.ready) view.frame(getState(), now);
        view.pumpRaf = requestAnimationFrame(tick);
      };
      view.pumpRaf = requestAnimationFrame(tick);
    };
    if (!supportsWebGL) return view;
    lib().then(async (L) => {
      const model = url ? (await loadGLB(L, url)).clone(true) : null;
      if (!box.isConnected || view.cancelled) return;
      const c = getCore(L);
      const scene = new L.THREE.Scene();
      scene.environment = c.env;
      const camera = new L.THREE.PerspectiveCamera(45, 1, 0.1, 600);
      const api = setup(L.THREE, scene, camera, model, box);
      box.insertBefore(c.canvas, box.firstChild);
      const resize = () => {
        const w = box.clientWidth, h = box.clientHeight;
        if (!w || !h) return;
        c.renderer.setSize(w, h, false);
        camera.aspect = w / h; camera.updateProjectionMatrix();
        if (view.ready) view.frame(getState(), performance.now());
      };
      const ro = new ResizeObserver(resize); ro.observe(box);
      view.api = api;
      view.frame = (s, now) => { api.frame(s, now); c.renderer.render(scene, api.camera || camera); };
      view.release = () => { ro.disconnect(); (api.own || []).forEach((o) => o.dispose && o.dispose()); };
      if (view.cancelled) { view.release(); return; }
      view.ready = true;
      box.classList.add('is3d');
      resize();
      view.frame(getState(), performance.now());
    }).catch((e) => { console.warn('CrewReady: 3D view unavailable, keeping the 2D check.', e); });
    view.dispose = () => { view.cancelled = true; cancelAnimationFrame(view.pumpRaf); if (view.release) view.release(); };
    return view;
  }

  // ---------------------------------------------------------
  // 1. Cygnus capture — view from the Canadarm2 end-effector camera
  // ---------------------------------------------------------
  function cygnus(box, getState) {
    const v = mountView(box, 'assets/models/cygnus.glb', getState, (THREE, scene, camera, model) => {
      const bg = orbitBackdrop(THREE, scene);
      const own = [...bg.own];

      // Normalise: hull along X, 4 units long (≈ 6.4 m), solar arrays spreading along screen Y.
      const b = new THREE.Box3().setFromObject(model), size = b.getSize(new THREE.Vector3()), ctr = b.getCenter(new THREE.Vector3());
      const s = 4 / Math.max(size.x, size.y, size.z);
      model.scale.setScalar(s); model.position.copy(ctr).multiplyScalar(-s);
      const holder = new THREE.Group(); holder.add(model);
      holder.rotation.x = Math.PI / 2;            // model +Y (top of the hull) faces the arm camera
      holder.updateMatrixWorld(true);

      // Find the hull surface facing the camera — the grapple fixture sits there.
      const ray = new THREE.Raycaster(); let hit = null;
      for (const x of [0.5, 0.8, 0.2, 1.1]) {
        ray.set(new THREE.Vector3(x, 0, 20), new THREE.Vector3(0, 0, -1));
        const h = ray.intersectObject(holder, true)[0];
        if (h && (!hit || h.point.z > hit.point.z - 0.05)) { hit = h; break; }
      }
      const fix = hit ? hit.point.clone() : new THREE.Vector3(0.5, 0, 0.6);
      holder.position.copy(fix).multiplyScalar(-1);

      // Grapple fixture (procedural): base plate, target ring, grapple shaft and knob.
      const metal = new THREE.MeshStandardMaterial({ color: 0xb9c2d0, metalness: 0.85, roughness: 0.35 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x2a3040, metalness: 0.6, roughness: 0.5 });
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xf2f5fb });
      const geos = [new THREE.BoxGeometry(0.5, 0.5, 0.05), new THREE.CylinderGeometry(0.035, 0.035, 0.36, 16), new THREE.SphereGeometry(0.075, 20, 14),
        new THREE.RingGeometry(0.17, 0.215, 48), new THREE.CircleGeometry(0.17, 48)];
      const fixture = new THREE.Group();
      const plate = new THREE.Mesh(geos[0], dark);
      const shaft = new THREE.Mesh(geos[1], metal); shaft.rotation.x = Math.PI / 2; shaft.position.z = 0.18;
      const knob = new THREE.Mesh(geos[2], metal); knob.position.z = 0.37;
      const disc = new THREE.Mesh(geos[4], new THREE.MeshBasicMaterial({ color: 0x0b0f18 })); disc.position.z = 0.03;
      const ring = new THREE.Mesh(geos[3], ringMat); ring.position.z = 0.035;
      fixture.add(plate, disc, ring, shaft, knob);
      own.push(...geos, metal, dark, ringMat, disc.material);

      const pivot = new THREE.Group();   // origin = grapple fixture, so wobble never moves the aim point
      pivot.add(holder, fixture);
      scene.add(pivot);

      // HUD drawn over the canvas
      const hud = document.createElement('div');
      hud.className = 'lee-hud';
      hud.innerHTML = '<span>LEE CAM</span><b class="lee-range">—</b>';
      const arrow = document.createElement('div');
      arrow.className = 'off-arrow'; arrow.hidden = true;
      box.appendChild(hud); box.appendChild(arrow);
      const rangeEl = hud.querySelector('.lee-range');

      const ok = new THREE.Color(0x34d399), white = new THREE.Color(0xf2f5fb);
      let capAt = -1e9, lastRange = '';
      return {
        own,
        capture(now) { capAt = now; },
        frame(S, now) {
          const t = now / 1000;
          const D = 6 + 0.35 * Math.sin(t * 0.4) + 0.15 * Math.sin(t * 1.1);
          const halfH = Math.tan((camera.fov * Math.PI) / 360) * D, halfW = halfH * camera.aspect;
          const ox = S.tx - S.x, oy = S.ty - S.y;
          pivot.position.set(ox * 2 * halfW, -oy * 2 * halfH, -D);
          pivot.rotation.set(0.05 * Math.sin(t * 0.31), 0.08 * Math.sin(t * 0.23), 0.04 * Math.sin(t * 0.17));
          // arm steering → background parallax
          bg.stars.rotation.set((S.y - 0.5) * 0.25, -(S.x - 0.5) * 0.35, 0);
          bg.sky.position.set(-(S.x - 0.5) * 6, (S.y - 0.5) * 4, 0);
          // capture: short snare motion of the camera towards the fixture
          const p = (now - capAt) / 450;
          camera.position.z = p >= 0 && p < 1 ? -D * 0.22 * Math.sin(Math.PI * p) : 0;
          const aligned = Math.hypot(ox * camera.aspect, oy) / camera.aspect < 0.055;
          ringMat.color.copy(aligned ? ok : white);
          const range = `RANGE ${(D * 1.6).toFixed(1)} m`;
          if (range !== lastRange) { rangeEl.textContent = range; lastRange = range; }
          // the fixture is out of the camera view → arrow at the edge
          const off = Math.abs(ox) > 0.48 || Math.abs(oy) > 0.46;
          arrow.hidden = !off;
          if (off) {
            const k = 0.42 / Math.max(Math.abs(ox) / 1.0, Math.abs(oy) / 0.95);
            arrow.style.left = `${50 + ox * k * 100}%`; arrow.style.top = `${50 + oy * k * 100}%`;
            arrow.style.transform = `translate(-50%,-50%) rotate(${Math.atan2(oy, ox)}rad)`;
          }
        },
      };
    });
    return v;
  }

  // ---------------------------------------------------------
  // 2. Docking monitor — ISS centerline camera on the docking adapter
  //    The three monitored values drive the vehicle: closing rate → approach,
  //    lateral offset → sideways drift, pitch → nose attitude.
  // ---------------------------------------------------------
  const DRAGON_ROT = [Math.PI / 2 - 0.18, 0.15, 0];   // model nose (docking port) → towards the camera
  function docking(box, getState) {
    return mountView(box, 'assets/models/dragon.glb', getState, (THREE, scene, camera, model) => {
      const bg = orbitBackdrop(THREE, scene);
      const own = [...bg.own];
      camera.fov = 38; camera.updateProjectionMatrix();

      const b = new THREE.Box3().setFromObject(model), size = b.getSize(new THREE.Vector3()), ctr = b.getCenter(new THREE.Vector3());
      const s = 2.6 / Math.max(size.x, size.y, size.z);      // ≈ 8 m vehicle, 1 unit ≈ 3 m
      model.scale.setScalar(s); model.position.copy(ctr).multiplyScalar(-s);
      const holder = new THREE.Group(); holder.add(model); holder.rotation.set(...DRAGON_ROT);
      const vehicle = new THREE.Group(); vehicle.add(holder); scene.add(vehicle);

      // Approach lights on the vehicle nose: two blinking beacons
      const beaconGeo = new THREE.SphereGeometry(0.03, 10, 8);
      const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff5a4f });
      const beacons = [-0.45, 0.45].map((x) => { const m = new THREE.Mesh(beaconGeo, beaconMat); m.position.set(x, 0.35, 1.0); vehicle.add(m); return m; });
      own.push(beaconGeo, beaconMat);

      // Approach corridor drawn on the camera view: dashed cone to the docking port
      const corridorMat = new THREE.LineDashedMaterial({ color: 0x34d399, dashSize: 0.4, gapSize: 0.3, transparent: true, opacity: 0.45 });
      const pts = [];
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([x, y]) => { pts.push(new THREE.Vector3(x * 0.25, y * 0.25, -1.5), new THREE.Vector3(x * 1.6, y * 1.6, -40)); });
      const corridorGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const corridor = new THREE.LineSegments(corridorGeo, corridorMat); corridor.computeLineDistances(); scene.add(corridor);
      own.push(corridorGeo, corridorMat);

      const hud = document.createElement('div');
      hud.className = 'lee-hud';
      hud.innerHTML = '<span>CL CAM</span><b class="dk-range">—</b>';
      box.appendChild(hud);
      const cross = document.createElement('div'); cross.className = 'cl-cross'; box.appendChild(cross);
      const rangeEl = hud.querySelector('.dk-range');

      let t0 = -1, last = 0, range = 24, lastTxt = '';
      return {
        own,
        frame(S, now) {
          if (S.t0 !== t0) { t0 = S.t0; range = 24; last = now; }
          const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
          const [rate, lat, pitch] = S.v;
          if (S.running) range = Math.max(3.2, range - rate * 6 * dt);     // demo time-scale ×6
          const D = range / 3;                                                  // metres → scene units
          const t = now / 1000;
          vehicle.position.set(lat * 0.03 * (D / 4 + 0.6), 0.05 * Math.sin(t * 0.7), -D);
          vehicle.rotation.set((pitch * Math.PI / 180) * 4, 0.04 * Math.sin(t * 0.3), 0.03 * Math.sin(t * 0.21));
          const on = Math.floor(t * 1.6) % 2 === 0;
          beacons.forEach((m, i) => { m.visible = i ? on : !on; });
          bg.stars.rotation.y = t * 0.004;
          const txt = `RANGE ${range.toFixed(1)} m · ${rate.toFixed(2)} m/s`;
          if (txt !== lastTxt) { rangeEl.textContent = txt; lastTxt = txt; }
        },
      };
    });
  }

  // ---------------------------------------------------------
  // 3. Solar array EVA — truss segment with iROSA, four attach-point bolts.
  //    The DOM buttons (A–D) are kept for input/accessibility and are placed
  //    exactly over the 3D bolts; the active bolt turns with the applied torque.
  // ---------------------------------------------------------
  const TRUSS_ROT = [0, -Math.PI / 2, 0];
  function eva(box, getState) {
    return mountView(box, 'assets/models/irosa.glb', getState, (THREE, scene, camera, model, host) => {
      const bg = orbitBackdrop(THREE, scene);
      const own = [...bg.own];
      camera.fov = 32; camera.updateProjectionMatrix();

      const b = new THREE.Box3().setFromObject(model), size = b.getSize(new THREE.Vector3()), ctr = b.getCenter(new THREE.Vector3());
      const s = 6 / Math.max(size.x, size.y, size.z);
      model.scale.setScalar(s); model.position.copy(ctr).multiplyScalar(-s);
      const holder = new THREE.Group(); holder.add(model); holder.rotation.set(...TRUSS_ROT);
      scene.add(holder);
      holder.updateMatrixWorld(true);
      const wb = new THREE.Box3().setFromObject(holder);
      camera.position.set(0, 3.4, 6.6);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);

      // Four bolts on the truss face, spread along the beam (A..D left → right)
      const ray = new THREE.Raycaster();
      const span = (wb.max.x - wb.min.x) * 0.52;
      const zRow = wb.max.z * 0.5;                 // front half of the truss; the array sits behind (z < 0)
      bg.sky.position.y = -55;                     // keep the Earth low so the truss reads against space
      const plateGeo = new THREE.BoxGeometry(0.5, 0.05, 0.5);
      const plateMat = new THREE.MeshStandardMaterial({ color: 0x5b6577, metalness: 0.7, roughness: 0.5 });
      own.push(plateGeo, plateMat);
      const hexGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.09, 6);
      const washerGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.025, 28);
      const ringGeo = new THREE.TorusGeometry(0.24, 0.022, 10, 40);
      const boltMat = new THREE.MeshStandardMaterial({ color: 0xc9d1de, metalness: 0.9, roughness: 0.3 });
      const washerMat = new THREE.MeshStandardMaterial({ color: 0x7b8598, metalness: 0.8, roughness: 0.45 });
      own.push(hexGeo, washerGeo, ringGeo, boltMat, washerMat);
      const ringMats = {};
      const ringColor = (k) => ringMats[k] || (ringMats[k] = new THREE.MeshBasicMaterial({ color: { idle: 0x9aa6c2, active: 0x6aa8ff, good: 0x34d399, warn: 0xffb020 }[k], transparent: true, opacity: 0.9 }));
      const bolts = ['A', 'B', 'C', 'D'].map((p, i) => {
        const x = -span / 2 + (span * i) / 3;
        // highest truss surface under this point (a 3×3 probe, so lattice holes don't drop the bolt)
        let top = -Infinity;
        for (const dx of [-0.15, 0, 0.15]) for (const dz of [-0.15, 0, 0.15]) {
          ray.set(new THREE.Vector3(x + dx, wb.max.y + 5, zRow + dz), new THREE.Vector3(0, -1, 0));
          const h = ray.intersectObject(holder, true)[0];
          if (h) top = Math.max(top, h.point.y);
        }
        if (!Number.isFinite(top)) top = 0;
        const g = new THREE.Group(); g.position.set(x, top + 0.025, zRow);
        const plate = new THREE.Mesh(plateGeo, plateMat); plate.position.y = -0.0;
        const washer = new THREE.Mesh(washerGeo, washerMat); washer.position.y = 0.035;
        g.add(plate);
        const head = new THREE.Mesh(hexGeo, boltMat); head.position.y = 0.09;
        const ring = new THREE.Mesh(ringGeo, ringColor('idle')); ring.rotation.x = Math.PI / 2; ring.position.y = 0.05;
        g.add(washer, head, ring); scene.add(g);
        return { p, g, head, ring };
      });
      // Pistol-grip tool on the active bolt
      const tool = new THREE.Group();
      const toolMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d0, metalness: 0.2, roughness: 0.6 });
      const sockMat = new THREE.MeshStandardMaterial({ color: 0x3a4152, metalness: 0.85, roughness: 0.35 });
      const tg = [new THREE.CylinderGeometry(0.075, 0.075, 0.5, 18), new THREE.BoxGeometry(0.2, 0.36, 0.16), new THREE.BoxGeometry(0.1, 0.1, 0.42)];
      const socket = new THREE.Mesh(tg[0], sockMat); socket.position.y = 0.36;
      const body = new THREE.Mesh(tg[1], toolMat); body.position.y = 0.72;
      const grip = new THREE.Mesh(tg[2], toolMat); grip.position.set(0, 0.68, 0.26);
      tool.add(socket, body, grip); tool.visible = false; scene.add(tool);
      own.push(toolMat, sockMat, ...tg, ...Object.values(ringMats));

      const place = () => {
        const w = host.clientWidth, h = host.clientHeight;
        camera.updateMatrixWorld(true);
        bolts.forEach((bl) => {
          const btn = host.querySelector(`.ap[data-p="${bl.p}"]`);
          if (!btn) return;
          const v = bl.g.position.clone().project(camera);
          btn.style.left = `${((v.x + 1) / 2) * w}px`;
          btn.style.top = `${((1 - v.y) / 2) * h}px`;
        });
      };
      let lastW = 0, lastH = 0;
      return {
        own,
        frame(S, now) {
          if (host.clientWidth !== lastW || host.clientHeight !== lastH) { lastW = host.clientWidth; lastH = host.clientHeight; place(); }
          const t = now / 1000;
          bolts.forEach((bl) => {
            const st = S.points[bl.p];
            const k = st.active ? 'active' : st.good ? 'good' : st.warn ? 'warn' : 'idle';
            bl.ring.material = ringColor(k);
            bl.ring.scale.setScalar(st.active ? 1 + 0.08 * Math.sin(t * 6) : 1);
            if (st.active) bl.head.rotation.y = -(S.torque / 100) * Math.PI * 3;
          });
          const act = S.active && bolts.find((bl) => bl.p === S.active);
          tool.visible = !!act;
          if (act) {
            tool.position.copy(act.g.position); tool.quaternion.copy(act.g.quaternion);
            tool.rotateY(-(S.torque / 100) * Math.PI * 3);
            tool.translateY(S.holding ? 0 : 0.06 + 0.02 * Math.sin(t * 4));
          }
          holder.rotation.y = TRUSS_ROT[1] + 0.01 * Math.sin(t * 0.2);
        },
      };
    });
  }

  // ---------------------------------------------------------
  // 4. Water recovery — the WRS rack inside the module, four ORUs in a 2×2 bay.
  //    Unit IDs stay as crisp DOM text (the look-alike characters are the test);
  //    the 3D rack shows which slot is which and slides out the unit you pick.
  // ---------------------------------------------------------
  const RACK_ROT = [0, -Math.PI / 2, 0];
  function slotLabel(THREE, n) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#0b1222'; g.fillRect(0, 0, 256, 96);
    g.fillStyle = '#e9edf7'; g.font = '700 54px "JetBrains Mono", Menlo, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`SLOT ${n}`, 128, 50);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  function water(box, getState) {
    return mountView(box, 'assets/models/wrs_rack.glb', getState, (THREE, scene, camera, model) => {
      const own = [];
      scene.background = new THREE.Color(0x0a111e);
      const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(2, 4, 6); scene.add(key);
      scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x1a2333, 0.9));
      camera.fov = 30; camera.updateProjectionMatrix();

      const b = new THREE.Box3().setFromObject(model), size = b.getSize(new THREE.Vector3()), ctr = b.getCenter(new THREE.Vector3());
      const s = 4 / size.y;                                    // rack height = 4 units
      model.scale.setScalar(s); model.position.copy(ctr).multiplyScalar(-s);
      const rack = new THREE.Group(); rack.add(model); rack.rotation.set(...RACK_ROT); scene.add(rack);
      rack.updateMatrixWorld(true);
      const rb = new THREE.Box3().setFromObject(rack);
      const front = rb.max.z, W = rb.max.x - rb.min.x, H = rb.max.y - rb.min.y;

      // Four ORUs (procedural) in a 2×2 grid on the rack front
      const bw = W * 0.34, bh = H * 0.3;
      const oruGeo = new THREE.BoxGeometry(bw, bh, 0.5);
      const plateGeo = new THREE.PlaneGeometry(bw * 0.6, bw * 0.6 * 96 / 256);
      const handleGeo = new THREE.CylinderGeometry(0.025, 0.025, bh * 0.6, 10);
      const ledGeo = new THREE.SphereGeometry(0.03, 10, 8);
      const oruMat = new THREE.MeshStandardMaterial({ color: 0xc8cfdc, metalness: 0.35, roughness: 0.55 });
      const handleMat = new THREE.MeshStandardMaterial({ color: 0x8e98aa, metalness: 0.8, roughness: 0.3 });
      const led = { idle: new THREE.MeshBasicMaterial({ color: 0x2fbf71 }), ok: new THREE.MeshBasicMaterial({ color: 0x34d399 }),
        bad: new THREE.MeshBasicMaterial({ color: 0xff5c5c }), dim: new THREE.MeshBasicMaterial({ color: 0x1c3326 }) };
      const glowMat = new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0, side: THREE.BackSide, depthWrite: false });
      const glowGeo = new THREE.BoxGeometry(bw * 1.08, bh * 1.12, 0.52);
      own.push(oruGeo, plateGeo, handleGeo, ledGeo, oruMat, handleMat, glowMat, glowGeo, ...Object.values(led));
      const cy = rb.min.y + H * 0.5;
      const units = [0, 1, 2, 3].map((i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const g = new THREE.Group();
        g.position.set((col ? 1 : -1) * W * 0.22, cy + (row ? -1 : 1) * H * 0.2, front - 0.22);
        const body = new THREE.Mesh(oruGeo, oruMat);
        const tex = slotLabel(THREE, i + 1); const pm = new THREE.MeshBasicMaterial({ map: tex });
        const plate = new THREE.Mesh(plateGeo, pm); plate.position.set(-bw * 0.1, bh * 0.12, 0.251);
        const h1 = new THREE.Mesh(handleGeo, handleMat); h1.position.set(bw * 0.42, 0, 0.29);
        const leds = [0, 1, 2].map((k) => { const m = new THREE.Mesh(ledGeo, led.idle); m.position.set(-bw * 0.3 + k * 0.1, -bh * 0.28, 0.255); g.add(m); return m; });
        const glow = new THREE.Mesh(glowGeo, glowMat.clone());
        g.add(body, plate, h1, glow); rack.parent.add(g);
        own.push(tex, pm, glow.material);
        return { g, leds, glow, z0: g.position.z };
      });

      // three-quarter view from the right, close on the bays, so a sliding unit reads clearly
      const camBase = new THREE.Vector3(1.9, cy + 0.7, front + 5.2);
      camera.position.copy(camBase);
      camera.lookAt(0, cy, front - 0.3);
      const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
      return {
        own,
        frame(S, now) {
          const t = now / 1000;
          units.forEach((u, i) => {
            const picked = S.pick === i, isAnswer = S.answer === i;
            const k = picked ? ease((now - S.pickAt) / 450) : 0;
            u.g.position.z = u.z0 + k * 0.55;
            const st = picked ? (S.ok ? led.ok : led.bad) : (S.pick >= 0 && !S.ok && isAnswer ? led.ok : led.idle);
            u.leds.forEach((m, j) => { m.material = st === led.idle ? ((Math.floor(t * 2) + j + i) % 3 ? led.idle : led.dim) : st; });
            const showRight = S.pick >= 0 && isAnswer;
            const showWrong = picked && S.ok === false;
            u.glow.material.opacity = showRight ? 0.4 + 0.15 * Math.sin(t * 8) : showWrong ? 0.35 : 0;
            u.glow.material.color.set(showRight ? 0x34d399 : 0xff5c5c);
          });
          camera.position.set(camBase.x + 0.12 * Math.sin(t * 0.25), camBase.y + 0.05 * Math.sin(t * 0.31), camBase.z);
          camera.lookAt(0, cy, front - 0.3);
        },
      };
    });
  }

  // ---------------------------------------------------------
  // 5. Emergency drill — 3D station schematic (procedural modules, real ISS order).
  //    The module buttons are placed over the 3D modules; the alarmed module
  //    pulses in the alarm colour; a correct first response flies the
  //    equipment (PFE for fire, mask, or hatch) into the module.
  // ---------------------------------------------------------
  const STATION = {
    // id: [x, y, length, radius, kind]
    kibo: [-4.4, 0, 2.2, 0.62, 'lab'], node2: [-2.5, 0, 1.0, 0.6, 'node'], lab: [-0.9, 0, 1.9, 0.58, 'lab'],
    node1: [0.75, 0, 1.0, 0.6, 'node'], zarya: [2.5, 0, 2.0, 0.52, 'ros'], zvezda: [4.6, 0, 1.9, 0.5, 'ros'],
    columbus: [-2.5, 1.65, 1.5, 0.58, 'lab', 'y'], node3: [0.75, -1.6, 1.4, 0.58, 'node', 'y'],
  };
  const ALARM_COLOR = { fire: 0xfc3d21, tox: 0xffb020, dep: 0xb98cff };
  function drill(box, getState) {
    return mountView(box, 'assets/models/pfe.glb', getState, (THREE, scene, camera, model, host) => {
      const own = [];
      scene.background = new THREE.Color(0x060a14);
      const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 6, 6); scene.add(key);
      scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x101828, 0.9));
      camera.fov = 34; camera.updateProjectionMatrix();
      camera.position.set(0.2, 4.6, 8.4); camera.lookAt(0.1, -0.1, 0);

      const geoCache = {};
      const cyl = (len, r) => geoCache[`${len}_${r}`] || (geoCache[`${len}_${r}`] = new THREE.CylinderGeometry(r, r, len, 32, 1));
      const ringGeo = new THREE.TorusGeometry(1, 0.04, 8, 40);
      const truss = new THREE.Mesh(new THREE.BoxGeometry(11, 0.16, 0.16), new THREE.MeshStandardMaterial({ color: 0x5b6577, metalness: 0.6, roughness: 0.5 }));
      truss.position.set(-0.3, 0, -1.6); scene.add(truss);
      own.push(ringGeo, truss.geometry, truss.material);

      const mods = {};
      Object.entries(STATION).forEach(([id, [x, y, len, r, kind, axis]]) => {
        const mat = new THREE.MeshStandardMaterial({ color: kind === 'ros' ? 0xd9d2c0 : 0xe8ecf3, metalness: 0.25, roughness: 0.6, emissive: 0x000000 });
        const m = new THREE.Mesh(cyl(len, r), mat);
        if (axis === 'y') m.position.set(x, y, 0); else { m.rotation.z = Math.PI / 2; m.position.set(x, y, 0); }
        scene.add(m);
        const halo = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
        halo.scale.setScalar(r * 1.35); halo.position.copy(m.position); halo.rotation.x = -Math.PI / 2 + 0.5; scene.add(halo);
        own.push(mat, halo.material);
        mods[id] = { m, mat, halo, r };
      });
      Object.values(geoCache).forEach((g) => own.push(g));
      // Zvezda / Zarya solar wings, for recognisability
      const wingGeo = new THREE.BoxGeometry(0.9, 0.02, 2.4);
      const wingMat = new THREE.MeshStandardMaterial({ color: 0x1c3f8a, metalness: 0.4, roughness: 0.45, emissive: 0x081a40 });
      own.push(wingGeo, wingMat);
      [['zvezda', 1], ['zvezda', -1], ['zarya', 1], ['zarya', -1]].forEach(([id, sgn]) => {
        const w = new THREE.Mesh(wingGeo, wingMat); w.position.copy(mods[id].m.position).add(new THREE.Vector3(0, 0, sgn * 1.9)); scene.add(w);
      });

      // Equipment that flies into the module on a correct first response
      const b = new THREE.Box3().setFromObject(model), size = b.getSize(new THREE.Vector3()), ctr = b.getCenter(new THREE.Vector3());
      model.scale.setScalar(0.9 / size.y); model.position.copy(ctr).multiplyScalar(-0.9 / size.y);
      const pfe = new THREE.Group(); pfe.add(model);
      const maskMat = new THREE.MeshStandardMaterial({ color: 0xf2c94c, roughness: 0.5 });
      const maskGeo = new THREE.SphereGeometry(0.28, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      const mask = new THREE.Mesh(maskGeo, maskMat); mask.rotation.x = Math.PI / 2;
      const hatchMat = new THREE.MeshStandardMaterial({ color: 0xb9c2d0, metalness: 0.8, roughness: 0.3 });
      const hatchGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.06, 32);
      const hatch = new THREE.Mesh(hatchGeo, hatchMat); hatch.rotation.x = Math.PI / 2;
      own.push(maskMat, maskGeo, hatchMat, hatchGeo);
      const kit = { ext: pfe, mask, hatch };
      Object.values(kit).forEach((o) => { o.visible = false; scene.add(o); });
      const kitHome = new THREE.Vector3(0, -2.6, 3.2);

      // labels alternate above/below the chain so neighbours never overlap
      const LABEL_SIDE = { kibo: 1, node2: -1, lab: 1, node1: -1, zarya: 1, zvezda: -1, columbus: 0, node3: 0 };
      const place = () => {
        const w = host.clientWidth, h = host.clientHeight;
        const halfTan = Math.tan((camera.fov * Math.PI) / 360);
        const d = Math.max(7.2, 11.5 / (2 * halfTan * (w / h)));          // fit the whole station width
        camera.position.set(0.2, d * 0.5, d * 0.88); camera.lookAt(0.1, -0.1, 0);
        camera.updateMatrixWorld(true);
        Object.entries(mods).forEach(([id, md]) => {
          const btn = host.querySelector(`.mod[data-m="${id}"]`);
          if (!btn) return;
          const v = md.m.position.clone().project(camera);
          const px = ((1 - v.y) / 2) * h + LABEL_SIDE[id] * (md.r / (2 * halfTan * d)) * h * 1.25;
          btn.style.left = `${((v.x + 1) / 2) * w}px`; btn.style.top = `${px}px`;
        });
      };
      let lastW = 0, lastH = 0;
      const white = new THREE.Color(0x000000);
      return {
        own,
        frame(S, now) {
          if (host.clientWidth !== lastW || host.clientHeight !== lastH) { lastW = host.clientWidth; lastH = host.clientHeight; place(); }
          const t = now / 1000;
          Object.entries(mods).forEach(([id, md]) => {
            const st = S.mods[id] || {};
            let col = null, k = 0;
            if (st.hit) { col = 0x34d399; k = 0.6; }
            else if (st.miss) { col = 0xff5c5c; k = 0.7; }
            else if (S.alarm && S.alarm.mod === id && S.reveal) { col = ALARM_COLOR[S.alarm.type]; k = 0.35 + 0.35 * (Math.sin(t * 12) > 0 ? 1 : 0); }
            if (col) { md.mat.emissive.setHex(col); md.mat.emissiveIntensity = k; } else md.mat.emissive.copy(white);
            md.halo.material.opacity = col ? 0.25 + 0.5 * k : 0;
            if (col) md.halo.material.color.setHex(col);
            md.halo.scale.setScalar(md.r * (1.35 + (col ? 0.08 * Math.sin(t * 9) : 0)));
          });
          // equipment flight
          Object.entries(kit).forEach(([rid, o]) => {
            const L = S.last;
            const active = L && L.resp === rid && now - L.at < 1100;
            o.visible = !!active;
            if (!active) return;
            const p = Math.min(1, (now - L.at) / 650), e = 1 - Math.pow(1 - p, 3);
            const target = mods[L.mod].m.position;
            o.position.lerpVectors(kitHome, target, e);
            o.rotation.y = t * 3;
            o.scale.setScalar(p < 1 ? 1 : Math.max(0.01, 1 - (now - L.at - 650) / 450));
          });
          // the alarm itself: the whole view pulses, the module is only lit once found
          const pulse = S.alarm && !S.reveal ? (Math.sin(t * 12) > 0 ? 1 : 0) : 0;
          scene.background.setHex(pulse ? 0x2a0b10 : 0x060a14);
        },
      };
    });
  }

  // ---------------------------------------------------------
  // 6. Ultrasound — top-down (orthographic, so mouse ↔ probe is exact):
  //    gel-covered skin, the artery section moving under it, the probe model
  //    on the skin, and an inset echo image that sharpens as quality fills.
  // ---------------------------------------------------------
  function ultrasound(box, getState) {
    return mountView(box, 'assets/models/probe.glb', getState, (THREE, scene, _cam, model, host) => {
      const own = [];
      scene.background = new THREE.Color(0x120c0c);
      const cam = new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, 0.1, 50);
      cam.up.set(0, 0, -1); cam.position.set(0, 10, 0); cam.lookAt(0, 0, 0);
      const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-2, 6, 3); scene.add(key);
      scene.add(new THREE.HemisphereLight(0xfff1e6, 0x6a4a40, 1.6));

      // skin with gel sheen (procedural texture), slightly translucent so the artery shows through
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(128, 128, 20, 128, 128, 180); grd.addColorStop(0, '#f3cdb6'); grd.addColorStop(1, '#d19e86');
      g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${90 + Math.random() * 60},${50 + Math.random() * 30},40,${Math.random() * 0.08})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
      const skinTex = new THREE.CanvasTexture(c); skinTex.colorSpace = THREE.SRGBColorSpace;
      const skinMat = new THREE.MeshStandardMaterial({ map: skinTex, roughness: 0.35, metalness: 0, transparent: true, opacity: 0.72, emissive: 0x3a2018, emissiveIntensity: 0.6 });
      const skinGeo = new THREE.PlaneGeometry(1, 1);
      const skin = new THREE.Mesh(skinGeo, skinMat); skin.rotation.x = -Math.PI / 2; scene.add(skin);
      own.push(skinTex, skinMat, skinGeo);

      // artery: a long faint vessel plus the bright target section that moves
      const vesMat = new THREE.MeshStandardMaterial({ color: 0x8e1b23, roughness: 0.4, emissive: 0x3a0508 });
      const tubeGeo = new THREE.CylinderGeometry(0.035, 0.035, 2, 20);
      const tube = new THREE.Mesh(tubeGeo, vesMat); tube.rotation.x = Math.PI / 2; tube.position.y = -0.06; scene.add(tube);
      const secGeo = new THREE.SphereGeometry(0.07, 24, 16);
      const sec = new THREE.Mesh(secGeo, new THREE.MeshStandardMaterial({ color: 0xc8283a, emissive: 0x5a0a12, roughness: 0.3 }));
      sec.scale.set(1.4, 0.5, 0.8); sec.position.y = -0.05; scene.add(sec);
      own.push(vesMat, tubeGeo, secGeo, sec.material);

      // probe (Higgsfield model), tip on the skin, handle leaning to the lower right
      const b = new THREE.Box3().setFromObject(model), size = b.getSize(new THREE.Vector3()), ctr = b.getCenter(new THREE.Vector3());
      const s = 0.42 / Math.max(size.x, size.y, size.z);
      model.scale.setScalar(s); model.position.copy(ctr).multiplyScalar(-s);
      const tip = new THREE.Group(); tip.add(model);
      model.position.z -= 0.21;                                   // pivot at the scanning face (+Z end)
      tip.rotation.set(Math.PI / 2 - 0.9, 0, -0.5);               // face down, leaning back towards the viewer
      const probe = new THREE.Group(); probe.add(tip); scene.add(probe);
      // contact ring: colour = on target, arc = image quality
      const ringGeo = new THREE.RingGeometry(0.075, 0.09, 48);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.9, depthTest: false });
      const ring = new THREE.Mesh(ringGeo, ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; ring.renderOrder = 2; probe.add(ring);
      const shadowGeo = new THREE.CircleGeometry(0.12, 32);
      const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false });
      const shadow = new THREE.Mesh(shadowGeo, shadowMat); shadow.rotation.x = -Math.PI / 2; shadow.position.set(0.05, 0.005, 0.06); probe.add(shadow);
      own.push(ringGeo, ringMat, shadowGeo, shadowMat);

      // inset echo image (2D canvas): the vessel appears where it is relative to the probe
      const inset = document.createElement('canvas'); inset.className = 'us-inset'; inset.width = 220; inset.height = 150;
      host.appendChild(inset);
      const ig = inset.getContext('2d');
      const speck = document.createElement('canvas'); speck.width = 220; speck.height = 150;
      const sg = speck.getContext('2d');
      for (let i = 0; i < 5000; i++) { const v = 40 + Math.random() * 120; sg.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.5})`; sg.fillRect(Math.random() * 220, Math.random() * 150, 1.5, 1.5); }
      const drawInset = (S, onT) => {
        ig.clearRect(0, 0, 220, 150);
        ig.save();
        ig.beginPath(); ig.moveTo(110, 4); ig.lineTo(214, 146); ig.lineTo(6, 146); ig.closePath(); ig.clip();
        ig.fillStyle = '#050505'; ig.fillRect(0, 0, 220, 150);
        ig.globalAlpha = 0.35 + 0.65 * S.q; ig.drawImage(speck, 0, 0); ig.globalAlpha = 1;
        const asp = host.clientWidth / Math.max(1, host.clientHeight);
        const ix = 110 + (S.vx - S.x) * asp * 260, iy = 80 + (S.vy - S.y) * 200;
        ig.fillStyle = '#000'; ig.strokeStyle = `rgba(235,235,235,${0.3 + 0.6 * S.q})`; ig.lineWidth = 3;
        ig.beginPath(); ig.ellipse(ix, iy, 24, 14, 0, 0, Math.PI * 2); ig.fill(); ig.stroke();
        ig.restore();
        ig.strokeStyle = onT ? '#34d399' : 'rgba(255,255,255,.35)'; ig.lineWidth = 2; ig.strokeRect(1, 1, 218, 148);
      };

      let lastW = 0, lastH = 0;
      return {
        own, camera: cam,
        frame(S, now) {
          const w = host.clientWidth, h = host.clientHeight;
          if (w !== lastW || h !== lastH) {
            lastW = w; lastH = h;
            const a = w / Math.max(1, h);
            cam.left = -a / 2; cam.right = a / 2; cam.top = 0.5; cam.bottom = -0.5; cam.updateProjectionMatrix();
            skin.scale.set(a, 1, 1);
          }
          const a = w / Math.max(1, h), t = now / 1000;
          const X = (v) => (v - 0.5) * a, Z = (v) => v - 0.5;
          sec.position.x = X(S.vx); sec.position.z = Z(S.vy);
          const beat = 1 + 0.12 * Math.max(0, Math.sin(t * 7.5));
          sec.scale.set(1.4 * beat, 0.5, 0.8 * beat);
          tube.position.x = sec.position.x; tube.position.z = sec.position.z;
          tube.rotation.z = 0.25 * Math.sin(t * 0.3);
          probe.position.set(X(S.x), 0, Z(S.y));
          const onT = !!S.onT;
          ringMat.color.setHex(onT ? 0x34d399 : 0xffd54a);
          ring.scale.setScalar(1 + 0.6 * S.q);
          drawInset(S, onT);
        },
      };
    });
  }

  // ---------------------------------------------------------
  // 7. Microgravity experiment — the glovebox with the 4×3 sample tray in front.
  //    Codes stay in the DOM tray (that is what must be memorised); the 3D tray
  //    shows the vials uncapped while studying, capped during recall, and lifts
  //    out the vial you picked (green = right, red = wrong).
  // ---------------------------------------------------------
  const LIQUID = [0x3d7bff, 0x34d399, 0xffb020, 0xe0457b, 0x9b6bff, 0x2ec5d3];
  function glovebox(box, getState) {
    return mountView(box, 'assets/models/glovebox.glb', getState, (THREE, scene, camera, model) => {
      const own = [];
      scene.background = new THREE.Color(0x0a111e);
      const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2, 6, 5); scene.add(key);
      scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x1a2333, 1.0));
      camera.fov = 32; camera.updateProjectionMatrix();

      const b = new THREE.Box3().setFromObject(model), size = b.getSize(new THREE.Vector3()), ctr = b.getCenter(new THREE.Vector3());
      const s = 4.2 / Math.max(size.x, size.y, size.z);
      model.scale.setScalar(s); model.position.copy(ctr).multiplyScalar(-s);
      const gb = new THREE.Group(); gb.add(model); gb.rotation.set(...GLOVEBOX_ROT); scene.add(gb);
      gb.updateMatrixWorld(true);
      const wb = new THREE.Box3().setFromObject(gb);

      // sample tray on the floor of the (open) work chamber
      const tray = new THREE.Group();
      tray.position.set(0, wb.min.y + (wb.max.y - wb.min.y) * 0.27, 0);
      tray.scale.setScalar(0.85);
      scene.add(tray);
      const plateGeo = new THREE.BoxGeometry(2.3, 0.08, 1.55);
      const plateMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b6, metalness: 0.6, roughness: 0.4 });
      tray.add(new THREE.Mesh(plateGeo, plateMat));
      const glassGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.42, 20, 1, true);
      const glassMat = new THREE.MeshStandardMaterial({ color: 0xdfe9ff, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
      const liqGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.26, 16);
      const capGeo = new THREE.CylinderGeometry(0.135, 0.135, 0.09, 20);
      const capMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.5 });
      const liqMats = LIQUID.map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.25, roughness: 0.3 }));
      const ringGeo = new THREE.TorusGeometry(0.17, 0.02, 8, 28);
      const ringMats = { right: new THREE.MeshBasicMaterial({ color: 0x34d399 }), wrong: new THREE.MeshBasicMaterial({ color: 0xff5c5c }) };
      own.push(plateGeo, plateMat, glassGeo, glassMat, liqGeo, capGeo, capMat, ringGeo, ...liqMats, ...Object.values(ringMats));
      const vials = Array.from({ length: 12 }, (_, i) => {
        const col = i % 4, row = Math.floor(i / 4);
        const g = new THREE.Group(); g.position.set(-0.81 + col * 0.54, 0.25, -0.5 + row * 0.5);
        const glass = new THREE.Mesh(glassGeo, glassMat);
        const liq = new THREE.Mesh(liqGeo, liqMats[0]); liq.position.y = -0.07;
        const cap = new THREE.Mesh(capGeo, capMat);
        const ring = new THREE.Mesh(ringGeo, ringMats.right); ring.rotation.x = Math.PI / 2; ring.position.y = -0.2; ring.visible = false;
        g.add(liq, glass, cap, ring); tray.add(g);
        return { g, liq, cap, ring, lift: 0, capY: 0.5 };
      });

      const camBase = new THREE.Vector3(0, tray.position.y + 2.5, wb.max.z + 2.4);
      camera.position.copy(camBase);
      camera.lookAt(0, tray.position.y + 0.2, 0);
      let lastCodes = null, last = performance.now();
      return {
        own,
        frame(S, now) {
          const dt = Math.min(0.1, (now - last) / 1000); last = now;
          if (S.codes !== lastCodes && S.codes && S.codes.length) {          // new tray: colour the samples
            lastCodes = S.codes;
            vials.forEach((v, i) => { const c = S.codes[i] || ''; v.liq.material = liqMats[(c.charCodeAt(0) + c.charCodeAt(1)) % liqMats.length]; });
          }
          vials.forEach((v, i) => {
            const st = S.slots[i] || {};
            const capped = S.phase === 'recall' && !st.open;
            const capTarget = capped ? 0.25 : 0.62;                          // cap seated vs floating above (microgravity)
            v.capY += (capTarget - v.capY) * Math.min(1, dt * 10);
            v.cap.position.y = v.capY;
            const liftTarget = st.right || st.wrong ? 0.35 : 0;
            v.lift += (liftTarget - v.lift) * Math.min(1, dt * 9);
            v.g.position.y = 0.25 + v.lift;
            v.ring.visible = !!(st.right || st.wrong);
            if (v.ring.visible) v.ring.material = st.right ? ringMats.right : ringMats.wrong;
            v.liq.visible = S.phase !== 'recall' || st.open;                // capped vials look opaque
          });
          camera.position.x = camBase.x + 0.15 * Math.sin(now / 4000);
          camera.lookAt(0, tray.position.y + 0.2, 0);
        },
      };
    });
  }
  const GLOVEBOX_ROT = [0, -Math.PI / 2, 0];

  window.Scene3D = { supported: supportsWebGL, cygnus, docking, eva, water, drill, ultrasound, glovebox };
})();
