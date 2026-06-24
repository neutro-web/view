/**
 * nv Compiler Tests — Test Helpers
 * Creates TypeScript programs from fixture source strings using the real core.ts.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as ts from 'typescript'
import { SyncTargetClassifier } from '../../src/compiler/sync-target-classifier.js'
import type { ClassifierConfig, TargetVerdict } from '../../src/compiler/types.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const _dir = path.dirname(new URL(import.meta.url).pathname)

/** Absolute path to the nv core implementation in the project. */
export const PROJECT_CORE_PATH = path.resolve(_dir, '../../src/core/core.ts')

// ── Temp directory management ─────────────────────────────────────────────────

let _tmpDir: string | null = null
function getTmpDir(): string {
  if (!_tmpDir) {
    _tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-compiler-test-'))
  }
  return _tmpDir
}

/**
 * Copy core.ts into the test temp dir once. Fixture files import from it
 * using the relative path './core'. Both reside in the same directory.
 */
let _nvCoreInTmp: string | null = null
export function nvCoreInTmp(): string {
  if (_nvCoreInTmp) return _nvCoreInTmp
  const dir = getTmpDir()
  const dest = path.join(dir, 'core.ts')
  fs.copyFileSync(PROJECT_CORE_PATH, dest)
  _nvCoreInTmp = dest
  return dest
}

// ── TypeScript compiler options ───────────────────────────────────────────────

export const TEST_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  esModuleInterop: true,
}

// ── Program builder ───────────────────────────────────────────────────────────

let _fixtureCounter = 0

/**
 * Write a fixture source string to a temp file and create a TypeScript program
 * containing both the fixture and core.ts.
 *
 * The fixture should import from '@nv/core':
 *   import { signal, sync } from '@nv/core'
 *
 * This helper replaces that alias with a relative path to the core.ts copy in
 * the temp directory so TypeScript can resolve it normally.
 *
 * Returns the program and the nvCorePath for use in ClassifierConfig.
 */
export function makeTestProgram(fixtureSource: string): {
  program: ts.Program
  nvCorePath: string
  fixtureFile: string
} {
  const nvCorePath = nvCoreInTmp()
  const dir = getTmpDir()

  // Replace @nv/core alias with a path relative to the fixture's location
  // (both are in the same temp dir, so just './core')
  const resolved = fixtureSource.replace(/from\s+['"]@nv\/core['"]/g, `from './core'`)

  const fixtureName = `fixture_${_fixtureCounter++}.ts`
  const fixturePath = path.join(dir, fixtureName)
  fs.writeFileSync(fixturePath, resolved, 'utf-8')

  const program = ts.createProgram([nvCorePath, fixturePath], TEST_COMPILER_OPTIONS)
  return { program, nvCorePath, fixtureFile: fixturePath }
}

/**
 * Shorthand: build program from fixture source and return all sync() verdicts.
 * Filters to verdicts produced from the FIXTURE file only (not from core.ts itself).
 */
export function getVerdicts(fixtureSource: string): TargetVerdict[] {
  const { program, nvCorePath, fixtureFile } = makeTestProgram(fixtureSource)
  const config: ClassifierConfig = { nvCorePath }
  const classifier = new SyncTargetClassifier(config)
  // Classify full program but filter to fixture file only
  const checker = program.getTypeChecker()
  const sf = program.getSourceFile(fixtureFile)
  if (!sf) throw new Error(`source file not found: ${fixtureFile}`)

  const results: TargetVerdict[] = []
  const c = new SyncTargetClassifier(config)

  // Access private visitNode via class method — use classifyProgram filtered
  // by iterating the source file directly
  ;(function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const v = c.classifyCall(node, checker)
      if (v !== null) results.push(v)
    }
    ts.forEachChild(node, visit)
  })(sf)

  return results
}
