import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

const version = '1.15.3'; // Matches the Dockerfile's default MediaMTX version.
const baseUrl = `https://raw.githubusercontent.com/bluenviron/mediamtx/v${version}/`;
const output = new URL('../.cache/mediamtx/publisher.js', import.meta.url);
const moduleHash = 'e903555223f196aca86d7adce5cf4437824435291bf9b47f284aa767fffabaaa';
const hash = (content) => createHash('sha256').update(content).digest('hex');

async function download(path, checksum) {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`MediaMTX download failed: ${path} (${response.status})`);
  const content = await response.text();
  if (hash(content) !== checksum) throw new Error(`MediaMTX checksum mismatch: ${path}`);
  return content;
}

let cached;
try {
  cached = await readFile(output, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

if (cached && hash(cached) === moduleHash) {
  console.info(`Using cached MediaMTX publisher v${version}`);
} else {
  const [source, license] = await Promise.all([
    download('internal/servers/webrtc/publisher.js', '6b4448939b45c30507bce59acaf434e3133e6efac3bd77d7e20fb01462958509'),
    download('LICENSE', 'ecae73b0a23185a35a1222edc0aae5245bb9739420bad0125b0c42e935301a80'),
  ]);
  // Keep upstream behavior and its license; only adapt the browser-global export for Vite.
  const module = `// MediaMTX v${version} publisher client, matching the Dockerfile default.\n`
    + `// Source: ${baseUrl}internal/servers/webrtc/publisher.js\n`
    + '// Only modification: export the class as an ES module for Vite.\n'
    + `/*\n${license}\n*/\n`
    + source.replace('window.MediaMTXWebRTCPublisher = MediaMTXWebRTCPublisher;', 'export default MediaMTXWebRTCPublisher;');
  if (hash(module) !== moduleHash) throw new Error('Generated MediaMTX module checksum mismatch');
  await mkdir(new URL('.', output), { recursive: true });
  // Publish the verified module atomically so an interrupted download cannot poison the cache.
  const temporary = new URL(`${output.href}.${process.pid}.tmp`);
  await writeFile(temporary, module);
  await rename(temporary, output);
  console.info(`Downloaded and verified MediaMTX publisher v${version}`);
}
