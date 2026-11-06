import type { SceneRect } from './types'

const omitted = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE'])

function initial(value: string | undefined, expected: string): boolean {
  return !value || value === expected
}

function identityFilter(value: string | undefined): boolean {
  return initial(value, 'none') || /^blur\(\s*0(?:\.0+)?px\s*\)$/i.test(value ?? '')
}

/** Restrict the proof to 2D translations. The viewport rect contains the painted box. */
function translation(value: string | undefined): boolean {
  if (initial(value, 'none')) return true
  const match = /^matrix\(([^()]*)\)$/.exec(value ?? '')
  if (!match?.[1]) return false
  const parts = match[1].split(',').map((number) => number.trim())
  if (parts.some((part) => !part)) return false
  const values = parts.map(Number)
  return (
    values.length === 6 &&
    values.every(Number.isFinite) &&
    values[0] === 1 &&
    values[1] === 0 &&
    values[2] === 0 &&
    values[3] === 1
  )
}

function clipMarginIsZero(style: CSSStyleDeclaration): boolean {
  const value = style.getPropertyValue('overflow-clip-margin').trim()
  return !value || /^(?:0|0px)$/.test(value)
}

function noPseudo(element: Element, readStyle: typeof getComputedStyle): boolean {
  try {
    return (['::before', '::after'] as const).every((pseudo) => {
      const content = readStyle(element, pseudo).content
      return !content || content === 'none' || content === 'normal'
    })
  } catch {
    return false
  }
}

function noEscapingDescendants(element: Element, readStyle: typeof getComputedStyle): boolean {
  for (const child of element.children) {
    if (omitted.has(child.tagName)) continue
    const style = readStyle(child)
    if (style.display === 'none' || child.hasAttribute('hidden')) continue
    // A fixed descendant can have a containing block outside this clip. Top
    // layer content can escape it independently of its positioned ancestors.
    if (
      style.position === 'fixed' ||
      child.shadowRoot ||
      (child.tagName === 'DIALOG' && child.hasAttribute('open')) ||
      child.hasAttribute('popover') ||
      (['::before', '::after'] as const).some((pseudo) => {
        const generated = readStyle(child, pseudo)
        return (
          generated.content &&
          generated.content !== 'none' &&
          generated.content !== 'normal' &&
          generated.position === 'fixed'
        )
      }) ||
      !noEscapingDescendants(child, readStyle)
    )
      return false
  }
  return true
}

function rect(element: Element): SceneRect | null {
  const bounds = element.getBoundingClientRect()
  const result = { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }
  if (
    ![result.x, result.y, result.width, result.height].every(Number.isFinite) ||
    result.width < 0 ||
    result.height < 0 ||
    !Number.isFinite(result.x + result.width) ||
    !Number.isFinite(result.y + result.height)
  )
    return null
  return result
}

/**
 * Return a conservative viewport-space paint bound for a relative element.
 * `null` means its contents or ancestor effects cannot be proven bounded.
 * Callers must recompute when layout, scrolling, or animated styles change.
 */
export function getBoundedRelativePaintRect(
  element: Element,
  root: Element,
  readStyle: typeof getComputedStyle = getComputedStyle
): SceneRect | null {
  if (!(element instanceof HTMLElement) || element === root || !root.contains(element)) return null
  try {
    const style = readStyle(element)
    if (
      style.position !== 'relative' ||
      element.shadowRoot ||
      style.display === 'none' ||
      style.display === 'contents' ||
      style.display === 'list-item' ||
      (element.tagName === 'DIALOG' && element.hasAttribute('open')) ||
      element.hasAttribute('popover') ||
      !initial(style.opacity, '1') ||
      !['hidden', 'clip'].includes(style.overflowX) ||
      !['hidden', 'clip'].includes(style.overflowY) ||
      !translation(style.transform) ||
      !initial(style.translate, 'none') ||
      !initial(style.rotate, 'none') ||
      !initial(style.scale, 'none') ||
      !identityFilter(style.filter) ||
      !initial(style.backdropFilter, 'none') ||
      !initial(style.getPropertyValue('-webkit-backdrop-filter'), 'none') ||
      !initial(style.boxShadow, 'none') ||
      !initial(style.textShadow, 'none') ||
      !initial(style.outlineStyle, 'none') ||
      !initial(style.borderImageSource, 'none') ||
      !initial(style.clipPath, 'none') ||
      !initial(style.maskImage, 'none') ||
      !initial(style.getPropertyValue('-webkit-mask-image'), 'none') ||
      !initial(style.mixBlendMode, 'normal') ||
      !clipMarginIsZero(style) ||
      !noPseudo(element, readStyle) ||
      !noEscapingDescendants(element, readStyle) ||
      (document.fullscreenElement && element.contains(document.fullscreenElement))
    )
      return null

    const bounds = rect(element)
    if (!bounds) return null
    let left = bounds.x
    let right = bounds.x + bounds.width
    let top = bounds.y
    let bottom = bounds.y + bounds.height
    let ancestor = element.parentElement
    while (ancestor) {
      const ancestorStyle = readStyle(ancestor)
      if (
        !translation(ancestorStyle.transform) ||
        !initial(ancestorStyle.translate, 'none') ||
        !initial(ancestorStyle.rotate, 'none') ||
        !initial(ancestorStyle.scale, 'none') ||
        !identityFilter(ancestorStyle.filter) ||
        !initial(ancestorStyle.perspective, 'none')
      )
        return null
      const validOverflow = ['visible', 'unset', 'hidden', 'clip', 'auto', 'scroll']
      if (
        !validOverflow.includes(ancestorStyle.overflowX) ||
        !validOverflow.includes(ancestorStyle.overflowY)
      )
        return null
      const clipX = !['visible', 'unset'].includes(ancestorStyle.overflowX)
      const clipY = !['visible', 'unset'].includes(ancestorStyle.overflowY)
      if (clipX || clipY) {
        if (!clipMarginIsZero(ancestorStyle)) return null
        const clip = rect(ancestor)
        if (!clip) return null
        if (clipX) {
          left = Math.max(left, clip.x)
          right = Math.min(right, clip.x + clip.width)
        }
        if (clipY) {
          top = Math.max(top, clip.y)
          bottom = Math.min(bottom, clip.y + clip.height)
        }
      }
      if (ancestor === root)
        return {
          x: left,
          y: top,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top),
        }
      ancestor = ancestor.parentElement
    }
  } catch {
    // An unmeasurable style or detached DOM must not suppress the fallback.
  }
  return null
}
