import { afterEach, describe, expect, it, vi } from 'vitest'
import { getClippedElementPaintRect } from '../scene/stacking-bounds'

function fixture() {
  const root = document.createElement('main')
  const section = document.createElement('section')
  const viewport = document.createElement('div')
  const scroller = document.createElement('div')
  const frame = document.createElement('div')
  const card = document.createElement('article')
  root.append(section)
  section.append(viewport)
  viewport.append(scroller)
  scroller.append(frame)
  frame.append(card)
  document.body.append(root)

  const elements = [root, section, viewport, scroller, frame, card]
  const styles = new Map<Element, CSSStyleDeclaration>()
  for (const element of elements) {
    const style = document.createElement('div').style
    const defaults = {
      display: 'block',
      position: 'static',
      filter: 'none',
      backdropFilter: 'none',
      boxShadow: 'none',
      textShadow: 'none',
      outlineStyle: 'none',
      borderImageSource: 'none',
      clipPath: 'none',
      maskImage: 'none',
      overflowX: 'visible',
      overflowY: 'visible',
    }
    for (const [name, value] of Object.entries(defaults))
      Object.defineProperty(style, name, { value, writable: true, configurable: true })
    vi.spyOn(style, 'getPropertyValue').mockImplementation(() => '')
    styles.set(element, style)
  }
  styles.get(viewport)!.overflowX = styles.get(viewport)!.overflowY = 'hidden'
  styles.get(scroller)!.overflowX = 'hidden'
  styles.get(scroller)!.overflowY = 'auto'
  styles.get(frame)!.overflowX = styles.get(frame)!.overflowY = 'clip'

  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1512, 8000))
  vi.spyOn(section, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 8, 1512, 904))
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(792, 120, 680, 680))
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(new DOMRect(792, 120, 680, 680))
  vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(new DOMRect(816, -176, 632, 206))
  vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(new DOMRect(816, -176, 632, 206))
  const pseudo = document.createElement('div').style
  Object.defineProperty(pseudo, 'content', { value: 'none' })
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, name) => {
    if (name) return pseudo
    const style = styles.get(element)
    if (!style) throw new Error('unexpected element')
    return style
  })
  return { root, viewport, scroller, frame, card, styles }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('KA nested-scroll stacking bounds', () => {
  it('clips a scrolled category that has moved above its visible viewport', () => {
    const { root, frame, card } = fixture()
    expect(getClippedElementPaintRect(frame, root)).toEqual({ x: 816, y: 120, width: 632, height: 0 })
    expect(getClippedElementPaintRect(card, root)).toEqual({ x: 816, y: 120, width: 632, height: 0 })
  })

  it.each([
    ['fixed element', (f: ReturnType<typeof fixture>) => (f.styles.get(f.card)!.position = 'fixed')],
    ['absolute element', (f: ReturnType<typeof fixture>) => (f.styles.get(f.card)!.position = 'absolute')],
    ['element shadow', (f: ReturnType<typeof fixture>) => (f.styles.get(f.card)!.boxShadow = '0 0 20px black')],
    ['ancestor filter', (f: ReturnType<typeof fixture>) => (f.styles.get(f.scroller)!.filter = 'blur(3px)')],
    ['absolute ancestor', (f: ReturnType<typeof fixture>) => (f.styles.get(f.frame)!.position = 'absolute')],
    ['fixed ancestor', (f: ReturnType<typeof fixture>) => (f.styles.get(f.frame)!.position = 'fixed')],
    ['display-contents clip', (f: ReturnType<typeof fixture>) => (f.styles.get(f.scroller)!.display = 'contents')],
    ['inline clip', (f: ReturnType<typeof fixture>) => (f.styles.get(f.scroller)!.display = 'inline')],
    [
      'clip margin',
      (f: ReturnType<typeof fixture>) =>
        vi.spyOn(f.styles.get(f.scroller)!, 'getPropertyValue').mockImplementation((name) =>
          name === 'overflow-clip-margin' ? '10px' : ''
        ),
    ],
  ])('fails closed for %s', (_name, change) => {
    const f = fixture()
    change(f)
    expect(getClippedElementPaintRect(f.card, f.root)).toBeNull()
  })

  it('keeps an element that remains inside the scroller visible', () => {
    const { root, frame, card } = fixture()
    vi.mocked(frame.getBoundingClientRect).mockReturnValue(new DOMRect(816, 140, 632, 206))
    vi.mocked(card.getBoundingClientRect).mockReturnValue(new DOMRect(816, 140, 632, 206))
    expect(getClippedElementPaintRect(card, root)).toEqual({ x: 816, y: 140, width: 632, height: 206 })
  })

  it('uses the complete ancestor clip instead of underbounding visible text ink', () => {
    const { root, frame, card } = fixture()
    card.append('Technology')
    vi.mocked(frame.getBoundingClientRect).mockReturnValue(new DOMRect(816, 140, 632, 206))
    vi.mocked(card.getBoundingClientRect).mockReturnValue(new DOMRect(816, 140, 632, 206))
    expect(getClippedElementPaintRect(card, root)).toEqual({ x: 816, y: 140, width: 632, height: 206 })
  })

  it('does not treat an empty element intersection as proof for overhanging glyphs', () => {
    const { root, card } = fixture()
    card.append('Technology')
    expect(getClippedElementPaintRect(card, root)).toEqual({ x: 816, y: 120, width: 632, height: 0 })
  })

  it('fails closed for direct text when only one axis has a proven clip', () => {
    const { root, viewport, scroller, frame, card, styles } = fixture()
    card.append('Technology')
    styles.get(viewport)!.overflowX = 'visible'
    styles.get(scroller)!.overflowX = 'visible'
    styles.get(frame)!.overflowX = 'visible'
    expect(getClippedElementPaintRect(card, root)).toBeNull()
  })
})
