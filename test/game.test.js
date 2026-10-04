/* Which side you played.

   Every pasted game was analysed as White. buildGame fell back to 'w' when it
   could not tell, and the paste handler passed an empty name, so the fallback
   was the only path that ever ran. heroColor feeds aggregate(), so a game you
   played as Black reported your opponent's hang rate, your opponent's blunders
   and an inverted win/loss — silently, with no way to tell from the screen.

   The fix is that "I cannot tell" is now a distinct answer. resolveHero
   returns null rather than guessing, and the caller is what decides to ask.
   That null is the whole point of this file. */

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

const src = (html.match(/\n  function resolveHero\(headers, hint\) \{[\s\S]*?\n  \}\n/) || [])[0];
assert.ok(src, 'resolveHero not found in the built page');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src + '\nthis.resolveHero = resolveHero;', sandbox);
const { resolveHero } = sandbox;

const H = (w, b) => ({ White: w, Black: b });

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}

console.log('which side you played:');

check('an explicit choice is taken as given', () => {
  assert.strictEqual(resolveHero(H('alice', 'bob'), { color: 'b' }), 'b');
  assert.strictEqual(resolveHero(H('alice', 'bob'), { color: 'w' }), 'w');
  // and it outranks a name that says otherwise — you know better than the tags
  assert.strictEqual(resolveHero(H('alice', 'bob'), { color: 'b', name: 'alice' }), 'b');
});

check('a name is matched against both players, not only Black', () => {
  assert.strictEqual(resolveHero(H('alice', 'bob'), { name: 'bob' }), 'b');
  assert.strictEqual(resolveHero(H('alice', 'bob'), { name: 'alice' }), 'w');
});

check('matching ignores case and surrounding space', () => {
  assert.strictEqual(resolveHero(H('Alice', 'BoB'), { name: '  bob ' }), 'b');
  assert.strictEqual(resolveHero(H('Alice', 'BoB'), { name: 'ALICE' }), 'w');
});

check('a name matching neither player is not silently White', () => {
  assert.strictEqual(resolveHero(H('alice', 'bob'), { name: 'carol' }), null,
    'this is the bug: an unrecognised name used to fall through to White');
});

check('no hint at all is unknown, not White', () => {
  for (const hint of [undefined, null, {}, { name: '' }, { name: '   ' }, { color: '' }]) {
    assert.strictEqual(resolveHero(H('alice', 'bob'), hint), null,
      'hint ' + JSON.stringify(hint) + ' should be unknown');
  }
});

check('a nonsense colour is ignored rather than trusted', () => {
  assert.strictEqual(resolveHero(H('alice', 'bob'), { color: 'x' }), null);
  assert.strictEqual(resolveHero(H('alice', 'bob'), { color: 'white' }), null);
  // but it still falls back to the name when there is one
  assert.strictEqual(resolveHero(H('alice', 'bob'), { color: 'x', name: 'bob' }), 'b');
});

check('missing headers do not throw', () => {
  assert.strictEqual(resolveHero({}, { name: 'bob' }), null);
  assert.strictEqual(resolveHero({ White: 'bob' }, { name: 'bob' }), 'w');
  assert.strictEqual(resolveHero({ Black: 'bob' }, { name: 'bob' }), 'b');
});

check('both players sharing a name resolves to White rather than throwing', () => {
  // A real PGN can carry "?" for both. White is the arbitrary-but-stable pick.
  assert.strictEqual(resolveHero(H('?', '?'), { name: '?' }), 'w');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
