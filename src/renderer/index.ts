// @neutro/view/renderer — consumes the reactive core; turns a Template IR into
// live DOM with fine-grained bindings. Web Components are a compile target, not
// the model. (Compiler back-end for the IR is deferred — see ROADMAP.)
export { mount } from './interpreter'
export { createHtmlTag } from './html-tag'
export { structurallyEqual } from './comparator'

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
} from './ir'

export type { CompareResult } from './comparator'
