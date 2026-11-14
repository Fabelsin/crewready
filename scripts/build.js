import {readFileSync, existsSync, mkdirSync, cpSync, writeFileSync, rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

const root = process.cwd(), output = join(root, 'dist');
const expected = {
  'pose_landmarker_lite.task': '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  'vision_bundle.mjs': 'de83c48ff329717a27aeb528d5ef5f47f077c628a5302dc483aca5b513e7464b',
  'vision_wasm_internal.js': '6f6b86509cf9e163ea1cfec7edc8cf53732699c04781e4c21c557c1ba402310e',
  'vision_wasm_internal.wasm': 'cb3ec20026a9aecc2a81a93c25630ceb5389297ddb7a5f0bd61dd09cde606b9b',
  'vision_wasm_nosimd_internal.js': '9f8fc960e363f0fb2f42f7937b97ae9cf9a5630490f71031fa90caa9bb121938',
  'vision_wasm_nosimd_internal.wasm': '924274fcd5ac8985f6570a8573e7971b7bd2d580ba1b8f3beb0ba8f95db6347c',
};
for (const [file, hash] of Object.entries(expected)) {
  const path = join(root, 'public', 'models', file);
  if (!existsSync(path) || createHash('sha256').update(readFileSync(path)).digest('hex') !== hash) throw Error(`Missing or modified local model asset: ${file}`);
}
const vendorExpected = {
  'three.module.js': '76dea8151bc9352aef3528b4262e249b2604f62543828328db978d060d61a495',
  'addons/environments/RoomEnvironment.js': 'e21f41b7ef2016f2984a5d27850b42dffa797a6a194a138e288b06576d765a7b',
  'addons/loaders/GLTFLoader.js': 'd073b438e6a07e1359741dd5d6c76c953420cc0d4fd84eb1bdde94315540e6a3',
  'addons/utils/BufferGeometryUtils.js': '9be041e96308775d00e2695cc607645b9a9b64fd7c0e759dd8f7c00a8d92becb',
};
for (const [file, hash] of Object.entries(vendorExpected)) {
  const path = join(root, 'public', 'vendor', 'three', file);
  if (!existsSync(path) || createHash('sha256').update(readFileSync(path)).digest('hex') !== hash) throw Error(`Missing or modified Three.js asset: ${file}`);
}
const scene = readFileSync(join(root, 'scene3d.js'), 'utf8');
for (const match of scene.matchAll(/assets\/models\/[\w-]+\.glb/g)) {
  const asset = readFileSync(join(root, match[0]));
  if (asset.subarray(0, 4).toString() !== 'glTF') throw Error(`Invalid 3D model: ${match[0]}`);
}
const html = readFileSync(join(root, 'index.html'), 'utf8');
if (/https?:\/\/[^"'\s>]+\.(?:css|js|woff2?)/i.test(html) || /fonts\.googleapis\.com/.test(html)) throw Error('External runtime dependency found in HTML');
if (existsSync(output)) rmSync(output, {recursive: true});
mkdirSync(output, {recursive: true});
for (const name of ['index.html', 'styles.css', 'app.js', 'scene3d.js', 'session.js', 'movement-math.js', 'movement.js', 'pose-worker.js']) cpSync(join(root, name), join(output, name));
cpSync(join(root, 'assets'), join(output, 'assets'), {recursive: true});
cpSync(join(root, 'public'), join(output, 'public'), {recursive: true});
writeFileSync(join(output, 'BUILD.txt'), 'CrewReady static site. Serve this directory at localhost or HTTPS.\n');
console.log('Built complete static site at dist/ with verified local model assets.');
