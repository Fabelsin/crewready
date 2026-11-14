# Local pose assets

Runtime: `@mediapipe/tasks-vision` **0.10.32**, from the [official npm package](https://www.npmjs.com/package/@mediapipe/tasks-vision/v/0.10.32), Apache License 2.0. The bundled JavaScript and SIMD/non-SIMD WASM files are copied unchanged from that exact package. Google MediaPipe copyright and license notices apply; see [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0).

Model: official [Pose Landmarker Lite float16 revision 1](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task), downloaded unchanged on 2026-11-14. MediaPipe models are distributed under Apache 2.0; see [MediaPipe licensing](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE).

| File | SHA-256 |
|---|---|
| `pose_landmarker_lite.task` | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| `vision_bundle.mjs` | `de83c48ff329717a27aeb528d5ef5f47f077c628a5302dc483aca5b513e7464b` |
| `vision_wasm_internal.js` | `6f6b86509cf9e163ea1cfec7edc8cf53732699c04781e4c21c557c1ba402310e` |
| `vision_wasm_internal.wasm` | `cb3ec20026a9aecc2a81a93c25630ceb5389297ddb7a5f0bd61dd09cde606b9b` |
| `vision_wasm_nosimd_internal.js` | `9f8fc960e363f0fb2f42f7937b97ae9cf9a5630490f71031fa90caa9bb121938` |
| `vision_wasm_nosimd_internal.wasm` | `924274fcd5ac8985f6570a8573e7971b7bd2d580ba1b8f3beb0ba8f95db6347c` |

All runtime references resolve relative to the app document or module URL as `public/models/...`, including when deployed under a project path. No CDN is needed at runtime.
