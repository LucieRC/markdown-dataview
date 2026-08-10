/**
 * Build script for the test suite.
 *
 * Bundles every '*.test.ts' file under src/test/ into dist/test/ (CJS,
 * platform=node) so `npm test` can run them with Node's built-in runner
 * (`node --test`). The `vscode` module is aliased to a stub so markdown-it
 * plugin tests can run outside the extension host.
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, 'src');
const TEST_SRC = path.join(SRC, 'test');
const OUTDIR = path.resolve(__dirname, 'dist');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

const testFiles = fs.existsSync(TEST_SRC) ? walk(TEST_SRC) : [];
if (testFiles.length === 0) {
  console.error('No test files found under src/test/');
  process.exit(1);
}

const entryPoints = testFiles.map((f) => ({
  in: f,
  // e.g. src/test/query/engine.test.ts -> dist/test/query/engine.test
  out: path.join('test', path.relative(TEST_SRC, f)).replace(/\.ts$/, ''),
}));

esbuild
  .build({
    entryPoints,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outdir: OUTDIR,
    sourcemap: false,
    sourcesContent: false,
    logLevel: 'info',
    // Redirect `import 'vscode'` to the stub so plugin tests run in plain Node.
    alias: {
      vscode: path.join(TEST_SRC, 'stubs', 'vscode.ts'),
    },
  })
  .then(() => console.log(`[esbuild-test] Bundled ${testFiles.length} test file(s) -> dist/test/`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
