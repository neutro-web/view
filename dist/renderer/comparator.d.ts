/**
 * nv Structural DOM Comparator
 * Stream: (3) Renderer/templating
 * IR contract: nv-template-ir.md v0.2, §6.2 invariant BE, §8.3
 *
 * Compares two DOM trees structurally:
 *   - node type
 *   - tag name (elements)
 *   - attributes as a SET (order-independent)
 *   - text content (text nodes)
 *   - comment data (comment nodes)
 *   - children recursively
 *
 * This comparator exists because outerHTML string equality is both too strict
 * (fails on attribute-order differences between parser implementations) and too
 * weak (structurally-different trees can serialize identically). The differential
 * suite requires a comparator that reliably distinguishes structural differences
 * only.
 *
 * Scope: handles Element, Text, Comment, DocumentFragment, and Document nodes.
 * ProcessingInstruction and other exotic node types are not in-scope for the PoC
 * (templates don't produce them).
 */
export interface CompareResult {
    equal: boolean;
    /**
     * Path description to the first differing node, for test diagnostics.
     * Empty string when equal === true.
     */
    diffPath: string;
}
/**
 * Compare two DOM trees structurally. Returns { equal: true, diffPath: '' } if
 * they are equivalent, or { equal: false, diffPath: '...' } with a description
 * of where they first differ.
 *
 * Attribute order is ignored; all other structural properties are compared.
 */
export declare function structurallyEqual(a: Node, b: Node): CompareResult;
//# sourceMappingURL=comparator.d.ts.map