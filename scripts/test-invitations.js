'use strict';

const http = require('http');

setTimeout(() => {
  http.get('http://localhost:' + process.env.PORT + '/api/invitations/mine', (r) => {
    let body = '';
    r.on('data', (c) => body += c);
    r.on('end', () => {
      console.log('HTTP', r.statusCode);
      console.log('body:', body.slice(0, 300));
      process.exit(0);
    });
  }).on('error', (e) => {
    console.error('ERR', e.message);
    process.exit(1);
  });
}, 2500);
