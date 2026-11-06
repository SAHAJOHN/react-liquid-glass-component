import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBoundedRelativePaintRect } from '../scene/stacking-bounds'

function fixture() {
  const root = document.createElement('main')
  const outer = document.createElement('section')
  const inner = document.createElement('div')
  const target = document.createElement('div')
  const child = document.createElement('div')
  root.append(outer)
  outer.append(inner)
  inner.append(target)
  target.append(child)
  const elements = [root, outer, inner, target, child]
  const styles = new Map<Element, CSSStyleDeclaration>()
  for (const element of elements) {
    const style = document.createElement('div').style
    Object.defineProperties(style, {
      display: { value: 'block', writable: true },
      position: { value: 'static', writable: true },
      transform: { value: 'none', writable: true },
      filter: { value: 'none', writable: true },
      overflowX: { value: 'visible', writable: true },
      overflowY: { value: 'visible', writable: true },
      opacity: { value: '1', writable: true },
      boxShadow: { value: 'none', writable: true },
      textShadow: { value: 'none', writable: true },
      outlineStyle: { value: 'none', writable: true },
    })
    styles.set(element, style)
  }
  const targetStyle = styles.get(target)!
  targetStyle.position = 'relative'
  targetStyle.overflowX = targetStyle.overflowY = 'hidden'
  targetStyle.transform = 'matrix(1, 0, 0, 1, 0, 20)'
  targetStyle.filter = 'blur(0px)'
  styles.get(outer)!.overflowY = 'hidden'
  styles.get(inner)!.overflowX = styles.get(inner)!.overflowY = 'hidden'
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 1000))
  vi.spyOn(outer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 118))
  vi.spyOn(inner, 'getBoundingClientRect').mockReturnValue(new DOMRect(12, 20, 366, 90))
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(12, 90, 366, 40))
  const pseudo = document.createElement('div').style
  Object.defineProperty(pseudo, 'content', { value: 'none', configurable: true })
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, name) => {
    if (name) return pseudo
    const result = styles.get(element)
    if (!result) throw new Error('unexpected style request')
    return result
  })
  return { root, outer, inner, target, targetStyle, child, styles, pseudo }
}

afterEach(() => vi.restoreAllMocks())

describe('bounded relative stacking paint', () => {
  it('uses the supplied reader for target, descendants, ancestors, and pseudo-elements', () => {
    const { root, inner, target, child, styles } = fixture()
    const previous = vi.mocked(globalThis.getComputedStyle).getMockImplementation()!
    const readStyle = vi.fn((element: Element, pseudo?: string | null) => previous(element, pseudo))
    vi.mocked(globalThis.getComputedStyle).mockImplementation(() => {
      throw new Error('The supplied reader must own every style lookup')
    })

    expect(getBoundedRelativePaintRect(target, root, readStyle)).not.toBeNull()
    expect(readStyle).toHaveBeenCalledWith(target, '::before')
    expect(readStyle).toHaveBeenCalledWith(target, '::after')
    expect(readStyle).toHaveBeenCalledWith(child)
    expect(readStyle).toHaveBeenCalledWith(inner)
    styles.get(child)!.position = 'fixed'
    expect(getBoundedRelativePaintRect(target, root, readStyle)).toBeNull()
  })

  it('intersects the target with its ancestor clips using conservative border boxes', () => {
    const { root, target } = fixture()
    expect(getBoundedRelativePaintRect(target, root)).toEqual({
      x: 12,
      y: 90,
      width: 366,
      height: 20,
    })
  })

  it('clips each axis independently', () => {
    const { root, inner, target, styles } = fixture()
    styles.get(inner)!.overflowY = 'visible'
    expect(getBoundedRelativePaintRect(target, root)).toEqual({
      x: 12,
      y: 90,
      width: 366,
      height: 28,
    })
  })

  it('allows absolutely positioned descendants because the relative target contains them', () => {
    const { root, target, child, styles } = fixture()
    styles.get(child)!.position = 'absolute'
    expect(getBoundedRelativePaintRect(target, root)).not.toBeNull()
  })

  it('refuses a fixed descendant that could escape the clip', () => {
    const { root, target, child, styles } = fixture()
    styles.get(child)!.position = 'fixed'
    expect(getBoundedRelativePaintRect(target, root)).toBeNull()
  })

  it('refuses fixed generated content on a descendant', () => {
    const { root, target, child, pseudo } = fixture()
    const read = vi.mocked(getComputedStyle).getMockImplementation()!
    const fixed = document.createElement('div').style
    Object.defineProperties(fixed, {
      content: { value: '""' },
      position: { value: 'fixed' },
    })
    vi.mocked(getComputedStyle).mockImplementation((element, name) =>
      element === child && name === '::before' ? fixed : read(element, name)
    )
    expect(pseudo.content).toBe('none')
    expect(getBoundedRelativePaintRect(target, root)).toBeNull()
  })

  it.each([
    ['overflowX', 'visible'],
    ['boxShadow', '0 0 20px black'],
    ['outlineStyle', 'solid'],
    ['textShadow', '0 0 2px black'],
    ['filter', 'blur(2px)'],
    ['transform', 'matrix(0, 1, -1, 0, 0, 0)'],
    ['display', 'contents'],
    ['position', 'absolute'],
    ['opacity', '0.5'],
  ])('fails closed for unsupported target style %s', (property, value) => {
    const { root, target, targetStyle } = fixture()
    Object.defineProperty(targetStyle, property, { value })
    expect(getBoundedRelativePaintRect(target, root)).toBeNull()
  })

  it('fails closed for target pseudo paint', () => {
    const { root, target, pseudo } = fixture()
    Object.defineProperty(pseudo, 'content', { value: '""' })
    expect(getBoundedRelativePaintRect(target, root)).toBeNull()
  })

  it('fails closed for expanding filters and overflow clip margin on ancestors', () => {
    const { root, inner, target, styles } = fixture()
    styles.get(inner)!.filter = 'blur(2px)'
    expect(getBoundedRelativePaintRect(target, root)).toBeNull()
    styles.get(inner)!.filter = 'none'
    vi.spyOn(styles.get(inner)!, 'getPropertyValue').mockImplementation((name) =>
      name === 'overflow-clip-margin' ? '10px' : ''
    )
    expect(getBoundedRelativePaintRect(target, root)).toBeNull()
  })

  it('fails closed for a foreign root and non-finite geometry', () => {
    const { root, target } = fixture()
    expect(getBoundedRelativePaintRect(target, document.createElement('main'))).toBeNull()
    vi.mocked(target.getBoundingClientRect).mockReturnValue(new DOMRect(NaN, 0, 10, 10))
    expect(getBoundedRelativePaintRect(target, root)).toBeNull()
  })
})
