#!/usr/bin/env node
const http = require('http');

const api = process.env.MEDIAMTX_API || 'http://127.0.0.1:9997';

function fetchJSON(path) {
  return new Promise((resolve, reject) => {
    const req = http.request(api + path, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const list = await fetchJSON('/v3/paths/list');
  if (!list.items || !list.items.length) {
    console.log('No active paths');
    return;
  }
  list.items.forEach((item) => {
    console.log(
      `${item.name.padEnd(12)} ready=${item.ready} tracks=${item.tracks.join(',') || 'none'} bytes=${item.bytesReceived}`
    );
  });
}

main().catch((err) => {
  console.error('check-media failed:', err.message);
  process.exit(1);
});
