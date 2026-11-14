# Verification on 14 November 2026

Integration base: `fe74ad9` on `origin/main`, including `42edd9c` (reworked missions 5–7), `42e8559` (seven 3D views), and `5e4b501` (crew console/briefings). A final fetch found no newer upstream commits. Branch: `codex/movecheck-exercise-pool`.

The mission definitions and all seven cognitive controller function bodies were compared with `origin/main` and matched exactly. `scene3d.js` is unchanged from upstream. The indicator panel keeps the latest task observations and demo reference bars, while automatic readiness/clearance wording is replaced with neutral observations. Missing fields are not fabricated as zero.

Passed:

- `npm ci --no-audit --no-fund` (pinned lockfile).
- `npm test`: 12 deterministic tests. Three exercise cycles, geometry, incomplete/noisy/brief target crossings, tracking loss/reacquisition, fixed squat side, invalid timestamps, rotation, fresh counters, session upsert/corruption/budgets, profile/source/protocol isolation and zero references.
- `npx tsc --noEmit`: checked new session, movement math/controller and Worker modules with scoped contracts in `contracts.d.ts`. Legacy app/3D files are not claimed to be fully type checked.
- `node --check` for app, 3D and browser-check sources.
- `npm run build`: verified MediaPipe and Three.js checksums, local GLB headers, external runtime guards, complete `dist/` packaging.
- `npm run test:browser`: Chrome with non-loopback requests blocked. Synthetic inference completed a two-exercise routine and verified that block 2 and a new assessment start at 0/3, the camera stops between blocks, selection works by keyboard, JSON upserts rather than duplicates, and export/partner summary preserve separate observations. All seven latest cognitive/3D panes started; one live water check completed. Actual local MediaPipe startup/inference was tested separately on Chrome's fake camera. Camera denial/absence/corrupt model, late permission, hidden-tab cleanup, mobile canvas alignment and subpath loading passed.
- `docker compose build`, `docker compose up -d`, and `node scripts/docker-smoke.js`: actual Nginx site at `http://localhost:8765/` passed crew access, pool/fresh counters, local model startup, skip/results/summary and blocked external traffic. Container health is `healthy`. WASM/model/Three responses had correct MIME types and real file lengths.
- `git diff --check`.

The old `crewready` worktree and its uncommitted changes were retained. The new worktree is `crewready-movecheck-pool`; the old Docker container was stopped and the new branch's container serves port 8765. Nothing was pushed.

Limits: no person/webcam detection accuracy or weak-device responsiveness measurements were performed. Synthetic landmarks test software behavior; fake-camera inference tests the local runtime path. Only the water cognitive check was completed live by automation; all seven were initialized with 3D and exercised through their recorded result path. The core is locally served offline, not a cold-start PWA. NASA briefing videos are optional online content, loaded only after an explicit action. The movement break does not establish improved alertness or medical/operational fitness.
