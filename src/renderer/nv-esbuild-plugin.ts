/**
 * nv esbuild Plugin
 * Stream: (3) Renderer/templating
 * Spec: docs/design/build-pipeline-modeA-spec.md §8
 *
 * Thin wrapper: onLoad .nv → parseNvFileForEmit → emitModule → { contents, loader: 'js' }.
 * All logic lives in emitModule. This plugin is only I/O glue.
 *
 * Specifier rewriting (§D-2):
 * When a .nv file imports from another .nv file, the emitted JS contains
 * `import { X } from './other.nv'`. The plugin rewrites this to `.js` so
 * the bundler can resolve the already-emitted peer module.
 */

import { readFile } from 'node:fs/promises'
import type { Plugin } from 'esbuild'
import { JSDOM } from 'jsdom'
import { emitModule } from './nv-emitter.js'
import { parseNvFileForEmit } from './nv-parser.js'

/**
 * Rewrite .nv import specifiers to .js in emitted module source.
 *
 * Matches `from '..path.nv'` and `from "..path.nv"` and rewrites to .js.
 * Example: `import { Counter } from './counter.nv'` → `import { Counter } from './counter.js'`
 *
 * Note: regex-based; does not skip comment lines. Avoid commenting out `.nv` imports.
 *
 * @param src  ES module source text (output of emitModule)
 * @returns    Source with .nv specifiers rewritten to .js
 */
export function rewriteNvSpecifiers(src: string): string {
  return src.replace(/(from\s+['"])([^'"]+)\.nv(['"])/g, '$1$2.js$3')
}

/**
 * Returns an esbuild plugin that transforms .nv files to JavaScript.
 *
 * Usage:
 *   esbuild.build({ plugins: [nvPlugin()], ... })
 */
export function nvPlugin(): Plugin {
  return {
    name: 'nv',
    setup(build) {
      build.onLoad({ filter: /\.nv$/ }, async (args) => {
        const source = await readFile(args.path, 'utf-8')
        const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
        const doc = dom.window.document as unknown as Document

        const results = parseNvFileForEmit(source, args.path, doc)
        let contents = emitModule(results)

        // Rewrite .nv import specifiers to .js for bundler resolution
        contents = rewriteNvSpecifiers(contents)

        return { contents, loader: 'js' }
      })
    },
  }
}
