// @neutro/view/renderer — consumes the reactive core; turns a Template IR into
// live DOM with fine-grained bindings. Web Components are a compile target, not
// the model. (Compiler back-end for the IR is deferred — see ROADMAP.)
export { mount } from './interpreter.js'
export { createHtmlTag } from './html-tag.js'
export { structurallyEqual } from './comparator.js'

export type {
  TemplateIR,
  TemplateShape,
  TemplateMeta,
  NodePath,
  SourceSpan,
  Binding,
  BaseBinding,
  TextBinding,
  AttrBinding,
  PropBinding,
  EventBinding,
  ChildBinding,
  ConditionalBinding,
  ListBinding,
  SyncBinding,
  ReactiveExpr,
  HandlerExpr,
} from './ir.js'

export type { CompareResult } from './comparator.js'

export { parseNvFile, parseNvFileForEmit, preprocessMutationWrites } from './nv-parser.js'
export type {
  NvComponentResult,
  NvDiagnostic,
  NvEmitPayload,
  NvStyleInfo,
  ThunkSource,
} from './nv-parser.js'
