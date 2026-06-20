/**
 * Playwright globalSetup — builds the nv bundle before any tests run.
 * esbuild bundles src/ into an IIFE exposed as window.__nv.
 */

import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default async function globalSetup() {
  const outDir = join(__dirname, 'dist')
  await mkdir(outDir, { recursive: true })

  await esbuild.build({
    entryPoints: [join(__dirname, 'nv-entry.ts')],
    bundle: true,
    outfile: join(outDir, 'nv-bundle.js'),
    format: 'iife',
    globalName: '__nv',
    platform: 'browser',
    target: 'es2022',
    plugins: [
      {
        name: 'ts-resolve',
        setup(build) {
          // nodenext repos use .js specifiers pointing to .ts sources.
          // Return an absolute path to avoid resolveDir restriction.
          build.onResolve({ filter: /\.js$/ }, (args) => {
            const absTs = resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts'))
            return { path: absTs }
          })
        },
      },
    ],
    sourcemap: true,
    minify: false,
  })
}
