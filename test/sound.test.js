/* What a move should sound like.

   The audio graph itself cannot be tested without a device, but the decision
   layer can: soundPlan() is pure, takes a ply and returns the cues to play
   with every parameter already computed. That is where the design actually
   lives — which piece sounds how, how much louder a queen is than a pawn,
   what a blunder adds — so that is what gets pinned here.

   Extracted from the built page the same way worker.test.js and
   board.test.js do it. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { VALUE } = require('../src/engine.js');

const DIST = path.join(__dirname, '..', 'dist', 'index.html');
if (!fs.existsSync(DIST)) {
  console.log('dist/index.html missing — run `npm run build` first');
  process.exit(1);
}
const html = fs.readFileSync(DIST, 'utf8');

const grab = (re, name) => {
  const m = html.match(re);
  assert.ok(m, name + ' not found in the built page');
  return m[0];
};
const src = grab(/\n  const PIECE_VOICE = \{[\s\S]*?\n  \}\n/, 'PIECE_VOICE')
          + grab(/\n  function captureVoice\(type\) \{[\s\S]*?\n  \}\n/, 'captureVoice')
          + grab(/\n  function panForSquare\(sq\) \{[\s\S]*?\n  \}\n/, 'panForSquare')
          + grab(/\n  function soundPlan\(ply, opts\) \{[\s\S]*?\n  \}\n/, 'soundPlan');

const sandbox = { VALUE };
vm.createContext(sandbox);
vm.runInContext(src + '\nthis.soundPlan = soundPlan; this.captureVoice = captureVoice;'
                    + '\nthis.panForSquare = panForSquare; this.PIECE_VOICE = PIECE_VOICE;', sandbox);
const { soundPlan, captureVoice, panForSquare, PIECE_VOICE } = sandbox;

/* A ply with only the fields soundPlan reads. */
const ply = o => Object.assign({
  san: 'Nf3', piece: 'n', from: 'g1', to: 'f3', captured: null, isHero: true,
  motifs: {}, tags: [], grade: null, severity: null, mateDelivered: false
}, o);
const plan = (o, opts) => soundPlan(ply(o), opts || {});
// p.cues is built inside the vm realm, so its Array.prototype is not this
// realm's — deepStrictEqual compares prototypes. Re-home before comparing.
const cuesOf = (p, type) => Array.from(p.cues).filter(c => c.type === type);
const db = (a, b) => 20 * Math.log10(a / b);

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}

console.log('capture weight follows the piece:');

check('a queen comes off the board far heavier than a pawn', () => {
  const p = captureVoice('p'), q = captureVoice('q');
  assert.ok(db(q.gain, p.gain) >= 10,
    `queen is only ${db(q.gain, p.gain).toFixed(1)} dB over a pawn; the old mapping's 3.5 dB was the complaint`);
  assert.ok(q.freq < p.freq - 60, 'a queen should land much lower than a pawn');
  assert.ok(q.dur > p.dur * 2, 'a queen should ring far longer than a pawn');
  assert.ok(q.cut < p.cut, 'a queen should be darker than a pawn');
});

check('weight is monotonic across every piece the engine values', () => {
  const order = ['p', 'n', 'b', 'r', 'q'];
  for (let i = 1; i < order.length; i++) {
    const lo = captureVoice(order[i - 1]), hi = captureVoice(order[i]);
    assert.ok(VALUE[order[i]] > VALUE[order[i - 1]], 'fixture order must follow VALUE');
    assert.ok(hi.gain >= lo.gain, `${order[i]} should not be quieter than ${order[i - 1]}`);
    assert.ok(hi.freq <= lo.freq, `${order[i]} should not be higher than ${order[i - 1]}`);
    assert.ok(hi.dur >= lo.dur, `${order[i]} should not ring shorter than ${order[i - 1]}`);
  }
});

check('an unknown piece falls back to pawn weight rather than NaN', () => {
  const v = captureVoice('z');
  for (const k of ['freq', 'dur', 'gain', 'cut']) assert.ok(Number.isFinite(v[k]), k + ' is not finite');
});

console.log('\neach piece has its own voice:');

check('every piece type is distinguishable from every other', () => {
  const seen = new Set();
  for (const t of ['p', 'n', 'b', 'r', 'q', 'k']) {
    const v = PIECE_VOICE[t];
    assert.ok(v, 'no voice for ' + t);
    const sig = v.wave + '@' + v.freq;
    assert.ok(!seen.has(sig), `${t} shares a voice with another piece (${sig})`);
    seen.add(sig);
  }
});

check('the knight bends up through its move, everything else settles down', () => {
  assert.ok(PIECE_VOICE.n.bend > 1, 'the knight turns a corner — its tone should rise');
  for (const t of ['p', 'b', 'r', 'q', 'k']) {
    assert.ok(PIECE_VOICE[t].bend < 1, `${t} should settle downward`);
  }
});

check('a quiet move plays its piece and nothing else', () => {
  const p = plan({ san: 'Nf3', piece: 'n' });
  assert.deepStrictEqual(Array.from(p.cues).map(c => c.type), ['body']);
  assert.strictEqual(cuesOf(p, 'body')[0].wave, PIECE_VOICE.n.wave);
});

console.log('\nwhere it happened:');

check('pan follows the file, left to right', () => {
  const a = panForSquare('a1'), e = panForSquare('e4'), h = panForSquare('h8');
  assert.ok(a < -0.3, 'the a-file should sit left, got ' + a);
  assert.ok(h > 0.3, 'the h-file should sit right, got ' + h);
  assert.ok(Math.abs(e) < 0.2, 'the centre files should sit near the middle, got ' + e);
  assert.ok(a >= -1 && h <= 1, 'pan must stay in range');
});

check('the plan pans to the destination square', () => {
  assert.ok(plan({ to: 'a4' }).pan < -0.3);
  assert.ok(plan({ to: 'h4' }).pan > 0.3);
});

check('a missing or malformed square pans to centre rather than NaN', () => {
  for (const sq of [undefined, null, '', 'zz', '9']) {
    const v = panForSquare(sq);
    assert.ok(Number.isFinite(v), `pan for ${JSON.stringify(sq)} is not finite`);
    assert.strictEqual(v, 0);
  }
});

console.log('\nmoves that are not just a move:');

check('a capture adds a capture cue carrying the victim weight', () => {
  const p = plan({ san: 'Nxe5', captured: 'q' });
  const c = cuesOf(p, 'capture');
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].gain, captureVoice('q').gain);
});

check('castling knocks twice — king then rook', () => {
  const p = plan({ san: 'O-O', piece: 'k', from: 'e1', to: 'g1' });
  const b = cuesOf(p, 'body');
  assert.strictEqual(b.length, 2, 'castling moves two pieces, so it should sound like two');
  assert.strictEqual(b[0].delay || 0, 0);
  assert.ok(b[1].delay > 0, 'the rook should follow the king, not land on top of it');
});

check('queenside castling also knocks twice', () => {
  assert.strictEqual(cuesOf(plan({ san: 'O-O-O', piece: 'k' }), 'body').length, 2);
});

check('promotion adds a rising figure', () => {
  assert.strictEqual(cuesOf(plan({ san: 'a8=Q', piece: 'p' }), 'promote').length, 1);
  assert.strictEqual(cuesOf(plan({ san: 'a7', piece: 'p' }), 'promote').length, 0);
});

check('check rings, and mate replaces it rather than stacking', () => {
  const ck = plan({ san: 'Qh5+', motifs: { check: true } });
  assert.strictEqual(cuesOf(ck, 'check').length, 1);
  assert.strictEqual(cuesOf(ck, 'mate').length, 0);
  const mate = plan({ san: 'Qh7#', motifs: { check: true }, mateDelivered: true });
  assert.strictEqual(cuesOf(mate, 'mate').length, 1);
  assert.strictEqual(cuesOf(mate, 'check').length, 0, 'mate should not also play the unresolved check ring');
});

check('each detected motif rings once', () => {
  const p = plan({ motifs: { fork: { square: 'e5' }, pins: [{ square: 'c6' }], skewers: [], discovered: null } });
  const kinds = cuesOf(p, 'motif').map(c => c.kind).sort();
  assert.deepStrictEqual(kinds, ['fork', 'pin']);
});

console.log('\nthe verdict, which is what this product is for:');

check('your own blunder lands wrong; the same move by the opponent does not', () => {
  const mine = plan({ isHero: true, grade: 'blunder' });
  const theirs = plan({ isHero: false, grade: 'blunder' });
  assert.strictEqual(cuesOf(mine, 'verdict').length, 1);
  assert.strictEqual(cuesOf(theirs, 'verdict').length, 0,
    'the desk reviews your moves — their blunder is not your verdict');
});

check('a mistake weighs less than a blunder', () => {
  const bl = cuesOf(plan({ isHero: true, grade: 'blunder' }), 'verdict')[0];
  const mi = cuesOf(plan({ isHero: true, grade: 'mistake' }), 'verdict')[0];
  assert.ok(bl.weight > mi.weight, 'a blunder should land harder than a mistake');
});

check('a clean move carries no verdict', () => {
  for (const g of ['best', 'strong', 'solid', 'book', null]) {
    assert.strictEqual(cuesOf(plan({ isHero: true, grade: g }), 'verdict').length, 0, 'grade ' + g);
  }
});

check('a piece left hanging leaves a ring that does not resolve', () => {
  for (const tag of ['hung_piece', 'left_behind', 'unresolved_hang']) {
    assert.strictEqual(cuesOf(plan({ isHero: true, tags: [tag] }), 'loose').length, 1, tag);
  }
  assert.strictEqual(cuesOf(plan({ isHero: true, tags: ['good_capture'] }), 'loose').length, 0);
  assert.strictEqual(cuesOf(plan({ isHero: false, tags: ['hung_piece'] }), 'loose').length, 0,
    'their hanging piece is not the thing being reviewed');
});

check('the opponent is darker and quieter than you, so the two read apart', () => {
  const mine = cuesOf(plan({ isHero: true }), 'body')[0];
  const theirs = cuesOf(plan({ isHero: false }), 'body')[0];
  assert.ok(theirs.cut < mine.cut, "the opponent's moves should be duller");
  assert.ok(theirs.gain < mine.gain, "the opponent's moves should sit back");
});

console.log('\nstepping backward:');

check('going back is the same move, quieter', () => {
  const fwd = plan({ san: 'Nxe5', captured: 'r' });
  const back = plan({ san: 'Nxe5', captured: 'r' }, { back: true });
  assert.deepStrictEqual(back.cues.map(c => c.type), fwd.cues.map(c => c.type));
  for (let i = 0; i < fwd.cues.length; i++) {
    if (fwd.cues[i].gain == null) continue;
    assert.ok(back.cues[i].gain < fwd.cues[i].gain, 'cue ' + i + ' should be quieter going back');
  }
});

check('every cue a plan can emit carries a finite gain and delay', () => {
  const p = plan({ san: 'Qxh7#', piece: 'q', captured: 'r', isHero: true, grade: 'blunder',
                   tags: ['hung_piece'], mateDelivered: true,
                   motifs: { check: true, fork: { square: 'e5' }, pins: [], skewers: [], discovered: null } });
  assert.ok(p.cues.length >= 5, 'a loaded ply should produce a full stack, got ' + p.cues.length);
  for (const c of p.cues) {
    assert.ok(Number.isFinite(c.gain), c.type + ' has a non-finite gain');
    assert.ok(Number.isFinite(c.delay || 0), c.type + ' has a non-finite delay');
    assert.ok(c.gain > 0 && c.gain <= 1, c.type + ' gain out of range: ' + c.gain);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
