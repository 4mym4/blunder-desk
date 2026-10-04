#!/usr/bin/env node
/* Inlines src/engine.js and src/analysis.js into src/app.tmpl.html
   and writes dist/index.html — a single self-contained page with no
   runtime dependencies. */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');

function stripNodeExports(src) {
  return src
    .replace(/\/\* -+ exports[\s\S]*$/m, '')
    .replace(/if \(typeof module !== 'undefined' && module\.exports\) \{[\s\S]*?\n\}\n?/g, '')
    .trim();
}

const engine = stripNodeExports(fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8'));

// In the page every module shares one scope, so each interop header that
// exists only to bridge Node and the browser is stripped out.
function stripInterop(src, re) { return stripNodeExports(src.replace(re, '')); }

const tactics = stripInterop(
  fs.readFileSync(path.join(SRC, 'tactics.js'), 'utf8'),
  /const T_ENG = [\s\S]*?const tswap = [^\n]*\n/);

const commentary = stripInterop(
  fs.readFileSync(path.join(SRC, 'commentary.js'), 'utf8'),
  /const C_ENG = [\s\S]*?const CSQUARES = [^\n]*\n/);

let analysis = fs.readFileSync(path.join(SRC, 'analysis.js'), 'utf8');
analysis = analysis.replace(/const TAC = [\s\S]*?const swapColor = [^\n]*\n/, '');
analysis = stripNodeExports(analysis);

// Aliases the stripped interop headers used to provide. These are `const`,
// so each block must come AFTER the module that defines what it aliases —
// otherwise it reads a binding in its temporal dead zone.
const shimA = [                       // engine aliases, used by tactics
  'const swapColor = swap;',
  'const TSQUARES = SQUARES, talgebraic = algebraic;',
  'const TVALUE = VALUE, TBITS = BITS, tswap = swap;'
].join('\n');
const shimB = [                       // engine + tactics aliases, used by commentary
  'const CSQUARES = SQUARES;',
  'const C_ENG = { BITS, Position, VALUE, SQUARES };'
].join('\n');
const shimC = [                       // module objects, used by analysis
  'const TAC = { findMotifs, searchBest, bestLine, isMateScore, mateIn, evalPos };',
  'const COM = { describeMove, gradeFor, commentFor, GRADES, NAME };'
].join('\n');

let html = fs.readFileSync(path.join(SRC, 'app.tmpl.html'), 'utf8');
html = html.replace('/*__ENGINE__*/', () => engine);
html = html.replace('/*__SHIM_A__*/', () => shimA);
html = html.replace('/*__TACTICS__*/', () => tactics);
html = html.replace('/*__SHIM_B__*/', () => shimB);
html = html.replace('/*__COMMENTARY__*/', () => commentary);
html = html.replace('/*__SHIM_C__*/', () => shimC);
html = html.replace('/*__ANALYSIS__*/', () => analysis);

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'index.html'), html);

for (const name of ['Position', 'SQUARES', 'algebraic', 'VALUE', 'BITS', 'clockToSeconds', 'swap', 'parsePgn']) {
  if (!new RegExp(`(function|const|class|let)\\s+${name}\\b`).test(engine)) {
    console.error('MISSING in engine bundle:', name); process.exit(1);
  }
}
for (const name of ['searchBest', 'bestLine', 'findMotifs', 'isMateScore', 'evalPos']) {
  if (!new RegExp(`function\\s+${name}\\b`).test(tactics)) {
    console.error('MISSING in tactics bundle:', name); process.exit(1);
  }
}
for (const name of ['gradeFor', 'commentFor', 'describeMove']) {
  if (!new RegExp(`function\\s+${name}\\b`).test(commentary)) {
    console.error('MISSING in commentary bundle:', name); process.exit(1);
  }
}
for (const marker of ['__ENGINE__', '__TACTICS__', '__COMMENTARY__',
                      '__SHIM_A__', '__SHIM_B__', '__SHIM_C__', '__ANALYSIS__']) {
  if (html.includes(marker)) { console.error('build marker left unreplaced:', marker); process.exit(1); }
}
if (/module\.exports/.test(html)) { console.error('module.exports leaked into the page'); process.exit(1); }
if (/\brequire\(/.test(html)) { console.error('require() leaked into the page'); process.exit(1); }

console.log(`built dist/index.html — ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB, 0 dependencies`);
