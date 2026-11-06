import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStackingHoistPlan } from '../scene/stacking-hoist'

function tree() {
  const root = document.createElement('main')
  const header = document.createElement('header')
  const nav = document.createElement('nav')
  const content = document.createElement('section')
  const overlay = document.createElement('aside')
  root.append(header, content, overlay)
  header.append(nav)
  const styles = new Map<Element, CSSStyleDeclaration>()
  for (const element of [root, header, nav, content, overlay]) {
    const style = document.createElement('div').style
    style.display = 'block'
    style.opacity = '1'
    style.position = 'static'
    style.zIndex = 'auto'
    style.overflowX = 'visible'
    style.overflowY = 'visible'
    styles.set(element, style)
  }
  const navStyle = styles.get(nav)!
  navStyle.position = 'fixed'
  navStyle.zIndex = '100'
  const overlayStyle = styles.get(overlay)!
  overlayStyle.position = 'relative'
  overlayStyle.zIndex = '200'
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element) => {
    const style = styles.get(element)
    if (!style) throw new Error('Unknown element')
    return style
  })
  const createsContext = (_element: Element, style: CSSStyleDeclaration) =>
    style.position === 'fixed' || (style.position !== 'static' && style.zIndex !== 'auto')
  return { root, header, nav, content, overlay, styles, createsContext }
}

afterEach(() => vi.restoreAllMocks())

describe('stacking hoist plan', () => {
  it('uses the supplied style reader for elements and pseudo-elements on every plan', () => {
    const { root, header, nav, styles, createsContext } = tree()
    const previous = vi.mocked(globalThis.getComputedStyle).getMockImplementation()!
    const readStyle = vi.fn((element: Element, pseudo?: string | null) => previous(element, pseudo))
    vi.mocked(globalThis.getComputedStyle).mockImplementation(() => {
      throw new Error('The supplied reader must own every style lookup')
    })

    expect(createStackingHoistPlan(root, createsContext, readStyle).isHoisted(nav)).toBe(true)
    expect(readStyle).toHaveBeenCalledWith(header, '::before')
    expect(readStyle).toHaveBeenCalledWith(header, '::after')
    styles.get(header)!.transform = 'matrix(1, 0, 0, 1, 5, 0)'
    expect(createStackingHoistPlan(root, createsContext, readStyle).isHoisted(nav)).toBe(false)
  })

  it('defers the complete fixed subtree until after ordinary content and before higher z-index siblings', () => {
    const { root, header, nav, overlay, createsContext } = tree()
    const plan = createStackingHoistPlan(root, createsContext)
    const paint: string[] = []
    expect(plan.defer(nav, () => paint.push('nav backdrop', 'nav glass', 'nav text'))).toBe(true)
    expect(plan.defer(overlay, () => paint.push('overlay'))).toBe(true)
    expect(plan.isHoisted(nav)).toBe(true)
    expect(plan.isHoisted(overlay)).toBe(false)
    expect(plan.defer(header, () => paint.push('header'))).toBe(false)
    paint.push('content')
    plan.flush(root)
    expect(paint).toEqual(['content', 'nav backdrop', 'nav glass', 'nav text', 'overlay'])
  })

  it('sorts equal z-index contexts by document order, regardless of callback registration order', () => {
    const { root, nav, overlay, styles, createsContext } = tree()
    styles.get(overlay)!.zIndex = '100'
    const plan = createStackingHoistPlan(root, createsContext)
    const paint: string[] = []
    expect(plan.defer(overlay, () => paint.push('overlay'))).toBe(true)
    expect(plan.defer(nav, () => paint.push('nav'))).toBe(true)
    plan.flush(root)
    expect(paint).toEqual(['nav', 'overlay'])
  })

  it('never defers across an intermediate overflow clip', () => {
    const { root, header, nav, overlay, styles, createsContext } = tree()
    styles.get(header)!.overflowX = 'hidden'
    const plan = createStackingHoistPlan(root, createsContext)
    expect(plan.defer(nav, () => {})).toBe(false)
    expect(plan.defer(overlay, () => {})).toBe(false)
    expect(plan.isHoisted(nav)).toBe(false)
  })

  it('allows a lower-z escaped context to keep its original paint order', () => {
    const { root, header, nav, styles, createsContext } = tree()
    const unrelated = document.createElement('div')
    header.append(unrelated)
    const style = document.createElement('div').style
    style.display = 'block'
    style.position = 'absolute'
    style.zIndex = '2'
    styles.set(unrelated, style)
    const plan = createStackingHoistPlan(root, createsContext)
    expect(plan.defer(nav, () => {})).toBe(true)
    expect(plan.isHoisted(nav)).toBe(true)
  })

  it.each(['100', '101', '-1'])(
    'preserves fallback for an equal, higher, or negative escaped z-index %s',
    (zIndex) => {
      const { root, header, nav, styles, createsContext } = tree()
      const unrelated = document.createElement('div')
      header.append(unrelated)
      const style = document.createElement('div').style
      style.display = 'block'
      style.position = 'absolute'
      style.zIndex = zIndex
      styles.set(unrelated, style)
      const plan = createStackingHoistPlan(root, createsContext)
      expect(plan.defer(nav, () => {})).toBe(false)
      expect(plan.isHoisted(nav)).toBe(false)
    }
  )

  it('preserves fallback if a direct positive context is not above all other escapes', () => {
    const { root, header, nav, overlay, styles, createsContext } = tree()
    styles.get(overlay)!.zIndex = '1'
    const unrelated = document.createElement('div')
    header.append(unrelated)
    const style = document.createElement('div').style
    style.display = 'block'
    style.position = 'relative'
    style.zIndex = '2'
    styles.set(unrelated, style)
    const plan = createStackingHoistPlan(root, createsContext)
    expect(plan.defer(nav, () => {})).toBe(false)
    expect(plan.defer(overlay, () => {})).toBe(false)
  })

  it('can defer a direct positive context above all other escaped contexts', () => {
    const { root, header, nav, overlay, styles, createsContext } = tree()
    styles.get(overlay)!.zIndex = '3'
    const unrelated = document.createElement('div')
    header.append(unrelated)
    const style = document.createElement('div').style
    style.display = 'block'
    style.position = 'relative'
    style.zIndex = '2'
    styles.set(unrelated, style)
    const plan = createStackingHoistPlan(root, createsContext)
    const paint: string[] = ['lower escape']
    expect(plan.defer(nav, () => paint.push('nav'))).toBe(true)
    expect(plan.defer(overlay, () => paint.push('direct'))).toBe(true)
    plan.flush(root)
    expect(paint).toEqual(['lower escape', 'direct', 'nav'])
  })

  it('does not hoist through a nearer stacking context', () => {
    const { root, header, nav, styles, createsContext } = tree()
    styles.get(header)!.position = 'relative'
    styles.get(header)!.zIndex = '1'
    const plan = createStackingHoistPlan(root, createsContext)
    expect(plan.defer(nav, () => {})).toBe(false)
    expect(plan.isHoisted(nav)).toBe(false)
  })

  it('does not hoist through an ancestor pseudo-element with paint', () => {
    const { root, header, nav, createsContext } = tree()
    const currentStyle = vi.mocked(globalThis.getComputedStyle).getMockImplementation()!
    vi.mocked(globalThis.getComputedStyle).mockImplementation((element, pseudo) => {
      const style = currentStyle(element)
      if (element === header && pseudo === '::after') {
        const after = document.createElement('div').style
        after.content = '""'
        return after
      }
      return style
    })
    const plan = createStackingHoistPlan(root, createsContext)
    expect(plan.defer(nav, () => {})).toBe(false)
    expect(plan.isHoisted(nav)).toBe(false)
  })

  it('does not hoist a fixed element whose outer ancestor creates its containing block', () => {
    const { root, nav, styles, createsContext } = tree()
    const wrapper = document.createElement('div')
    wrapper.append(root)
    const style = document.createElement('div').style
    style.transform = 'translateX(1px)'
    styles.set(wrapper, style)
    const plan = createStackingHoistPlan(root, createsContext)
    expect(plan.defer(nav, () => {})).toBe(false)
    expect(plan.isHoisted(nav)).toBe(false)
  })

  it('ignores non-rendered SVG and omitted descendants during preflight', () => {
    const { root, content, nav, createsContext } = tree()
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    svg.append(path)
    content.append(svg, document.createElement('script'))
    const original = vi.mocked(globalThis.getComputedStyle).getMockImplementation()!
    vi.mocked(globalThis.getComputedStyle).mockImplementation((element, pseudo) => {
      if (element === svg) return document.createElement('div').style
      if (element === path || element.tagName === 'SCRIPT')
        throw new Error('Preflight must not inspect omitted descendants')
      return original(element, pseudo)
    })
    const plan = createStackingHoistPlan(root, createsContext)
    expect(plan.isHoisted(nav)).toBe(true)
  })

  it('disables hoisting when a peer context has an invalid z-index', () => {
    const { root, nav, overlay, styles, createsContext } = tree()
    Object.defineProperty(styles.get(overlay)!, 'zIndex', { value: 'unknown' })
    const plan = createStackingHoistPlan(root, createsContext)
    expect(plan.defer(nav, () => {})).toBe(false)
  })
})
