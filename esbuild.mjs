import * as esbuild from 'esbuild';
import { rmSync } from 'node:fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
};

/** @type {esbuild.BuildOptions} */
const extension = {
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
};

/** @type {esbuild.BuildOptions} */
const webview = {
  ...common,
  entryPoints: { main: 'webview/main.ts' },
  outdir: 'dist/webview',
  // ESM + splitting keeps heavy, rarely used code (mermaid, language modes) in lazy chunks.
  format: 'esm',
  splitting: true,
  platform: 'browser',
  target: 'es2022',
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  loader: {
    '.woff': 'file',
    '.woff2': 'file',
    '.ttf': 'file',
  },
};

rmSync('dist', { recursive: true, force: true });

if (watch) {
  const contexts = await Promise.all([esbuild.context(extension), esbuild.context(webview)]);
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all([esbuild.build(extension), esbuild.build(webview)]);
}
