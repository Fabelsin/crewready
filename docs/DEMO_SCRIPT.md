# Judge demo

1. Run `docker compose up -d --build` and open `http://localhost:8765/`. Open a crew session with a position, call sign and **Training scenario**. These are local labels, not authentication.
2. Select an operation. The latest seven cognitive checks and their 3D scenes are preserved. Use **Load recorded check** for a fast, explicitly simulated cognitive example, or perform the live check.
3. MoveCheck presents two different movements from a pool of three: side-view squat, front-view overhead reach, front-view T-pose arm open. The screen gives framing, starting pose and full movement instructions. Change the current choice if desired.
4. Enable the camera explicitly. Hold the starting pose, perform three full cycles, and return to the starting pose each time. A partial or interrupted cycle does not count. After the first block the camera turns off and the next starts at **0/3**; reposition and enable it again. You may skip one block or the whole break.
5. Show separate cognitive and movement observations, the teammate's task-indicator panels labeled with demo references, and independent recent references. There is no combined medical/readiness score or automatic task clearance.
6. Edit the partner cross-check and copy the summary. Export JSON to show two compact attempt records with source labels. Start another assessment to demonstrate a rotated default and fresh counters.

The movement pool is an optional Earth training break. The app does not establish that it improves alertness or treats fatigue. Onboard exercise needs anchored/resistive equipment and separate validation.

Software demo settings: 3 repetitions per block, five stable starting frames, minimum phase 250 ms, full cycle 800 ms, maximum untracked gap 350 ms, maximum block window three minutes. Squat uses estimated knee angles (standing ≥155°, bottom ≤115°, 8° hysteresis). Overhead reach uses both arm elevations ≥135°; T-pose uses 70–110° with lateral extension. Both arm movements start/finish at ≤40° and hold the target for 300 ms. These are configurable prototype thresholds, not NASA prescriptions or clinical limits.

Automated full movement tests use labeled synthetic landmarks. Actual local MediaPipe initialization/inference is separately tested on Chrome's fake camera feed. Neither validates human movement detection accuracy. A real person/webcam and weak-device responsiveness still need testing.
