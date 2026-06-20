/**
 * nv esbuild Plugin
 * Stream: (3) Renderer/templating
 * Spec: docs/design/build-pipeline-modeA-spec.md §8
 *
 * Thin wrapper: onLoad .nv → parseNvFileForEmit → emitModule → { contents, loader: 'js' }.
 * All logic lives in emitModule. This plugin is only I/O glue.
 */

import { readFile } from 'node:fs/promises'
import type { Plugin } from 'esbuild'
import { JSDOM } from 'jsdom'
import { emitModule } from './nv-emitter.js'
import { parseNvFileForEmit } from './nv-parser.js'

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
        const contents = emitModule(results)

        return { contents, loader: 'js' }
      })
    },
  }
}
