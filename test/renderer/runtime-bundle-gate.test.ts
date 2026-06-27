/**
 * G1/G2 size gate — @neutro/view/renderer/runtime must not pull the TS compiler.
 *
 * G1: bundle src/renderer/runtime.ts standalone; assert no 'typescript' in the
 *     module graph and unminified size < 200 KB.
 * G2: bundle an emitted counter module through the full emitter path; assert the
 *     metafile has no 'typescript' input and the import resolves to runtime.ts.
 *
 * Fails closed: if typescript re-enters the runtime graph, both gates fire.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as esbuild from 'esbuild'
import { JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'
import { emitModule } from '../../src/renderer/nv-emitter.js'
import { parseNvFileForEmit } from '../../src/renderer/nv-parser.js'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const coreIndexPath = path.join(repoRoot, 'src/core/index.ts')
const rendererIndexPath = path.join(repoRoot, 'src/renderer/index.ts')
const rendererRuntimePath = path.join(repoRoot, 'src/renderer/runtime.ts')

const neutroAlias = {
  name: 'neutro-alias',
  setup(build: esbuild.PluginBuild) {
    build.onResolve({ filter: /^@neutro\/view\/core$/ }, () => ({ path: coreIndexPath }))
    build.onResolve({ filter: /^@neutro\/view\/renderer$/ }, () => ({ path: rendererIndexPath }))
    build.onResolve({ filter: /^@neutro\/view\/renderer\/runtime$/ }, () => ({
      path: rendererRuntimePath,
    }))
  },
}

const tsResolve = {
  name: 'ts-resolve',
  setup(build: esbuild.PluginBuild) {
    build.onResolve({ filter: /\.js$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts')),
    }))
  },
}

// ── G1 — runtime entry standalone ────────────────────────────────────────────

describe('G1 — @neutro/view/renderer/runtime is TS-compiler-free', () => {
  test('no typescript in module graph', async () => {
    const outfile = path.join(os.tmpdir(), `nv-runtime-gate-${crypto.randomUUID()}.js`)
    try {
      const result = await esbuild.build({
        entryPoints: [rendererRuntimePath],
        bundle: true,
        outfile,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        minify: false,
        metafile: true,
        plugins: [tsResolve],
      })

      const inputs = Object.keys(result.metafile.inputs)
      const tsInputs = inputs.filter((p) => p.includes('typescript'))
      expect(
        tsInputs,
        'G1: typescript must not appear in the runtime bundle module graph',
      ).toHaveLength(0)

      const bundleBytes = fs.statSync(outfile).size
      console.log(`G1: runtime bundle size = ${(bundleBytes / 1024).toFixed(1)} KB`)
      expect(
        bundleBytes,
        'G1: runtime bundle must be < 200 KB unminified (TS compiler exclusion tripwire)',
      ).toBeLessThan(200 * 1024)
    } finally {
      try {
        fs.unlinkSync(outfile)
      } catch {
        /* ignore */
      }
    }
  })
})

// ── G2 — emitted counter bundle is clean ─────────────────────────────────────

describe('G2 — emitted counter bundle has no TS compiler', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
  const doc = dom.window.document as unknown as Document

  const counterSource = `
const Counter = $component(() => {
  $script(() => {
    const count = signal(0)
  })
  $render(() => html\`<span>\${count}</span><button @click="\${() => count = count + 1}">+</button>\`)
})`

  test('emitter targets @neutro/view/renderer/runtime', () => {
    const results = parseNvFileForEmit(counterSource, 'counter.nv', doc)
    const js = emitModule(results)
    expect(js).toContain("from '@neutro/view/renderer/runtime'")
    expect(js).not.toContain("from '@neutro/view/renderer'")
  })

  test('no typescript in emitted bundle module graph', async () => {
    const results = parseNvFileForEmit(counterSource, 'counter.nv', doc)
    const js = emitModule(results)

    const entryFile = path.join(os.tmpdir(), `nv-counter-entry-${crypto.randomUUID()}.mjs`)
    const outfile = path.join(os.tmpdir(), `nv-counter-bundle-${crypto.randomUUID()}.js`)
    const withFlushSync = `${js}\nexport { flushSync } from '@neutro/view/core'\n`
    fs.writeFileSync(entryFile, withFlushSync)

    try {
      const result = await esbuild.build({
        entryPoints: [entryFile],
        bundle: true,
        outfile,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        minify: false,
        metafile: true,
        plugins: [tsResolve, neutroAlias],
      })

      const inputs = Object.keys(result.metafile.inputs)
      const tsInputs = inputs.filter((p) => p.includes('typescript'))
      expect(
        tsInputs,
        'G2: typescript must not appear in the emitted counter bundle module graph',
      ).toHaveLength(0)

      const runtimeInputs = inputs.filter((p) => p.includes('runtime.ts'))
      expect(
        runtimeInputs.length,
        'G2: runtime.ts must appear in the bundle graph (mount resolved from runtime entry)',
      ).toBeGreaterThan(0)

      const bundleBytes = fs.statSync(outfile).size
      console.log(`G2: emitted counter bundle size = ${(bundleBytes / 1024).toFixed(1)} KB`)
      expect(bundleBytes, 'G2: emitted counter bundle must be < 200 KB unminified').toBeLessThan(
        200 * 1024,
      )
    } finally {
      try {
        fs.unlinkSync(entryFile)
      } catch {
        /* ignore */
      }
      try {
        fs.unlinkSync(outfile)
      } catch {
        /* ignore */
      }
    }
  })
})
