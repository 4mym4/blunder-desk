#!/usr/bin/env node
/* ============================================================
   Chess.com import proxy.

   Chess.com's Published-Data API sends no Access-Control-Allow-Origin
   header, so a browser refuses to read it from a page on another
   origin. This sits in between: it calls chess.com from Node (where
   CORS does not apply), and answers the browser with the CORS header
   it needs.

   Zero dependencies. Node 18+ (for global fetch).

     node server/proxy.js
     GET /chesscom/:username?max=15   -> text/plain PGN
     GET /health

   Chess.com asks for two things and enforces both:
     - a descriptive User-Agent with a contact address, or it answers 403
     - serial requests; parallel ones get rate limited (429)
   Both are handled below. Put your own address in CONTACT.
   ============================================================ */

const http = require('http');

const PORT = Number(process.env.PORT || 8787);
const CONTACT = process.env.CONTACT || 'you@example.com';
const UA = `blunder-desk/1.0 (${CONTACT})`;
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, attempt = 0) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (res.status === 429 && attempt < 3) {
    await sleep(1000 * (attempt + 1));
    return getJson(url, attempt + 1);
  }
  if (res.status === 404) { const e = new Error('not_found'); e.code = 404; throw e; }
  if (res.status === 403) {
    const e = new Error('Chess.com rejected the request — set CONTACT to a real address so the User-Agent identifies you.');
    e.code = 403; throw e;
  }
  if (!res.ok) { const e = new Error(`chess.com replied ${res.status}`); e.code = 502; throw e; }
  return res.json();
}

async function recentGames(username, max) {
  const user = encodeURIComponent(String(username).toLowerCase());
  const { archives } = await getJson(`https://api.chess.com/pub/player/${user}/games/archives`);
  if (!archives || !archives.length) return [];

  const out = [];
  // Walk back month by month, newest first, serially, until we have enough.
  for (let i = archives.length - 1; i >= 0 && out.length < max; i--) {
    const month = await getJson(archives[i]);
    const games = (month.games || []).filter(g => g.pgn);
    for (let j = games.length - 1; j >= 0 && out.length < max; j--) out.push(games[j].pgn);
    if (i > 0 && out.length < max) await sleep(120);  // stay serial and polite
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, contact: CONTACT }));
  }

  const m = /^\/chesscom\/([^/]+)$/.exec(url.pathname);
  if (!m) {
    res.writeHead(404, { ...cors, 'Content-Type': 'text/plain' });
    return res.end('Try /chesscom/<username>?max=15');
  }

  const max = Math.min(100, Math.max(1, Number(url.searchParams.get('max')) || 15));
  const username = decodeURIComponent(m[1]);

  try {
    console.log(`fetching up to ${max} games for ${username}`);
    const pgns = await recentGames(username, max);
    res.writeHead(200, { ...cors, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(pgns.join('\n\n'));
    console.log(`  -> ${pgns.length} games`);
  } catch (err) {
    const code = err.code === 404 ? 404 : err.code === 403 ? 403 : 502;
    const msg = code === 404 ? `No chess.com account called "${username}".` : err.message;
    res.writeHead(code, { ...cors, 'Content-Type': 'text/plain' });
    res.end(msg);
    console.error(`  -> ${code} ${msg}`);
  }
});

server.listen(PORT, () => {
  console.log(`chess.com proxy on http://localhost:${PORT}`);
  console.log(`  identifying as: ${UA}`);
  if (CONTACT === 'you@example.com') {
    console.log('  NOTE: set CONTACT=your@email to avoid 403s from chess.com');
  }
});
