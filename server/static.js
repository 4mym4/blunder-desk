#!/usr/bin/env node
/* Minimal static file server for dist/ — zero dependencies, so the
   project runs with nothing installed. `npm start` builds then serves. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 5173);
const ROOT = path.join(__dirname, '..', 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.pgn': 'text/plain; charset=utf-8'
};

http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
  let file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  // never serve outside dist/
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log(`Blunder Desk on http://localhost:${PORT}`);
});
