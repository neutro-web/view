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

// DOM nodeType constants (standard; same in all environments)
const ELEMENT_NODE = 1
const TEXT_NODE = 3
const COMMENT_NODE = 8
const DOCUMENT_NODE = 9
const DOCUMENT_FRAGMENT_NODE = 11

export interface CompareResult {
  equal: boolean
  /**
   * Path description to the first differing node, for test diagnostics.
   * Empty string when equal === true.
   */
  diffPath: string
}

/**
 * Compare two DOM trees structurally. Returns { equal: true, diffPath: '' } if
 * they are equivalent, or { equal: false, diffPath: '...' } with a description
 * of where they first differ.
 *
 * Attribute order is ignored; all other structural properties are compared.
 */
export function structurallyEqual(a: Node, b: Node): CompareResult {
  return compareNodes(a, b, '')
}

function compareNodes(a: Node, b: Node, path: string): CompareResult {
  if (a.nodeType !== b.nodeType) {
    return {
      equal: false,
      diffPath: `${path}: nodeType mismatch (${a.nodeType} vs ${b.nodeType})`,
    }
  }

  switch (a.nodeType) {
    case TEXT_NODE: {
      const textA = (a as Text).data
      const textB = (b as Text).data
      if (textA !== textB) {
        return {
          equal: false,
          diffPath: `${path} [text]: "${textA}" vs "${textB}"`,
        }
      }
      return ok()
    }

    case COMMENT_NODE: {
      const dataA = (a as Comment).data
      const dataB = (b as Comment).data
      if (dataA !== dataB) {
        return {
          equal: false,
          diffPath: `${path} [comment]: "${dataA}" vs "${dataB}"`,
        }
      }
      return ok()
    }

    case ELEMENT_NODE: {
      const ea = a as Element
      const eb = b as Element
      if (ea.tagName !== eb.tagName) {
        return {
          equal: false,
          diffPath: `${path}: tag mismatch (${ea.tagName} vs ${eb.tagName})`,
        }
      }
      const attrResult = compareAttributes(ea, eb, path)
      if (!attrResult.equal) return attrResult
      return compareChildren(a, b, path)
    }

    case DOCUMENT_FRAGMENT_NODE:
    case DOCUMENT_NODE: {
      return compareChildren(a, b, path)
    }

    default: {
      // Unknown node type: compare children only (conservative)
      return compareChildren(a, b, path)
    }
  }
}

function compareAttributes(a: Element, b: Element, path: string): CompareResult {
  if (a.attributes.length !== b.attributes.length) {
    const namesA = attrNames(a)
    const namesB = attrNames(b)
    return {
      equal: false,
      diffPath:
        `${path} <${a.tagName.toLowerCase()}>: ` +
        `attribute count (${a.attributes.length} vs ${b.attributes.length}): ` +
        `[${namesA}] vs [${namesB}]`,
    }
  }

  // For each attribute in a, check b has the same name+value.
  // Order-independent: we look up by name.
  for (let i = 0; i < a.attributes.length; i++) {
    const attr = a.attributes[i]
    const bVal = b.getAttribute(attr.name)
    if (bVal === null) {
      return {
        equal: false,
        diffPath:
          `${path} <${a.tagName.toLowerCase()}>: ` +
          `attribute "${attr.name}" present in a but absent in b`,
      }
    }
    if (attr.value !== bVal) {
      return {
        equal: false,
        diffPath:
          `${path} <${a.tagName.toLowerCase()}> @${attr.name}: ` + `"${attr.value}" vs "${bVal}"`,
      }
    }
  }
  return ok()
}

function compareChildren(a: Node, b: Node, path: string): CompareResult {
  const childrenA = a.childNodes
  const childrenB = b.childNodes

  if (childrenA.length !== childrenB.length) {
    return {
      equal: false,
      diffPath: `${path}: child count (${childrenA.length} vs ${childrenB.length})`,
    }
  }

  for (let i = 0; i < childrenA.length; i++) {
    const childPath = `${path}[${i}]`
    const result = compareNodes(childrenA[i], childrenB[i], childPath)
    if (!result.equal) return result
  }

  return ok()
}

function ok(): CompareResult {
  return { equal: true, diffPath: '' }
}

function attrNames(el: Element): string {
  const names: string[] = []
  for (let i = 0; i < el.attributes.length; i++) {
    names.push(el.attributes[i].name)
  }
  return names.sort().join(', ')
}
