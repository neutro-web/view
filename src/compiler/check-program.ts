import * as ts from 'typescript'
import { SyncTargetClassifier } from './sync-target-classifier.js'
import type { ClassifierConfig, CycleReport, TargetVerdict } from './types.js'
import { WriteGraphCycleChecker } from './write-graph-cycle-checker.js'

export interface CheckProgramDiagnostic {
  severity: 'error' | 'warn'
  message: string
  file: string
  line: number
  column: number
  callNode: ts.CallExpression
}

export interface CheckProgramResult {
  verdicts: TargetVerdict[]
  cycles: CycleReport[]
  diagnostics: CheckProgramDiagnostic[]
}

export function checkProgram(program: ts.Program, config: ClassifierConfig): CheckProgramResult {
  // Step 1: classify all sync() calls in the program
  const classifier = new SyncTargetClassifier(config)
  const verdicts = classifier.classifyProgram(program)

  // Step 2: build write-graph and detect cycles
  const checker = new WriteGraphCycleChecker(config)
  const cycles = checker.check(program, verdicts)

  // Step 3: map verdicts and cycles → diagnostics
  const diagnostics: CheckProgramDiagnostic[] = []

  for (const verdict of verdicts) {
    if (verdict.kind === 'REJECT') {
      diagnostics.push(makeDiagnostic('error', verdict.diagnostic, verdict.callNode, program))
    } else if (verdict.kind === 'UNDECIDABLE') {
      diagnostics.push(makeDiagnostic('warn', verdict.reason, verdict.callNode, program))
    }
    // ACCEPT: no diagnostic unless it is part of a cycle (handled below)
  }

  for (const cycle of cycles) {
    const message = `[nv] §8.5.2 write-graph cycle detected: ${cycle.cycle.join(' → ')}`
    for (const callNode of cycle.involvedSyncs) {
      diagnostics.push(makeDiagnostic('error', message, callNode, program))
    }
  }

  return { verdicts, cycles, diagnostics }
}

function makeDiagnostic(
  severity: 'error' | 'warn',
  message: string,
  callNode: ts.CallExpression,
  program: ts.Program,
): CheckProgramDiagnostic {
  const sf = callNode.getSourceFile()
  const pos = ts.getLineAndCharacterOfPosition(sf, callNode.getStart())
  return {
    severity,
    message,
    file: sf.fileName,
    line: pos.line + 1,
    column: pos.character + 1,
    callNode,
  }
}
