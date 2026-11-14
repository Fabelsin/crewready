# Local Three.js assets

Copied unchanged from the official npm package `three@0.160.0` (r160), MIT license. `LICENSE` is included here. The app's import map resolves `three` and `three/addons/` to these local files. Only the core module and the three addons required by the teammate's 3D scenes are distributed.

| File | SHA-256 |
|---|---|
| `three.module.js` | `76dea8151bc9352aef3528b4262e249b2604f62543828328db978d060d61a495` |
| `addons/environments/RoomEnvironment.js` | `e21f41b7ef2016f2984a5d27850b42dffa797a6a194a138e288b06576d765a7b` |
| `addons/loaders/GLTFLoader.js` | `d073b438e6a07e1359741dd5d6c76c953420cc0d4fd84eb1bdde94315540e6a3` |
| `addons/utils/BufferGeometryUtils.js` | `9be041e96308775d00e2695cc607645b9a9b64fd7c0e759dd8f7c00a8d92becb` |

Source: https://www.npmjs.com/package/three/v/0.160.0. The build checks these bytes and the local GLB model headers. Context7 r160 documentation was consulted for local import maps and resource disposal.
