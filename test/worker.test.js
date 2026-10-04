/* The worker runs a second copy of the grading logic, in a scope with no
   module system and no DOM. The only thing that matters is that it agrees
   with gradePly — a silent drift here would grade the browser differently
   from the tests. Runs the real #bd-core text out of the built page. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { parsePgn, Position } = require('../src/engine.js');
const { analyzeGame, gradePly, applyGrade, REFUTE_AT } = require('../src/analysis.js');

const DIST = path.join(__dirname, '..', 'dist', 'index.html');
if (!fs.existsSync(DIST)) {
  console.log('dist/index.html missing — run `npm run build` first');
  process.exit(1);
}
const html = fs.readFileSync(DIST, 'utf8');

const core = (html.match(/<script id="bd-core">([\s\S]*?)<\/script>/) || [])[1];
assert.ok(core, '#bd-core script not found in the built page');
assert.ok(!/document\.|window\.|localStorage/.test(core), 'core must not touch the DOM; a worker has none');

// The exact glue the page concatenates onto the core.
const glue = (html.match(/const glue = `([\s\S]*?)`;/) || [])[1];
assert.ok(glue, 'worker glue not found in the built page');

const sent = [];
const sandbox = { postMessage: m => sent.push(m), onmessage: null };
vm.createContext(sandbox);
vm.runInContext(core + '\n' + glue, sandbox);
assert.strictEqual(typeof sandbox.onmessage, 'function', 'glue did not install an onmessage handler');

// The sample the analysis suite already exercises: a real game with hangs,
// recaptures and a refutation-worthy blunder, so the branch in the glue runs.
const PGN = fs.readFileSync(path.join(__dirname, 'analysis.test.js'), 'utf8')
  .match(/const SAMPLE = `([\s\S]*?)`;/)[1];

const game = analyzeGame(parsePgn(PGN)[0], 'w');
assert.ok(!game.error, game.error);

let checked = 0, mismatches = 0, refuted = 0;
for (const ply of game.plies) {
  // sync reference
  const ref = gradePly(JSON.parse(JSON.stringify(ply)), 3);

  // worker path, through the real message protocol
  sent.length = 0;
  sandbox.onmessage({
    data: {
      id: 1, fenBefore: ply.fenBefore, fenAfter: ply.fenAfter,
      san: ply.san, depth: 3, refuteAt: REFUTE_AT
    }
  });
  assert.strictEqual(sent.length, 1, 'worker did not post exactly one reply');
  const r = sent[0];
  if (r.refutation) refuted++;
  const viaWorker = applyGrade(JSON.parse(JSON.stringify(ply)), r.best, r.score, r.played, r.refutation);

  const same = ['grade', 'comment', 'swing', 'bestSan', 'refutation', 'missedTactic', 'staticOverridden']
    .every(k => JSON.stringify(ref[k]) === JSON.stringify(viaWorker[k]));
  checked++;
  if (!same) {
    mismatches++;
    console.log(`  FAIL ${ply.san}`);
    for (const k of ['grade', 'comment', 'swing', 'bestSan', 'refutation']) {
      if (JSON.stringify(ref[k]) !== JSON.stringify(viaWorker[k])) {
        console.log(`       ${k}: sync ${JSON.stringify(ref[k])} vs worker ${JSON.stringify(viaWorker[k])}`);
      }
    }
  }
}

console.log(`worker/sync parity: ${checked - mismatches}/${checked} plies identical, ${refuted} took the refutation branch`);
assert.ok(refuted > 0, 'no ply triggered the second search — the refutation branch went untested');
if (mismatches) process.exit(1);
console.log('worker search agrees with gradePly on every ply');
