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
    renderer.shadowMap.enabled = true;                 // only scenes with castShadow lights pay for it
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
  // Procedural textures shared by the detailed scenes
  // ---------------------------------------------------------
  function canvasTex(THREE, w, h, draw, srgb = true) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
  const noise = (g, w, h, n, rgb, a) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${rgb},${Math.random() * a})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); } };
  // quilted MLI / MMOD shield panels of a pressurised module (u = around, v = along)
  function moduleSkin(THREE, kind) {
    return canvasTex(THREE, 512, 256, (g, w, h) => {
      const base = kind === 'ros' ? '#e6e3da' : kind === 'node' ? '#ece9e1' : '#efe9dc';
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      const cols = kind === 'ros' ? 10 : 12, rows = kind === 'node' ? 3 : 5;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const x = (i * w) / cols, y = (j * h) / rows, pw = w / cols, ph = h / rows;
        const shade = 225 + Math.floor(Math.random() * 22);
        g.fillStyle = `rgb(${shade},${shade - 3},${shade - 12})`;
        g.fillRect(x + 2, y + 2, pw - 4, ph - 4);
        g.strokeStyle = 'rgba(120,112,98,.55)'; g.lineWidth = 2; g.strokeRect(x + 2, y + 2, pw - 4, ph - 4);
        // quilting stitches
        g.strokeStyle = 'rgba(150,140,120,.25)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x + pw / 2, y + 4); g.lineTo(x + pw / 2, y + ph - 4); g.stroke();
      }
      if (kind === 'ros') { g.fillStyle = 'rgba(60,66,78,.75)'; g.fillRect(0, h * 0.46, w, h * 0.08); }
      // yellow handrails
      g.fillStyle = '#d8a227';
      [0.12, 0.62].forEach((u) => g.fillRect(u * w, 10, 6, h - 20));
      noise(g, w, h, 3000, '90,80,60', 0.12);
    });
  }
  function solarTex(THREE) {
    return canvasTex(THREE, 128, 512, (g, w, h) => {
      g.fillStyle = '#5a3b12'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
        const v = 80 + Math.random() * 40;
        g.fillStyle = `rgb(${v + 70},${v + 30},${v - 50})`; g.fillRect(x + 1, y + 1, 14, 14);
      }
      g.fillStyle = 'rgba(30,20,10,.8)'; for (let y = 0; y < h; y += 128) g.fillRect(0, y, w, 4);
    });
  }
  function latticeTex(THREE) {
    return canvasTex(THREE, 512, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#c7ccd6'; g.lineWidth = 5;
      g.strokeRect(2, 2, w - 4, h - 4);
      for (let x = 0; x < w; x += 64) { g.beginPath(); g.moveTo(x, 2); g.lineTo(x + 64, h - 2); g.moveTo(x + 64, 2); g.lineTo(x, h - 2); g.stroke(); g.fillStyle = '#c7ccd6'; g.fillRect(x, 0, 5, h); }
    });
  }

  // ---------------------------------------------------------
  // 5. Emergency drill — detailed ISS in orbit (procedural, real module order).
  //    Every alarm flies the camera to a new viewpoint. Module and hatch
  //    buttons are DOM overlays kept on their 3D positions.
  // ---------------------------------------------------------
  const STATION = {
    // id: [x, y, length, radius, kind, axis]
    kibo: [-4.4, 0, 2.2, 0.62, 'lab'], node2: [-2.5, 0, 1.0, 0.6, 'node'], lab: [-0.9, 0, 1.9, 0.58, 'lab'],
    node1: [0.75, 0, 1.0, 0.6, 'node'], zarya: [2.5, 0, 2.0, 0.52, 'ros'], zvezda: [4.6, 0, 1.9, 0.5, 'ros'],
    columbus: [-2.5, 1.65, 1.5, 0.58, 'lab', 'y'], node3: [0.75, -1.6, 1.4, 0.58, 'node', 'y'],
  };
  const HATCH_EDGES = [['kibo', 'node2'], ['columbus', 'node2'], ['node2', 'lab'], ['lab', 'node1'], ['node1', 'node3'], ['node1', 'zarya'], ['zarya', 'zvezda']];
  const ALARM_COLOR = { fire: 0xfc3d21, tox: 0xffb020, dep: 0xb98cff };
  function drill(box, getState) {
    return mountView(box, 'assets/models/pfe.glb', getState, (THREE, scene, camera, model, host) => {
      const bg = orbitBackdrop(THREE, scene);
      const own = [...bg.own];
      scene.background = new THREE.Color(0x02040a);
      camera.fov = 34; camera.near = 0.1; camera.far = 600; camera.updateProjectionMatrix();
      const center = new THREE.Vector3(0.1, 0, 0);
      const station = new THREE.Group(); scene.add(station);

      const skins = { lab: moduleSkin(THREE, 'lab'), node: moduleSkin(THREE, 'node'), ros: moduleSkin(THREE, 'ros') };
      own.push(...Object.values(skins));
      const geoCache = {};
      const cyl = (len, r) => geoCache[`${len}_${r}`] || (geoCache[`${len}_${r}`] = new THREE.CylinderGeometry(r, r, len, 40, 1, false));
      const endRingGeo = new THREE.TorusGeometry(1, 0.06, 10, 40);
      const cbmGeo = new THREE.CylinderGeometry(1, 1, 0.08, 32);
      const darkMetal = new THREE.MeshStandardMaterial({ color: 0x8a919e, metalness: 0.8, roughness: 0.35 });
      const cbmMat = new THREE.MeshStandardMaterial({ color: 0x5d6472, metalness: 0.7, roughness: 0.4 });
      const haloGeo = new THREE.TorusGeometry(1, 0.04, 8, 48);
      own.push(endRingGeo, cbmGeo, darkMetal, cbmMat, haloGeo);

      const mods = {};
      Object.entries(STATION).forEach(([id, [x, y, len, r, kind, axis]]) => {
        const g = new THREE.Group(); g.position.set(x, y, 0);
        if (axis !== 'y') g.rotation.z = Math.PI / 2;
        const mat = new THREE.MeshStandardMaterial({ map: skins[kind], roughness: 0.72, metalness: 0.08 });
        const body = new THREE.Mesh(cyl(len, r), mat); g.add(body);
        // end rings + berthing mechanisms
        [-1, 1].forEach((s) => {
          const ring = new THREE.Mesh(endRingGeo, darkMetal); ring.scale.set(r * 0.98, r * 0.98, r); ring.rotation.x = Math.PI / 2; ring.position.y = (s * len) / 2; g.add(ring);
          const cbm = new THREE.Mesh(cbmGeo, cbmMat); cbm.scale.set(r * 0.62, 1, r * 0.62); cbm.position.y = (s * (len / 2 + 0.03)); g.add(cbm);
        });
        // mid-body stiffener rings on long modules
        if (len > 1.4) [-0.25, 0.25].forEach((f) => { const ring = new THREE.Mesh(endRingGeo, darkMetal); ring.scale.set(r * 1.005, r * 1.005, r * 0.5); ring.rotation.x = Math.PI / 2; ring.position.y = f * len; g.add(ring); });
        // nodes: radial berthing ports
        if (kind === 'node') [0, Math.PI / 2, Math.PI, -Math.PI / 2].forEach((a) => {
          const port = new THREE.Mesh(cbmGeo, cbmMat); port.scale.set(r * 0.42, 1.6, r * 0.42);
          port.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); port.rotation.z = Math.PI / 2; port.rotation.y = -a; g.add(port);
        });
        station.add(g);
        const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
        halo.scale.setScalar(r * 1.4); halo.position.copy(g.position); halo.rotation.x = -Math.PI / 2 + 0.5; station.add(halo);
        own.push(mat, halo.material);
        mods[id] = { m: g, mat, halo, r, len, axis: axis === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0) };
      });
      Object.values(geoCache).forEach((gg) => own.push(gg));
      // Kibo exposed facility, Columbus external platform
      const efGeo = new THREE.BoxGeometry(1.2, 0.12, 0.9);
      const ef = new THREE.Mesh(efGeo, darkMetal); ef.position.set(-6.1, 0, 0); station.add(ef);
      own.push(efGeo);
      // integrated truss (lattice) with solar array wings and radiators
      const lat = latticeTex(THREE); lat.wrapS = THREE.RepeatWrapping; lat.repeat.set(6, 1);
      const latMat = new THREE.MeshStandardMaterial({ map: lat, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4, color: 0xffffff });
      const trussGeo = new THREE.BoxGeometry(12.5, 0.42, 0.42);
      const truss = new THREE.Mesh(trussGeo, latMat); truss.position.set(-0.3, 0, -1.7); station.add(truss);
      const strutGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.2, 8);
      const strut = new THREE.Mesh(strutGeo, darkMetal); strut.rotation.x = Math.PI / 2; strut.position.set(-0.9, 0, -1.05); station.add(strut);
      const sTex = solarTex(THREE);
      const solarMat = new THREE.MeshStandardMaterial({ map: sTex, metalness: 0.35, roughness: 0.4, side: THREE.DoubleSide, emissive: 0x1a0d00, emissiveIntensity: 0.4 });
      const wingGeo = new THREE.PlaneGeometry(0.9, 4.6);
      const mastGeo = new THREE.CylinderGeometry(0.03, 0.03, 9.6, 6);
      own.push(lat, latMat, trussGeo, strutGeo, sTex, solarMat, wingGeo, mastGeo);
      [-6.3, -5.2, 4.6, 5.7].forEach((x) => {
        [1, -1].forEach((s) => { const w = new THREE.Mesh(wingGeo, solarMat); w.position.set(x, s * 2.55, -1.7); station.add(w); });
        const mast = new THREE.Mesh(mastGeo, darkMetal); mast.position.set(x, 0, -1.69); station.add(mast);
      });
      const radMat = new THREE.MeshStandardMaterial({ color: 0xf4f6f9, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide });
      const radGeo = new THREE.PlaneGeometry(0.7, 2.2);
      own.push(radMat, radGeo);
      [-1.6, 1.0].forEach((x) => { const rp = new THREE.Mesh(radGeo, radMat); rp.rotation.x = Math.PI / 2; rp.position.set(x, -0.25, -2.9); station.add(rp); });
      // Russian segment wings
      const rosWingGeo = new THREE.PlaneGeometry(0.75, 2.4);
      const rosSolar = new THREE.MeshStandardMaterial({ color: 0x1c3f8a, metalness: 0.4, roughness: 0.4, emissive: 0x081a40, side: THREE.DoubleSide });
      own.push(rosWingGeo, rosSolar);
      [['zvezda', 1], ['zvezda', -1], ['zarya', 1], ['zarya', -1]].forEach(([id, sgn]) => {
        const w = new THREE.Mesh(rosWingGeo, rosSolar); w.rotation.x = Math.PI / 2; w.position.copy(mods[id].m.position).add(new THREE.Vector3(0, 0, sgn * 1.75)); station.add(w);
      });

      // Hatch rings at the junction of each pair of modules
      const hatchGeo = new THREE.TorusGeometry(0.38, 0.055, 12, 48);
      const hatchDiscGeo = new THREE.CircleGeometry(0.36, 36);
      own.push(hatchGeo, hatchDiscGeo);
      const ext = (md, dir) => (Math.abs(md.axis.dot(dir)) > 0.9 ? md.len / 2 : md.r);
      const hatches = HATCH_EDGES.map(([a, b]) => {
        const A = mods[a], B = mods[b];
        const dir = B.m.position.clone().sub(A.m.position).normalize();
        const pa = A.m.position.clone().addScaledVector(dir, ext(A, dir)), pb = B.m.position.clone().addScaledVector(dir, -ext(B, dir));
        const pos = pa.add(pb).multiplyScalar(0.5);
        const mat = new THREE.MeshBasicMaterial({ color: 0x8090a8, transparent: true, opacity: 0.0 });
        const ring = new THREE.Mesh(hatchGeo, mat);
        ring.position.copy(pos); ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
        const discMat = new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
        const disc = new THREE.Mesh(hatchDiscGeo, discMat); ring.add(disc);
        station.add(ring); own.push(mat, discMat);
        return { ring, mat, disc, pos };
      });

      // "You are here": a blue beacon
      const youMat = new THREE.MeshBasicMaterial({ color: 0x6aa8ff });
      const youGeo = new THREE.ConeGeometry(0.16, 0.42, 16);
      const you = new THREE.Mesh(youGeo, youMat); you.visible = false; scene.add(you);
      own.push(youMat, youGeo);

      // Equipment that flies to the module on a correct first response
      const b = new THREE.Box3().setFromObject(model), size = b.getSize(new THREE.Vector3()), ctr = b.getCenter(new THREE.Vector3());
      model.scale.setScalar(0.9 / size.y); model.position.copy(ctr).multiplyScalar(-0.9 / size.y);
      const pfe = new THREE.Group(); pfe.add(model);
      const maskMat = new THREE.MeshStandardMaterial({ color: 0xf2c94c, roughness: 0.5 });
      const maskGeo = new THREE.SphereGeometry(0.28, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      const mask = new THREE.Mesh(maskGeo, maskMat); mask.rotation.x = Math.PI / 2;
      const plugMat = new THREE.MeshStandardMaterial({ color: 0xb9c2d0, metalness: 0.8, roughness: 0.3 });
      const plugGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.06, 32);
      const plug = new THREE.Mesh(plugGeo, plugMat); plug.rotation.x = Math.PI / 2;
      own.push(maskMat, maskGeo, plugMat, plugGeo);
      const kit = { ext: pfe, mask, hatch: plug };
      Object.values(kit).forEach((o) => { o.visible = false; scene.add(o); });

      const ease = (x) => (x >= 1 ? 1 : 1 - Math.pow(1 - x, 3));
      const camUp = new THREE.Vector3(), tmp = new THREE.Vector3(), black = new THREE.Color(0x000000), down = new THREE.Vector3(0, -1, 0);
      const LABEL_SIDE = { kibo: 1, node2: -1, lab: 1, node1: -1, zarya: 1, zvezda: -1, columbus: 0, node3: 0 };
      const modBtns = {}, hatchBtns = [];
      host.querySelectorAll('.mod').forEach((el) => { modBtns[el.dataset.m] = el; });
      host.querySelectorAll('.hatch').forEach((el) => { hatchBtns[+el.dataset.h] = el; });
      const setCam = (v, w, h) => {
        const halfTan = Math.tan((camera.fov * Math.PI) / 360);
        const d = Math.max(8.2, 13.2 / (2 * halfTan * (w / h))) * v.dist;
        camera.position.set(center.x + d * Math.sin(v.yaw) * Math.cos(v.pitch), center.y + d * Math.sin(v.pitch), center.z + d * Math.cos(v.yaw) * Math.cos(v.pitch));
        camera.up.set(0, 1, 0); camera.lookAt(center); camera.updateMatrixWorld(true);
      };
      const toPx = (p, w, h) => { tmp.copy(p).project(camera); return [((tmp.x + 1) / 2) * w, ((1 - tmp.y) / 2) * h, tmp.z]; };
      return {
        own,
        frame(S, now) {
          const w = host.clientWidth, h = host.clientHeight, t = now / 1000;
          const k = S.viewFrom ? ease((now - S.viewAt) / 900) : 1;
          const vf = S.viewFrom || S.view, vt = S.view;
          setCam({ yaw: vf.yaw + (vt.yaw - vf.yaw) * k, pitch: vf.pitch + (vt.pitch - vf.pitch) * k, dist: vf.dist + (vt.dist - vf.dist) * k }, w, h);
          camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
          // labels: project, then push overlapping ones apart vertically (a few relaxation passes)
          const lab = [];
          Object.entries(mods).forEach(([id, md]) => {
            const el = modBtns[id]; if (!el) return;
            tmp.copy(md.m.position).addScaledVector(camUp, LABEL_SIDE[id] * md.r * 1.4);
            const [x, y] = toPx(tmp, w, h);
            if (!el._w) { el._w = el.offsetWidth || 90; el._h = el.offsetHeight || 22; }
            lab.push({ el, x, y });
          });
          for (let pass = 0; pass < 4; pass++) for (let i = 0; i < lab.length; i++) for (let j = i + 1; j < lab.length; j++) {
            const A = lab[i], B = lab[j];
            const ox = (A.el._w + B.el._w) / 2 + 4 - Math.abs(A.x - B.x), oy = (A.el._h + B.el._h) / 2 + 3 - Math.abs(A.y - B.y);
            if (ox > 0 && oy > 0) { const s = A.y <= B.y ? -1 : 1; A.y += (s * oy) / 2; B.y -= (s * oy) / 2; }
          }
          lab.forEach((L) => { L.el.style.left = `${L.x}px`; L.el.style.top = `${Math.max(12, Math.min(h - 12, L.y))}px`; });
          hatches.forEach((hc, i) => {
            const el = hatchBtns[i]; if (!el) return;
            const [x, y] = toPx(hc.pos, w, h);
            el.style.left = `${x}px`; el.style.top = `${y}px`;
            const st = (S.hatches && S.hatches[i]) || {};
            const col = st.shut ? 0x34d399 : st.miss ? 0xff5c5c : 0xffffff;
            hc.mat.color.setHex(col);
            hc.mat.opacity = st.live || st.miss ? 0.7 + 0.3 * Math.sin(t * 8) : st.shut ? 1 : 0;
            hc.ring.scale.setScalar(st.live ? 1 + 0.08 * Math.sin(t * 8) : 1);
            hc.disc.material.opacity = st.shut ? 0.55 : 0;
            hc.disc.material.color.setHex(col);
          });
          Object.entries(mods).forEach(([id, md]) => {
            const st = (S.mods && S.mods[id]) || {};
            let col = null, kk = 0;
            if (st.miss) { col = 0xff5c5c; kk = 0.6; }
            else if (S.alarm && S.alarm.mod === id && S.reveal) { col = ALARM_COLOR[S.alarm.type]; kk = 0.3 + 0.3 * (Math.sin(t * 12) > 0 ? 1 : 0); }
            if (col) { md.mat.emissive.setHex(col); md.mat.emissiveIntensity = kk; } else md.mat.emissive.copy(black);
            md.halo.material.opacity = col ? 0.25 + 0.5 * kk : 0;
            if (col) md.halo.material.color.setHex(col);
          });
          you.visible = !!S.you;
          if (S.you) {
            const md = mods[S.you];
            you.position.copy(md.m.position).addScaledVector(camUp, md.r + 0.5 + 0.06 * Math.sin(t * 4));
            tmp.copy(camUp).negate(); you.quaternion.setFromUnitVectors(down, tmp);
          }
          Object.entries(kit).forEach(([rid, o]) => {
            const L = S.last;
            const active = L && L.resp === rid && now - L.at < 1100;
            o.visible = !!active;
            if (!active) return;
            const p = Math.min(1, (now - L.at) / 650), e = 1 - Math.pow(1 - p, 3);
            tmp.copy(camera.position).lerp(center, 0.35);
            o.position.lerpVectors(tmp, mods[L.mod].m.position, e);
            o.rotation.y = t * 3;
            o.scale.setScalar(p < 1 ? 1 : Math.max(0.01, 1 - (now - L.at - 650) / 450));
          });
          const pulse = S.alarm && S.step === 'module' ? (Math.sin(t * 12) > 0 ? 1 : 0) : 0;
          scene.background.setHex(pulse ? 0x24070c : 0x02040a);
          bg.stars.rotation.y = t * 0.003;
        },
      };
    });
  }

  // ---------------------------------------------------------
  // 6. Ultrasound — top-down orthographic (mouse ↔ probe exact) over a curved,
  //    gel-coated neck. Artery + compressible vein under the skin, the marked
  //    site, the probe with its footprint, and a B-mode echo image.
  // ---------------------------------------------------------
  function ultrasound(box, getState) {
    return mountView(box, 'assets/models/probe.glb', getState, (THREE, scene, _cam, model, host) => {
      const own = [];
      scene.background = new THREE.Color(0x0d0a0a);
      const cam = new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, 0.1, 50);
      cam.up.set(0, 0, -1); cam.position.set(0, 10, 0); cam.lookAt(0, 0, 0);
      const key = new THREE.DirectionalLight(0xfff4ea, 2.4); key.position.set(-1.5, 5, -2); scene.add(key);
      const rim = new THREE.DirectionalLight(0xcfe0ff, 0.8); rim.position.set(2, 3, 3); scene.add(rim);
      scene.add(new THREE.HemisphereLight(0xfff1e6, 0x8a5a48, 1.0));

      const CURV = 0.16;                                          // neck curvature across the screen
      const hAt = (xn) => -CURV * (2 * xn) * (2 * xn);              // surface height at normalised x ∈ [-0.5, 0.5]
      const skinTex = canvasTex(THREE, 512, 512, (g, w, h) => {
        const grd = g.createLinearGradient(0, 0, w, 0);
        grd.addColorStop(0, '#b4705a'); grd.addColorStop(0.5, '#e9b394'); grd.addColorStop(1, '#b4705a');
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
        noise(g, w, h, 9000, '120,70,55', 0.07);
        for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(90,50,40,${Math.random() * 0.12})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 0.8, 0, 7); g.fill(); }  // pores
        g.strokeStyle = 'rgba(150,100,85,.18)'; g.lineWidth = 1.5;                                  // skin creases
        for (let i = 0; i < 7; i++) { const y = 60 + i * 65 + Math.random() * 20; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 12, w * 0.7, y - 12, w, y + 4); g.stroke(); }
      });
      const skinMat = new THREE.MeshPhysicalMaterial({ map: skinTex, roughness: 0.6, clearcoat: 0.7, clearcoatRoughness: 0.25, transparent: true, opacity: 0.9 });
      const skinGeo = new THREE.PlaneGeometry(1, 1, 64, 4);
      const pos = skinGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, hAt(pos.getX(i)));
      skinGeo.computeVertexNormals();
      const skin = new THREE.Mesh(skinGeo, skinMat); skin.rotation.x = -Math.PI / 2; scene.add(skin);
      own.push(skinTex, skinMat, skinGeo);

      const vessels = new THREE.Group(); scene.add(vessels);
      const artMat = new THREE.MeshStandardMaterial({ color: 0xb02633, emissive: 0x3a0610, roughness: 0.35 });
      const veinMat = new THREE.MeshStandardMaterial({ color: 0x3a5cb8, emissive: 0x0a1844, roughness: 0.35 });
      own.push(artMat, veinMat);
      let art = null, vein = null, builtFor = null, builtAsp = 0;
      const build = (ph, a) => {
        [art, vein].forEach((m) => { if (m) { vessels.remove(m); m.geometry.dispose(); } });
        const pts = (dx, depth) => Array.from({ length: 26 }, (_, i) => {
          const y = -0.05 + i * 1.1 / 25, xn = 0.17 * Math.sin(2.3 * y + ph) + dx;
          return new THREE.Vector3(xn * a, hAt(xn) - depth, y - 0.5);
        });
        art = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts(0, 0.07)), 90, 0.03, 16), artMat);
        vein = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts(0.065, 0.05)), 90, 0.038, 16), veinMat);
        vessels.add(art, vein);
      };
      // marked site
      const siteGeo = new THREE.RingGeometry(0.05, 0.058, 48);
      const siteMat = new THREE.MeshBasicMaterial({ color: 0x5fe3ff, transparent: true, opacity: 0.9, depthTest: false });
      const site = new THREE.Mesh(siteGeo, siteMat); site.rotation.x = -Math.PI / 2; site.renderOrder = 3; scene.add(site);
      const crossGeo = new THREE.PlaneGeometry(0.014, 0.14);
      const cross1 = new THREE.Mesh(crossGeo, siteMat), cross2 = new THREE.Mesh(crossGeo, siteMat);
      cross1.rotation.x = -Math.PI / 2; cross2.rotation.set(-Math.PI / 2, 0, Math.PI / 2); cross1.renderOrder = cross2.renderOrder = 3;
      cross1.material = cross2.material = new THREE.MeshBasicMaterial({ color: 0x5fe3ff, transparent: true, opacity: 0.35, depthTest: false });
      scene.add(cross1, cross2);
      own.push(siteGeo, siteMat, crossGeo, cross1.material);

      // probe with gel blob, footprint and a soft contact shadow
      const b = new THREE.Box3().setFromObject(model), size = b.getSize(new THREE.Vector3()), ctr = b.getCenter(new THREE.Vector3());
      const s = 0.4 / Math.max(size.x, size.y, size.z);
      model.scale.setScalar(s); model.position.copy(ctr).multiplyScalar(-s);
      model.position.z -= 0.2;
      const tip = new THREE.Group(); tip.add(model); tip.rotation.set(Math.PI / 2 - 0.55, 0, 0);
      const probe = new THREE.Group(); probe.add(tip); scene.add(probe);
      const shadowTex = canvasTex(THREE, 128, 128, (g, w, h) => { const r = g.createRadialGradient(64, 64, 4, 64, 64, 62); r.addColorStop(0, 'rgba(0,0,0,.55)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); }, false);
      const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, depthTest: false });
      const shadowGeo = new THREE.PlaneGeometry(0.34, 0.26);
      const shadow = new THREE.Mesh(shadowGeo, shadowMat); shadow.rotation.x = -Math.PI / 2; shadow.position.set(0.05, 0.02, 0.07); shadow.renderOrder = 2; probe.add(shadow);
      const gelMat = new THREE.MeshPhysicalMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.35, roughness: 0.05, clearcoat: 1, depthWrite: false });
      const gelGeo = new THREE.SphereGeometry(0.11, 24, 12);
      const gel = new THREE.Mesh(gelGeo, gelMat); gel.visible = false;
      const footGeo = new THREE.PlaneGeometry(0.17, 0.032);
      const footMat = new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.9, depthTest: false });
      const foot = new THREE.Mesh(footGeo, footMat); foot.rotation.x = -Math.PI / 2; foot.position.y = 0.03; foot.renderOrder = 4; probe.add(foot);
      own.push(shadowTex, shadowMat, shadowGeo, gelMat, gelGeo, footGeo, footMat);

      // B-mode echo image (2D canvas): sector, tissue layers, vessels cut by the probe plane
      const inset = document.createElement('canvas'); inset.className = 'us-inset'; inset.width = 260; inset.height = 190;
      host.appendChild(inset);
      const ig = inset.getContext('2d');
      const W = 260, H = 190, AX = W / 2, AY = 14;
      const tissue = document.createElement('canvas'); tissue.width = W; tissue.height = H;
      (() => {
        const tg = tissue.getContext('2d');
        tg.fillStyle = '#050505'; tg.fillRect(0, 0, W, H);
        for (let y = 0; y < H; y++) {
          const layer = y < 28 ? 0.75 : y < 40 ? 0.35 : y < 120 ? 0.42 : 0.3;                      // skin, fat, muscle, deep
          for (let x = 0; x < W; x += 2) { const v = Math.random() * 180 * layer; tg.fillStyle = `rgba(${v},${v},${v},${0.5 + Math.random() * 0.5})`; tg.fillRect(x, y, 2, 1); }
        }
        tg.fillStyle = 'rgba(230,230,230,.35)'; tg.fillRect(0, 38, W, 2); tg.fillRect(0, 124, W, 2);   // fascia lines
      })();
      const clamp01 = (v) => Math.max(0, Math.min(1, v));
      const drawEcho = (S, asp, t) => {
        ig.clearRect(0, 0, W, H);
        ig.fillStyle = '#000'; ig.fillRect(0, 0, W, H);
        ig.save();
        ig.beginPath(); ig.moveTo(AX - 56, AY); ig.lineTo(AX + 56, AY); ig.lineTo(W - 8, H - 26); ig.quadraticCurveTo(AX, H + 6, 8, H - 26); ig.closePath(); ig.clip();
        const contact = clamp01((S.p - 0.15) / 0.2);
        ig.globalAlpha = 0.1 + 0.9 * contact * (0.5 + 0.5 * S.q); ig.drawImage(tissue, 0, 0); ig.globalAlpha = 1;
        const ux = Math.cos(S.ang), uy = Math.sin(S.ang), nx = -uy, ny = ux;
        const cross = Math.abs(Math.sin(S.ang - S.vdir));
        const vessel = (vx, vy, depth, rr, squash, edge) => {
          const dx = (vx - S.x) * asp, dy = vy - S.y;
          const lat = dx * ux + dy * uy, elev = dx * nx + dy * ny;
          const vis = clamp01(1 - Math.abs(elev) / 0.06) * contact;
          if (vis <= 0.02) return;
          const ex = AX + lat * 950, ey = depth;
          const rx = Math.min(120, rr / Math.max(0.22, cross)), ry = Math.max(1.5, rr * squash);
          ig.globalAlpha = vis;
          const gr = ig.createRadialGradient(ex, ey, 1, ex, ey, Math.max(rx, ry));
          gr.addColorStop(0, '#000'); gr.addColorStop(0.85, '#030303'); gr.addColorStop(1, '#111');
          ig.fillStyle = gr; ig.strokeStyle = edge; ig.lineWidth = 3;
          ig.beginPath(); ig.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2); ig.fill(); ig.stroke();
          ig.globalAlpha = vis * 0.25; ig.fillStyle = '#ddd'; ig.fillRect(ex - rx, ey + ry + 2, rx * 2, 10);     // posterior enhancement
          ig.globalAlpha = 1;
        };
        const beat = 1 + 0.12 * Math.max(0, Math.sin(t * 7.5));
        const collapse = clamp01((S.p - 0.55) / 0.35);
        vessel(S.vx + 0.065, S.vy, 70, 17, 0.85 * (1 - 0.9 * collapse), 'rgba(205,205,205,.6)');
        vessel(S.vx, S.vy, 108, 14 * beat, 1, 'rgba(245,245,245,.9)');
        ig.restore();
        if (contact < 0.5) { ig.fillStyle = 'rgba(0,0,0,.55)'; ig.fillRect(0, 0, W, H); ig.fillStyle = '#ffb020'; ig.font = '600 13px Inter, sans-serif'; ig.textAlign = 'center'; ig.fillText('NO CONTACT · press', W / 2, H / 2); }
        ig.fillStyle = 'rgba(255,255,255,.55)'; ig.font = '600 9px "JetBrains Mono", monospace'; ig.textAlign = 'left';
        ig.fillText('L12-4  B-MODE', 8, 11); ig.textAlign = 'right'; ig.fillText(`D 4.0cm  G ${Math.round(40 + S.q * 20)}%`, W - 8, 11);
        for (let i = 0; i <= 4; i++) ig.fillRect(4, AY + i * 40, 5, 1);
        ig.strokeStyle = S.onT ? '#34d399' : 'rgba(255,255,255,.3)'; ig.lineWidth = 2; ig.strokeRect(1, 1, W - 2, H - 2);
      };

      let lastW = 0, lastH = 0;
      return {
        own, camera: cam,
        frame(S, now) {
          const w = host.clientWidth, h = host.clientHeight, a = w / Math.max(1, h);
          if (w !== lastW || h !== lastH) {
            lastW = w; lastH = h;
            cam.left = -a / 2; cam.right = a / 2; cam.top = 0.5; cam.bottom = -0.5; cam.updateProjectionMatrix();
            skin.scale.set(a, 1, 1);
          }
          if (builtFor !== S.ph || builtAsp !== a) { build(S.ph, a); builtFor = S.ph; builtAsp = a; }
          const t = (now - S.t0) / 1000;
          vessels.position.x = 0.025 * Math.sin(t * 0.5) * a;
          const collapse = clamp01((S.p - 0.55) / 0.35);
          if (vein) vein.scale.y = 1 - 0.8 * collapse;
          const sxn = S.vx - 0.5, pxn = S.x - 0.5;
          site.position.set(sxn * a, hAt(sxn) + 0.02, S.vy - 0.5);
          site.scale.setScalar(1 + 0.12 * Math.sin(now / 160));
          cross1.position.copy(site.position); cross2.position.copy(site.position);
          probe.position.set(pxn * a, hAt(pxn) - S.p * 0.03, S.y - 0.5);
          probe.rotation.set(0, -S.ang, 0);
          const cd = S.conds || {};
          footMat.color.setHex(S.onT ? 0x34d399 : cd.angOk ? 0x6aa8ff : 0xffd54a);
          shadowMat.opacity = 0.6 + 0.4 * S.p;
          drawEcho(S, a, t);
        },
      };
    });
  }

  // ---------------------------------------------------------
  // 7. Microgravity Science Glovebox — detailed procedural work volume with
  //    soft shadows, glass vials, a labelled rack (letters turn with it).
  // ---------------------------------------------------------
  const LIQUID = [0x3d7bff, 0x34d399, 0xffb020, 0xe0457b, 0x9b6bff, 0x2ec5d3];
  function glovebox(box, getState) {
    return mountView(box, null, getState, (THREE, scene, camera, _m, host) => {
      const own = [];
      scene.background = new THREE.Color(0xdfe5ee);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa4b6, 1.25));
      const top = new THREE.DirectionalLight(0xffffff, 2.0); top.position.set(0.8, 6, 2.2);
      top.castShadow = true; top.shadow.mapSize.set(1024, 1024); top.shadow.radius = 4;
      Object.assign(top.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 12 }); top.shadow.bias = -0.0008;
      scene.add(top);
      const fill = new THREE.DirectionalLight(0xe8f0ff, 0.6); fill.position.set(-3, 2, 4); scene.add(fill);
      camera.fov = 38; camera.updateProjectionMatrix();

      const W = 5.2, D = 3.2, H = 2.6;
      const backTex = canvasTex(THREE, 512, 256, (g, w, h) => {
        g.fillStyle = '#e8ecf2'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#cdd4de'; g.lineWidth = 2;
        for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo((i * w) / 8, 0); g.lineTo((i * w) / 8, h); g.stroke(); }
        for (let j = 0; j <= 4; j++) { g.beginPath(); g.moveTo(0, (j * h) / 4); g.lineTo(w, (j * h) / 4); g.stroke(); }
        g.fillStyle = '#9aa3b2'; for (let i = 0; i < 18; i++) g.fillRect(40 + i * 8, 40, 4, 40);   // air vent
        g.fillStyle = '#1b2233'; g.fillRect(330, 40, 120, 28); g.fillStyle = '#fff'; g.font = '700 16px monospace'; g.fillText('MSG WV', 352, 60);
        [['#34d399', 330], ['#ffb020', 352], ['#34d399', 374]].forEach(([c, x]) => { g.fillStyle = c; g.beginPath(); g.arc(x + 8, 90, 5, 0, 7); g.fill(); });
        noise(g, w, h, 1500, '120,130,150', 0.06);
      });
      const floorTex = canvasTex(THREE, 256, 256, (g, w, h) => {
        g.fillStyle = '#bcc4d0'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#8a93a3'; for (let y = 8; y < h; y += 16) for (let x = 8; x < w; x += 16) { g.beginPath(); g.arc(x, y, 3.2, 0, 7); g.fill(); }
        noise(g, w, h, 2000, '255,255,255', 0.08);
      });
      floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(4, 2.5);
      const wallMat = new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.75 });
      const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.5, metalness: 0.35 });
      const sideMat = new THREE.MeshStandardMaterial({ color: 0xd3d9e3, roughness: 0.8 });
      const planeW = new THREE.PlaneGeometry(W, H), planeF = new THREE.PlaneGeometry(W, D), planeS = new THREE.PlaneGeometry(D, H);
      const floor = new THREE.Mesh(planeF, floorMat); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
      const backW = new THREE.Mesh(planeW, wallMat); backW.position.set(0, H / 2, -D / 2); backW.receiveShadow = true; scene.add(backW);
      const left = new THREE.Mesh(planeS, sideMat); left.rotation.y = Math.PI / 2; left.position.set(-W / 2, H / 2, 0); scene.add(left);
      const right = new THREE.Mesh(planeS, sideMat); right.rotation.y = -Math.PI / 2; right.position.set(W / 2, H / 2, 0); scene.add(right);
      const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const ledGeo = new THREE.BoxGeometry(W * 0.8, 0.05, 0.12);
      const led = new THREE.Mesh(ledGeo, ledMat); led.position.set(0, H - 0.05, -D / 2 + 0.2); scene.add(led);
      own.push(backTex, floorTex, wallMat, floorMat, sideMat, planeW, planeF, planeS, ledMat, ledGeo);
      // equipment: camera on a bracket, a tool tray, a sealed bag
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x343b48, roughness: 0.45, metalness: 0.55 });
      const camGeo = new THREE.BoxGeometry(0.42, 0.28, 0.32), lensGeo = new THREE.CylinderGeometry(0.09, 0.1, 0.16, 24), armGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8);
      const vcam = new THREE.Mesh(camGeo, darkMat); vcam.position.set(1.75, 1.9, -D / 2 + 0.35); vcam.castShadow = true; scene.add(vcam);
      const lens = new THREE.Mesh(lensGeo, darkMat); lens.rotation.x = Math.PI / 2; lens.position.set(1.75, 1.9, -D / 2 + 0.58); scene.add(lens);
      const arm = new THREE.Mesh(armGeo, darkMat); arm.rotation.x = Math.PI / 2; arm.position.set(1.75, 1.9, -D / 2 + 0.1); scene.add(arm);
      const toolMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2, metalness: 0.7, roughness: 0.3 });
      const toolTrayGeo = new THREE.BoxGeometry(0.9, 0.06, 0.5), forcepsGeo = new THREE.BoxGeometry(0.6, 0.02, 0.04);
      const toolTray = new THREE.Mesh(toolTrayGeo, toolMat); toolTray.position.set(-1.85, 0.03, -0.6); toolTray.castShadow = toolTray.receiveShadow = true; scene.add(toolTray);
      [-0.1, 0.06].forEach((z, i) => { const f = new THREE.Mesh(forcepsGeo, darkMat); f.position.set(-1.85, 0.075, -0.6 + z); f.rotation.y = 0.15 * (i ? 1 : -1); f.castShadow = true; scene.add(f); });
      const bagMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.15, clearcoat: 1 });
      const bagGeo = new THREE.BoxGeometry(0.7, 0.12, 0.55);
      const bag = new THREE.Mesh(bagGeo, bagMat); bag.position.set(1.9, 0.06, -0.3); bag.rotation.y = -0.3; scene.add(bag);
      own.push(darkMat, camGeo, lensGeo, armGeo, toolMat, toolTrayGeo, forcepsGeo, bagMat, bagGeo);
      // glove ports in the foreground
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x5b6577, roughness: 0.45, metalness: 0.6 });
      const portGeo = new THREE.TorusGeometry(0.42, 0.07, 16, 56);
      own.push(frameMat, portGeo);
      [-1.95, 1.95].forEach((x) => { const port = new THREE.Mesh(portGeo, frameMat); port.position.set(x, 0.55, D / 2 + 0.25); port.scale.setScalar(0.8); scene.add(port); });

      // the vial rack: rounded anodised body, engraved top plate with A–D / 1–3
      const rack = new THREE.Group(); rack.position.set(0, 0, 0.1); scene.add(rack);
      const rr = new THREE.Shape(); const RW = 2.5, RD = 1.75, RR = 0.14;
      rr.moveTo(-RW / 2 + RR, -RD / 2); rr.lineTo(RW / 2 - RR, -RD / 2); rr.quadraticCurveTo(RW / 2, -RD / 2, RW / 2, -RD / 2 + RR);
      rr.lineTo(RW / 2, RD / 2 - RR); rr.quadraticCurveTo(RW / 2, RD / 2, RW / 2 - RR, RD / 2); rr.lineTo(-RW / 2 + RR, RD / 2);
      rr.quadraticCurveTo(-RW / 2, RD / 2, -RW / 2, RD / 2 - RR); rr.lineTo(-RW / 2, -RD / 2 + RR); rr.quadraticCurveTo(-RW / 2, -RD / 2, -RW / 2 + RR, -RD / 2);
      const rackGeo = new THREE.ExtrudeGeometry(rr, { depth: 0.2, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 3, curveSegments: 8 });
      rackGeo.rotateX(-Math.PI / 2);
      const rackMat = new THREE.MeshStandardMaterial({ color: 0x2c4f92, roughness: 0.32, metalness: 0.6 });
      const rackBody = new THREE.Mesh(rackGeo, rackMat); rackBody.castShadow = rackBody.receiveShadow = true; rack.add(rackBody);
      const plateTex = canvasTex(THREE, 512, 360, (g, w, h) => {
        g.fillStyle = '#3561ad'; g.fillRect(0, 0, w, h);
        noise(g, w, h, 4000, '255,255,255', 0.05);
        g.fillStyle = '#dfe8ff'; g.font = '700 26px "JetBrains Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
        ['A', 'B', 'C', 'D'].forEach((c, i) => g.fillText(c, w * (0.152 + i * 0.232), 24));
        ['1', '2', '3'].forEach((c, j) => g.fillText(c, 22, h * (0.2 + j * 0.3) + 16));
        g.fillStyle = '#0b1222';
        for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { g.beginPath(); g.arc(w * (0.152 + i * 0.232), h * (0.2 + j * 0.3) + 16, 34, 0, 7); g.fill(); }
        g.fillStyle = '#ffb020'; g.fillRect(w - 70, h - 24, 56, 10);
      });
      const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.35, metalness: 0.4 });
      const plateGeo = new THREE.PlaneGeometry(RW, RD);
      const plate = new THREE.Mesh(plateGeo, plateMat); plate.rotation.x = -Math.PI / 2; plate.position.y = 0.232; plate.receiveShadow = true; rack.add(plate);
      const aoTex = canvasTex(THREE, 128, 128, (g, w, h) => { const r = g.createRadialGradient(64, 64, 20, 64, 64, 64); r.addColorStop(0, 'rgba(0,0,0,.45)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); }, false);
      const aoMat = new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false });
      const aoGeo = new THREE.PlaneGeometry(RW * 1.35, RD * 1.45);
      const ao = new THREE.Mesh(aoGeo, aoMat); ao.rotation.x = -Math.PI / 2; ao.position.y = 0.004; rack.add(ao);
      own.push(rackGeo, rackMat, plateTex, plateMat, plateGeo, aoTex, aoMat, aoGeo);

      const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.92, thickness: 0.04, roughness: 0.04, ior: 1.45, transparent: true, side: THREE.DoubleSide });
      const glassGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.46, 32, 1, true);
      const bottomGeo = new THREE.SphereGeometry(0.11, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      const liqGeo = new THREE.CylinderGeometry(0.096, 0.096, 0.3, 24);
      const meniscusGeo = new THREE.CircleGeometry(0.096, 24);
      const sleeveGeo = new THREE.CapsuleGeometry(0.135, 0.34, 6, 24);
      const sleeveMat = new THREE.MeshStandardMaterial({ color: 0xf3f5f9, roughness: 0.38, metalness: 0.05 });
      const capGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.05, 24);
      const capMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2, metalness: 0.8, roughness: 0.25 });
      const liqMats = LIQUID.map((cc) => new THREE.MeshPhysicalMaterial({ color: cc, emissive: cc, emissiveIntensity: 0.18, roughness: 0.15, clearcoat: 0.6 }));
      const ringGeo = new THREE.TorusGeometry(0.2, 0.025, 10, 40);
      const ringMats = { right: new THREE.MeshBasicMaterial({ color: 0x1fb57a }), wrong: new THREE.MeshBasicMaterial({ color: 0xe23b3b }) };
      own.push(glassMat, glassGeo, bottomGeo, liqGeo, meniscusGeo, sleeveGeo, sleeveMat, capGeo, capMat, ringGeo, ...liqMats, ...Object.values(ringMats));
      const vials = Array.from({ length: 12 }, (_, i) => {
        const col = i % 4, row = Math.floor(i / 4);
        const x = -RW / 2 + RW * (0.152 + col * 0.232), z = -RD / 2 + RD * ((0.2 + row * 0.3) + 16 / 360);
        const gv = new THREE.Group(); gv.position.set(x, 0.42, z); rack.add(gv);
        const liq = new THREE.Mesh(liqGeo, liqMats[0]); liq.position.y = -0.07; liq.castShadow = true;
        const men = new THREE.Mesh(meniscusGeo, liqMats[0]); men.rotation.x = -Math.PI / 2; men.position.y = 0.081;
        const glass = new THREE.Mesh(glassGeo, glassMat);
        const bottom = new THREE.Mesh(bottomGeo, glassMat); bottom.position.y = -0.23;
        const cap = new THREE.Mesh(capGeo, capMat); cap.position.y = 0.25;
        const sleeve = new THREE.Mesh(sleeveGeo, sleeveMat); sleeve.castShadow = true;
        const ring = new THREE.Mesh(ringGeo, ringMats.right); ring.rotation.x = Math.PI / 2; ring.position.y = -0.2; ring.visible = false;
        gv.add(liq, men, glass, bottom, cap, sleeve, ring);
        return { gv, liq, men, sleeve, ring, lift: 0, sy: 1.25 };
      });

      camera.position.set(0, 3.9, 2.6);
      camera.lookAt(0, 0.25, 0.1);
      const btns = [...host.querySelectorAll('.slot')];
      const tmp = new THREE.Vector3();
      let lastCodes = null, last = performance.now();
      const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
      return {
        own,
        frame(S, now) {
          const dt = Math.min(0.1, (now - last) / 1000); last = now;
          if (S.codes !== lastCodes && S.codes && S.codes.length) {
            lastCodes = S.codes;
            vials.forEach((v, i) => { const cc = S.codes[i] || '00'; v.liq.material = v.men.material = liqMats[(cc.charCodeAt(0) * 7 + cc.charCodeAt(1)) % liqMats.length]; });
          }
          rack.rotation.y = S.rotated ? Math.PI * ease((now - S.rotAt) / 1200) : 0;
          const capped = S.phase === 'cap' || S.phase === 'rotate' || S.phase === 'recall';
          const w = host.clientWidth, h = host.clientHeight;
          camera.position.x = 0.12 * Math.sin(now / 5000);
          camera.lookAt(0, 0.25, 0.1);
          camera.updateMatrixWorld(true); rack.updateMatrixWorld(true);
          vials.forEach((v, i) => {
            const st = S.slots[i] || {};
            const sleeveOn = capped && !st.open;
            v.sy += ((sleeveOn ? 0.02 : 1.25) - v.sy) * Math.min(1, dt * 9);
            v.sleeve.position.y = v.sy;
            v.sleeve.visible = v.sy < 1.2;
            const liftT = st.right || st.wrong ? 0.4 : 0;
            v.lift += (liftT - v.lift) * Math.min(1, dt * 9);
            v.gv.position.y = 0.42 + v.lift;
            v.ring.visible = !!(st.right || st.wrong);
            if (v.ring.visible) v.ring.material = st.right ? ringMats.right : ringMats.wrong;
            const el = btns[i];
            if (el) {
              tmp.set(0, 0.05, 0); v.gv.localToWorld(tmp); tmp.project(camera);
              el.style.left = `${((tmp.x + 1) / 2) * w}px`; el.style.top = `${((1 - tmp.y) / 2) * h}px`;
            }
          });
        },
      };
    });
  }

  window.Scene3D = { supported: supportsWebGL, cygnus, docking, eva, water, drill, ultrasound, glovebox };
})();
