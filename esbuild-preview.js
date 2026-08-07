const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  // Bundle preview scripts (IIFE for webview)
  const previewCtx = await esbuild.context({
    entryPoints: ['src/preview/index.ts'],
    bundle: true,
    format: 'iife',
    minify: production,
    sourcemap: false,
    platform: 'browser',
    target: ['es2022'],
    outfile: 'dist/preview.js',
    logLevel: 'info',
  });

  // Bundle preview CSS
  const cssCtx = await esbuild.context({
    entryPoints: ['src/preview/styles.css'],
    bundle: true,
    minify: production,
    loader: { '.css': 'css' },
    outfile: 'dist/preview.css',
    logLevel: 'info',
  });

  if (watch) {
    await Promise.all([previewCtx.watch(), cssCtx.watch()]);
  } else {
    await Promise.all([previewCtx.rebuild(), cssCtx.rebuild()]);
    await previewCtx.dispose();
    await cssCtx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
