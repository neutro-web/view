/**
 * nv Tagged-Template Front-End
 * Stream: (3) Renderer/templating
 * IR contract: nv-template-ir.md v0.2
 *
 * Produces a TemplateIR from a tagged template literal. Handles TextBinding
 * and AttrBinding for the PoC slice. Other binding kinds are added as the
 * interpreter increments grow.
 *
 * Usage:
 *   const html = createHtmlTag(document)
 *   const ir = html`<span class="${() => cls()}">${() => count()}</span>`
 *
 * All expression holes MUST be wrapped in `() => ...` (thunks). Passing a
 * raw value (not a function) throws at template construction time.
 *
 * Front-end equivalence invariant (IR §6.1): this front-end and the .nv file
 * front-end must produce structurally identical TemplateIRs for semantically
 * equivalent templates. Source span metadata (meta.source) is excluded from
 * equivalence — it is diagnostic only.
 *
 * jsdom-vs-browser note: template element + innerHTML parsing is the standard
 * mechanism in all major browsers. jsdom uses parse5 as its HTML parser; real
 * browsers use their platform parsers. For the simple, well-formed templates
 * expected in this PoC, parse5 and platform parsers produce identical DOM trees.
 * Flag if you encounter a case where they diverge — do not silently code to
 * the jsdom behavior.
 */
import type { TemplateIR } from './ir';
/**
 * Create an `html` tagged template function bound to `document`.
 *
 * The returned function parses tagged template literals into TemplateIRs.
 * It uses `document.createElement('template')` to parse HTML — this is the
 * standard mechanism in all modern browsers and jsdom.
 *
 * All expression holes must be thunks: `${() => signal()}` not `${signal()}`.
 * Passing a non-function throws at template construction time with a clear message.
 */
export declare function createHtmlTag(document: Document): (strings: TemplateStringsArray, ...exprs: unknown[]) => TemplateIR;
//# sourceMappingURL=html-tag.d.ts.map