# Stale-while-revalidate (tier-1 recipe)

This guide covers the tier-1 SWR pattern: a plain consumer recipe built on
top of `resource()` (see [Reactivity](/guides/reactivity)), not a separate
construct. There is no `<swr>` element and no dedicated binding kind for
this tier — it is ordinary reactive code over `resource`'s existing shape.

For the deferred-swap *construct* (tier-2, `<switch pending="...">`, which
holds a *branch* swap while a value transitions between structurally
different views), see the deferred-swap gate doc; this guide is about the
simpler, more common case: showing the same view shape with fresh data
underneath it.

---

## The recipe

`resource()` already keeps the last resolved value around during a pending
refetch — `r()` does not reset to `undefined` when a new fetch starts, and is
only overwritten once the next fetch successfully settles (never cleared on
error either, so a failed refetch leaves the last good value in place). Build
your view directly off `r()`, and only fall back to a loading/empty state
before the *first* value has ever arrived:

```html
${() => r() === undefined
  ? html`<${Spinner}/>`
  : html`<${View} data="${r}"/>`}
```

Once `r()` has resolved at least once, this expression keeps evaluating to
the `View` branch — even while a later refetch is pending — because the
condition `r() === undefined` stays `false`. The resolved view never
unmounts on a refetch; it just keeps showing the previous data until the
new data arrives.

**Gate the branch on `r()` alone, not on `r.loading()`.** It is tempting to
write the condition as `r.loading() && r() === undefined`, to make the
intent ("show a spinner only on the very first load") more explicit. Don't —
`.nv`'s conditional (`ConditionalBinding`, wired by `wireConditional`) has no
"same winner, skip the rebuild" check the way the deferred-swap construct
does: it tears down and remounts whichever branch is selected on *every* run
of its effect, unconditionally. Reading `r.loading()` inside the condition —
even where `&&` short-circuits before evaluating it — still makes `loading`
a tracked dependency of that effect, so the branch gets rebuilt every time a
refetch starts and ends, even though the branch it resolves to never
changes. That defeats the whole point: the view would be destroyed and
recreated (losing any DOM state such as scroll position or focus) on every
refetch instead of being left alone. Reading only `r()` avoids this
entirely, because `r()` provably does not change during a pending refetch
(see "Why it's free" below) — so the effect never re-runs in the first
place, and there is nothing to rebuild.

Optionally drive a small in-place pending indicator off `r.loading()`
separately, outside the conditional, so it never touches the mounted
branch:

```html
<${View} data="${r}"/>
${() => r.loading() ? html`<span class="refreshing">Refreshing…</span>` : null}
```

### Tagged-template equivalent

```ts
import { createHtmlTag, iff } from '@neutro/view/renderer'

const html = createHtmlTag(document)

html`
  ${iff(
    () => r() === undefined,
    () => html`<${Spinner}/>`,
    () => html`<${View} data="${r}"/>`
  )}
`
```

The pending-indicator snippet above is `.nv` syntax, where a bare ternary in
a hole is fine (the compiler recognizes it statically). In the tagged
template a bare ternary does **not** work the same way — see
[Rendering: `iff()`](/guides/rendering#tagged-template-iff-function) — so the
tagged-template equivalent of the pending indicator uses `iff()` with the
`alternate` argument omitted:

```ts
html`
  <${View} data="${r}"/>
  ${iff(
    () => r.loading(),
    () => html`<span class="refreshing">Refreshing…</span>`
  )}
`
```

---

## Why it's free

This pattern costs nothing beyond the `resource()` call itself — there is no
extra machinery to hold the old view alive while a new fetch is in flight.

The reason is demand-driven quiescence: the conditional's only reactive read
is `r() === undefined`. During a pending refetch, `r()` does not change —
`resource` only overwrites `data()` on a successful settle (see
`src/renderer/resource.ts`, the `.then` resolve handler) — so the
expression's dependency doesn't fire. The effect that would unmount the
`View` branch and swap in a fallback simply never re-runs during the pending
window, because nothing it reads has changed. Nothing is withheld or
special-cased to make this happen; it falls directly out of nv's
fine-grained reactivity and `resource`'s existing "don't clear on
refetch/error" contract.

This is why tier-1 needs no new binding kind: it is just a `ConditionalBinding`
(a ternary, or `iff()`) evaluated against a condition that happens not to
change while a refetch is pending.
