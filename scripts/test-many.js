'use strict';

const http = require('http');
const PORT = 45037; // real service port

const paths = [
  '/api/auth/me',
  '/api/users/partners',
  '/api/rooms/mine',
  '/api/invitations/mine',
  '/healthz'
];

async function probe(path) {
  return new Promise((resolve) => {
    const req = http.request({ host: 'localhost', port: PORT, path, method: 'GET' }, (r) => {
      let b = '';
      r.on('data', c => b += c);
      r.on('end', () => {
        console.log(path, '→', r.statusCode, '|', b.slice(0, 150));
        resolve();
      });
    });
    req.on('error', e => { console.log(path, 'ERR', e.message); resolve(); });
    req.end();
  });
}

(async () => {
  for (const p of paths) await probe(p);
})();
