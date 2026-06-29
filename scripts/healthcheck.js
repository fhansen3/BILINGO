'use strict';
const http = require('http');
setTimeout(() => {
  const port = process.env.PORT;
  http.get('http://127.0.0.1:' + port + '/', { timeout: 5000 }, (r) => {
    let len = 0;
    r.on('data', (c) => len += c.length);
    r.on('end', () => {
      console.log('HTTP=' + r.statusCode);
      console.log('BYTES=' + len);
      console.log('CT=' + (r.headers['content-type'] || ''));
      process.exit(r.statusCode >= 200 && r.statusCode < 400 ? 0 : 1);
    });
  }).on('error', (e) => {
    console.error('ERR', e.message);
    process.exit(1);
  });
}, 500);
