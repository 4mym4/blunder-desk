/* The localStorage store.

   Games used to vanish on reload anywhere except a published artifact: the
   save/load layer was written against the artifact document store, and served
   from GitHub Pages or `npm start` there was no store at all, so every call
   was a no-op. localStore() is the same query surface over localStorage, which
   is what lets loadStored/persistGame/saveIntention stay as they were.

   Shaped like the artifact store means the shape is the contract, so it is
   what gets checked: the exact calls those three functions make, against a
   fake localStorage, extracted from the built page the way board.test.js does.
   What is stored is the PGN and never the analysis — a cached verdict would go
   stale the next time the grader changes — so there is nothing here about
   round-tripping plies. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIST = path.join(__dirname, '..', 'dist', 'index.html');
if (!fs.existsSync(DIST)) {
  console.log('dist/index.html missing — run `npm run build` first');
  process.exit(1);
}
const html = fs.readFileSync(DIST, 'utf8');

const src = (html.match(/\n  function localStore\(\) \{[\s\S]*?\n  \}\n/) || [])[0];
assert.ok(src, 'localStore not found in the built page');

let passed = 0;
const ok = (name, fn) => {
  (async () => {
    try { await fn(); console.log('  ok   ' + name); passed++; }
    catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
  })();
};

// a localStorage that behaves, plus a switch to make it refuse writes
function fakeStorage() {
  const map = new Map();
  return {
    full: false,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) {
      if (this.full) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      map.set(k, String(v));
    },
    removeItem(k) { map.delete(k); }
  };
}

function build(storage) {
  const sandbox = { localStorage: storage, JSON, Object };
  vm.createContext(sandbox);
  vm.runInContext(src + '\nthis.localStore = localStore;', sandbox);
  return sandbox.localStore();
}

console.log('the browser store:');

ok('a game written is a game read back', async () => {
  const storage = fakeStorage();
  await build(storage).collection('games').doc('g1').set({ gid: 'g1', pgn: '1. e4 e5', at: 5 });
  // a fresh store, as if the page had been reloaded
  const rows = await build(storage).collection('games').orderBy('at', 'desc').limit(60).get();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].pgn, '1. e4 e5', 'the PGN is what has to survive');
});

ok('newest first, which is the order the loader asks for', async () => {
  const storage = fakeStorage();
  const db = build(storage);
  for (const [id, at] of [['a', 1], ['b', 3], ['c', 2]]) {
    await db.collection('games').doc(id).set({ gid: id, at });
  }
  const rows = await build(storage).collection('games').orderBy('at', 'desc').limit(60).get();
  assert.deepStrictEqual(rows.map(r => r.gid), ['b', 'c', 'a']);
});

ok('the limit is honoured after the sort, not before', async () => {
  const storage = fakeStorage();
  const db = build(storage);
  for (const [id, at] of [['a', 1], ['b', 3], ['c', 2]]) {
    await db.collection('games').doc(id).set({ gid: id, at });
  }
  const rows = await build(storage).collection('games').orderBy('at', 'desc').limit(2).get();
  assert.deepStrictEqual(rows.map(r => r.gid), ['b', 'c'], 'taking the newest two means sorting first');
});

ok('writing a doc twice updates it rather than duplicating it', async () => {
  const storage = fakeStorage();
  const db = build(storage);
  await db.collection('games').doc('g1').set({ gid: 'g1', heroColor: 'w' });
  await db.collection('games').doc('g1').set({ gid: 'g1', heroColor: 'b' });
  const rows = await build(storage).collection('games').limit(60).get();
  assert.strictEqual(rows.length, 1, 'the same id is one row');
  assert.strictEqual(rows[0].heroColor, 'b', 'and the later write wins');
});

ok('deleting an intention removes it and leaves the others', async () => {
  const storage = fakeStorage();
  const db = build(storage);
  await db.collection('intentions').doc('k1').set({ key: 'k1', kind: 'protect' });
  await db.collection('intentions').doc('k2').set({ key: 'k2', kind: 'develop' });
  await db.collection('intentions').doc('k1').delete();
  const rows = await build(storage).collection('intentions').limit(500).get();
  assert.deepStrictEqual(rows.map(r => r.key), ['k2']);
});

ok('collections do not read each other', async () => {
  const storage = fakeStorage();
  const db = build(storage);
  await db.collection('games').doc('x').set({ gid: 'x' });
  await db.collection('intentions').doc('x').set({ key: 'x' });
  assert.strictEqual((await build(storage).collection('games').limit(60).get()).length, 1);
  assert.strictEqual((await build(storage).collection('intentions').limit(500).get()).length, 1);
});

ok('a full quota throws rather than reporting success', async () => {
  const storage = fakeStorage();
  storage.full = true;
  await assert.rejects(
    () => build(storage).collection('games').doc('g1').set({ gid: 'g1', pgn: '1. e4' }),
    'a write that did not happen must not look like one that did');
});

ok('unreadable storage reads as empty instead of throwing', async () => {
  const storage = fakeStorage();
  storage.getItem = () => '{ not json';
  const rows = await build(storage).collection('games').limit(60).get();
  assert.deepStrictEqual(rows, [], 'corrupt storage should not take the page down');
});

process.on('exit', () => {
  console.log(`\n${passed} passed` + (process.exitCode ? ', some failed' : ', 0 failed'));
});

/* ---------- the analysis cache ----------

   Grading costs a few seconds of search per game, and a reload used to pay it
   again every time. Only the four values the search produces are stored — a
   cached verdict would be a stale one shown confidently, so everything
   downstream is replayed through today's applyGrade instead.

   The rule that matters most is the one about not throwing work away: an
   analysis stamped by an older build is still restored, because it cost real
   time and is usually still right. It is flagged, and the review pane offers
   to run it again. Dropping it would be the behaviour that makes people give
   up on the app. */

const { analyzeGame, gradeAll, applyGrade, aggregate } = require('../src/analysis.js');
const { parsePgn } = require('../src/engine.js');

const restoreSrc = (html.match(/\n  function restoreGrades\(g, rec\) \{[\s\S]*?\n  \}\n/) || [])[0];
assert.ok(restoreSrc, 'restoreGrades not found in the built page');

const PGN = '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Bg5 e6 1-0';
const freshGame = () => analyzeGame(parsePgn(PGN)[0], 'w');

function restorer(version) {
  const sandbox = { applyGrade, aggregate, ANALYSIS_V: version, Array };
  vm.createContext(sandbox);
  vm.runInContext(restoreSrc + '\nthis.restoreGrades = restoreGrades;', sandbox);
  return sandbox.restoreGrades;
}

// one real analysis, to be cached and restored
const analysed = freshGame();
gradeAll(analysed.plies, 3);
const record = { gid: 'g', v: 'v1', g: analysed.plies.map(p => p.gradeInput) };
const expected = analysed.plies.map(p => p.grade).join(',');

console.log('\nthe analysis cache:');

ok('a restored analysis grades every ply the same as the search did', () => {
  const g = freshGame();
  assert.ok(g.plies.every(p => p.grade == null), 'a fresh game starts ungraded');
  assert.strictEqual(restorer('v1')(g, record), true);
  assert.strictEqual(g.plies.map(p => p.grade).join(','), expected,
                     'the cache must reproduce the search exactly');
  assert.strictEqual(g.graded, true, 'and the game should not be graded again');
});

ok('an analysis from an older build is kept, and flagged rather than dropped', () => {
  const g = freshGame();
  assert.strictEqual(restorer('v2')(g, record), true, 'an old analysis is still restored');
  assert.strictEqual(g.plies.map(p => p.grade).join(','), expected, 'and is not thrown away');
  assert.strictEqual(g.staleAnalysis, true, 'but it is flagged so the pane can offer to redo it');
});

ok('a current analysis is not flagged', () => {
  const g = freshGame();
  restorer('v1')(g, record);
  assert.strictEqual(g.staleAnalysis, false);
});

ok('a record for different moves is refused rather than misapplied', () => {
  const g = freshGame();
  const short = { gid: 'g', v: 'v1', g: record.g.slice(0, 3) };
  assert.strictEqual(restorer('v1')(g, short), false, 'a ply-count mismatch is a different game');
  assert.ok(!g.graded, 'and must leave the game to be graded properly');
});

ok('a missing or malformed record is refused rather than throwing', () => {
  assert.strictEqual(restorer('v1')(freshGame(), null), false);
  assert.strictEqual(restorer('v1')(freshGame(), { v: 'v1' }), false);
  const holes = { gid: 'g', v: 'v1', g: record.g.map((s, i) => (i === 2 ? null : s)) };
  assert.strictEqual(restorer('v1')(freshGame(), holes), false, 'a hole is not a usable cache');
});

/* ---------- sync ----------

   The network round trip needs a real Supabase project, so what is checked
   here is everything up to the wire: the requests the store shapes, and the
   merge that decides which copy of a document wins.

   The merge is the part worth guarding. It is last-write-wins per document,
   which holds only because these documents are not co-edited — a PGN never
   changes once imported, an analysis is a cache, an intention is one person
   answering one prompt. A rule that silently dropped the newer side would lose
   real work, so both directions are pinned. */

const remoteSrc = (html.match(/\n  function remoteStore\(cfg, owner, token\) \{[\s\S]*?\n  \}\n/) || [])[0];
const mergeSrc  = (html.match(/\n  async function mergeStores\(localDb, remoteDb, collections\) \{[\s\S]*?\n  \}\n/) || [])[0];
assert.ok(remoteSrc, 'remoteStore not found in the built page');
assert.ok(mergeSrc, 'mergeStores not found in the built page');

function remote(onRequest) {
  const calls = [];
  const sandbox = {
    fetch: async (url, opt) => {
      calls.push({ url, ...opt });
      return onRequest ? onRequest(url, opt) : { ok: true, json: async () => [], text: async () => '' };
    },
    encodeURIComponent, JSON, Date, Promise, Map, Object, Error
  };
  vm.createContext(sandbox);
  vm.runInContext(remoteSrc + '\nthis.remoteStore = remoteStore;', sandbox);
  return { db: sandbox.remoteStore({ url: 'https://p.supabase.co/', key: 'anon-key' }, 'OWNER', 'tok'), calls };
}

console.log('\nthe sync store:');

ok('a read is scoped to this owner and this collection', async () => {
  const { db, calls } = remote();
  await db.collection('games').orderBy('at', 'desc').limit(60).get();
  const u = calls[0].url;
  assert.ok(u.includes('owner=eq.OWNER'), 'every read must be scoped to the owner: ' + u);
  assert.ok(u.includes('coll=eq.games'), 'and to the collection: ' + u);
  assert.ok(u.includes('order=at.desc') && u.includes('limit=60'), 'sort and cap belong to the server: ' + u);
});

ok('the credentials the policies rely on are sent', async () => {
  const { db, calls } = remote();
  await db.collection('games').limit(1).get();
  const h = calls[0].headers;
  assert.strictEqual(h['x-sync-owner'], 'OWNER', 'the sync-code policy reads this header');
  assert.strictEqual(h.apikey, 'anon-key');
  assert.strictEqual(h.Authorization, 'Bearer tok', 'a session token outranks the anon key');
});

ok('a write upserts rather than duplicating a document', async () => {
  const { db, calls } = remote();
  await db.collection('games').doc('g1').set({ gid: 'g1', pgn: '1. e4', at: 7 });
  assert.strictEqual(calls[0].method, 'POST');
  assert.ok(calls[0].url.includes('on_conflict=owner,coll,id'), 'the primary key is the conflict target');
  assert.ok(/merge-duplicates/.test(calls[0].headers.Prefer), 'a second write must update, not insert');
  const body = JSON.parse(calls[0].body);
  assert.strictEqual(body.at, 7, 'the document timestamp drives the merge, so it is stored');
  assert.deepStrictEqual(body.data, { gid: 'g1', pgn: '1. e4', at: 7 });
});

ok('a refusal is raised rather than silently read as empty', async () => {
  const { db } = remote(() => ({ ok: false, status: 401, text: async () => 'no' }));
  await assert.rejects(() => db.collection('games').limit(1).get(),
    'a 401 must not look like a project with no games in it');
});

console.log('\nthe merge:');

function fakeDb(rows) {
  const store = new Map(rows.map(r => [r.gid || r.key, r]));
  return {
    store,
    collection() {
      const api = {
        limit() { return api; }, orderBy() { return api; },
        async get() { return [...store.values()]; },
        doc(id) { return { async set(obj) { store.set(id, obj); } }; }
      };
      return api;
    }
  };
}
const merge = (() => {
  const sandbox = { Promise, Map, Object };
  vm.createContext(sandbox);
  vm.runInContext(mergeSrc + '\nthis.mergeStores = mergeStores;', sandbox);
  return sandbox.mergeStores;
})();

ok('a game only this device has is pushed up', async () => {
  const l = fakeDb([{ gid: 'a', at: 1 }]), r = fakeDb([]);
  const res = await merge(l, r, ['games']);
  assert.strictEqual(res.pushed, 1); assert.strictEqual(res.pulled, 0);
  assert.ok(r.store.has('a'), 'the other device must end up with it');
});

ok('a game only another device has is pulled down', async () => {
  const l = fakeDb([]), r = fakeDb([{ gid: 'b', at: 1 }]);
  const res = await merge(l, r, ['games']);
  assert.strictEqual(res.pushed, 0); assert.strictEqual(res.pulled, 1);
  assert.ok(l.store.has('b'), 'this device must end up with it');
});

ok('the newer copy wins, whichever side it is on', async () => {
  const l = fakeDb([{ gid: 'a', at: 9, who: 'local' }]);
  const r = fakeDb([{ gid: 'a', at: 2, who: 'remote' }]);
  await merge(l, r, ['games']);
  assert.strictEqual(r.store.get('a').who, 'local', 'the newer local copy should win');

  const l2 = fakeDb([{ gid: 'a', at: 2, who: 'local' }]);
  const r2 = fakeDb([{ gid: 'a', at: 9, who: 'remote' }]);
  await merge(l2, r2, ['games']);
  assert.strictEqual(l2.store.get('a').who, 'remote', 'and the newer remote copy should win');
});

ok('an identical document is left alone', async () => {
  const l = fakeDb([{ gid: 'a', at: 5 }]), r = fakeDb([{ gid: 'a', at: 5 }]);
  const q = await merge(l, r, ['games']);
  assert.strictEqual(q.pushed, 0); assert.strictEqual(q.pulled, 0);
});

ok('intentions merge on their own key, not a game id', async () => {
  const l = fakeDb([{ key: 'g__4', kind: 'protect', at: 3 }]), r = fakeDb([]);
  await merge(l, r, ['intentions']);
  assert.ok(r.store.has('g__4'), 'an intention is keyed by `key`');
});
