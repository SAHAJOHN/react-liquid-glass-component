import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import type * as PaintBox from '../scene/paint-box'
import type { GlassOptions } from '../scene/types'

vi.mock('../scene/paint-box', async (importOriginal) => ({
  ...(await importOriginal<typeof PaintBox>()),
  createColorReader: () => () => [1, 1, 1, 1],
  paintBox: (style: CSSStyleDeclaration) => {
    const canvas = document.createElement('canvas')
    canvas.dataset.paint = style.backgroundColor
    return canvas
  },
}))

const defaults: Record<string, string> = {
  display: 'block',
  visibility: 'visible',
  opacity: '1',
  position: 'static',
  transform: 'none',
  filter: 'none',
  backdropFilter: 'none',
  boxShadow: 'none',
  textShadow: 'none',
  borderImageSource: 'none',
  backgroundBlendMode: 'normal',
  perspective: 'none',
  listStyleType: 'none',
  clipPath: 'none',
  maskImage: 'none',
  mixBlendMode: 'normal',
  backgroundClip: 'border-box',
  backgroundAttachment: 'scroll',
  writingMode: 'horizontal-tb',
  zIndex: 'auto',
  isolation: 'auto',
  contain: 'none',
  willChange: 'auto',
  overflowX: 'visible',
  overflowY: 'visible',
  backgroundColor: 'white',
  backgroundImage: 'none',
  borderTopWidth: '0px',
  borderRightWidth: '0px',
  borderBottomWidth: '0px',
  borderLeftWidth: '0px',
  borderTopLeftRadius: '0px',
  borderTopRightRadius: '0px',
  borderBottomRightRadius: '0px',
  borderBottomLeftRadius: '0px',
}

function style(color: string) {
  const result = document.createElement('div').style
  for (const [key, value] of Object.entries({ ...defaults, backgroundColor: color }))
    Object.defineProperty(result, key, { value, configurable: true, writable: true })
  return result
}

const frame = { scrollX: 0, scrollY: 0, width: 400, height: 800, pixelRatio: 1 }
const glass: GlassOptions = {
  radius: 0,
  displacement: [0, 0, 0],
  blur: 0,
  saturation: 1,
  color: '#fff',
  opacity: 1,
}
const stackingError = 'Escaping descendant stacking order requires native HTML rendering'

function fixture() {
  const root = document.createElement('main')
  const owner = document.createElement('section')
  const header = document.createElement('header')
  const nav = document.createElement('nav')
  const pane = document.createElement('div')
  const label = document.createElement('button')
  const content = document.createElement('article')
  const overlay = document.createElement('aside')
  root.append(owner, overlay)
  owner.append(header, content)
  header.append(nav)
  nav.append(pane, label)
  const styles = new Map<Element, CSSStyleDeclaration>(
    [root, owner, header, nav, pane, label, content, overlay].map((element) => [
      element,
      style(element.tagName.toLowerCase()),
    ])
  )
  styles.get(nav)!.position = 'fixed'
  styles.get(nav)!.zIndex = '100'
  styles.get(overlay)!.position = 'relative'
  styles.get(overlay)!.zIndex = '200'
  const pseudoStyle = style('transparent')
  Object.defineProperty(pseudoStyle, 'content', { value: 'none' })
  for (const element of styles.keys())
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 100, 50))
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (pseudo) return pseudoStyle
    const result = styles.get(element)
    if (!result) throw new Error(`Unexpected element: ${element.tagName}`)
    return result
  })
  const compiler = createSceneCompiler(() => {})
  const compile = () => compiler.compile(root, new Map([[pane, glass]]), frame, 'white')
  const paints = () =>
    compile().scene.items.map((item) =>
      item.kind === 'sprite' ? item.bitmap.dataset.paint : item.kind
    )
  return {
    root,
    owner,
    header,
    nav,
    pane,
    label,
    content,
    overlay,
    styles,
    compiler,
    compile,
    paints,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('compiler stacking hoist integration', () => {
  it('preserves authored stacking when the layered scene boosts a pane after becoming ready', () => {
    const { root, header, pane, nav, styles, compile, compiler } = fixture()
    const host = document.createElement('div')
    host.setAttribute('data-liquid-glass-foreground-mode', 'layered')
    styles.set(host, style('transparent'))
    host.append(root)
    header.append(pane)
    const paneStyle = styles.get(pane)!
    paneStyle.position = 'relative'
    let authoredZ = 'auto'
    Object.defineProperty(paneStyle, 'zIndex', {
      configurable: true,
      get: () =>
        host.hasAttribute('data-liquid-glass-scene-ready') &&
        !host.hasAttribute('data-liquid-glass-measuring-layers') &&
        authoredZ === 'auto'
          ? '2'
          : authoredZ,
      set: (value: string) => {
        authoredZ = value
      },
    })
    glass.nativeLayer = document.createElement('canvas')
    try {
      const before = compile()
      expect(before.issues).not.toContain(stackingError)
      host.setAttribute('data-liquid-glass-scene-ready', 'true')
      const ready = compile()
      expect(ready.issues).toEqual(before.issues)
      const order = (items: typeof ready.scene.items) =>
        items.map((item) => (item.kind === 'sprite' ? item.bitmap.dataset.paint : item.kind))
      expect(order(ready.scene.items)).toEqual(order(before.scene.items))
      expect(host).not.toHaveAttribute('data-liquid-glass-measuring-layers')
      expect(styles.get(nav)!.zIndex).toBe('100')

      // A real authored change to 2 must not be mistaken for the layer boost.
      authoredZ = '2'
      expect(compile().issues).toContain(stackingError)
      authoredZ = '100'
      expect(compile().issues).toContain(stackingError)
    } finally {
      delete glass.nativeLayer
      compiler.dispose()
    }
  })

  it('retains the live glare offset without recompiling the scene', () => {
    const offset = { current: 0 }
    glass.glareOffset = offset
    try {
      const { compile, compiler } = fixture()
      const item = compile().scene.items.find((candidate) => candidate.kind === 'glass')
      expect(item?.kind === 'glass' && item.glareOffset).toBe(offset)
      offset.current = 12
      expect(item?.kind === 'glass' && item.glareOffset?.current).toBe(12)
      compiler.dispose()
    } finally {
      delete glass.glareOffset
    }
  })
  it('reuses element bounds within one compile and reads fresh layout on the next', () => {
    const { compile, content, compiler } = fixture()
    const bounds = vi.mocked(content.getBoundingClientRect)
    compile()
    expect(bounds).toHaveBeenCalledTimes(1)
    bounds.mockReturnValue(new DOMRect(10, 200, 100, 50))
    compile()
    expect(bounds).toHaveBeenCalledTimes(2)
    compiler.dispose()
  })
  it('paints the entire fixed nav after ordinary siblings and before a higher z-index context', () => {
    const { compile, paints, compiler } = fixture()
    const result = compile()
    expect(result.issues).not.toContain(stackingError)
    expect(paints()).toEqual([
      'main',
      'section',
      'header',
      'article',
      'nav',
      'glass',
      'button',
      'aside',
    ])
    compiler.dispose()
  })

  it('honors DOM order when sibling contexts have the same positive z-index', () => {
    const { root, owner, overlay, styles, paints, compiler } = fixture()
    styles.get(overlay)!.zIndex = '100'
    root.insertBefore(overlay, owner)
    expect(paints()).toEqual([
      'main',
      'section',
      'header',
      'article',
      'aside',
      'nav',
      'glass',
      'button',
    ])
    compiler.dispose()
  })

  it('does not use hoisting across an unsupported ancestor clip', () => {
    const { header, styles, compile, compiler } = fixture()
    styles.get(header)!.overflowX = 'hidden'
    expect(compile().issues).toContain(stackingError)
    compiler.dispose()
  })

  it('flushes an inner owner before higher-z siblings of the outer owner', () => {
    const { owner, styles, compile, paints, compiler } = fixture()
    styles.get(owner)!.position = 'relative'
    styles.get(owner)!.zIndex = '10'
    expect(compile().issues).not.toContain(stackingError)
    expect(paints()).toEqual([
      'main',
      'section',
      'header',
      'article',
      'nav',
      'glass',
      'button',
      'aside',
    ])
    compiler.dispose()
  })

  it('does not leave deferred paint when an invisible ancestor terminates its subtree', () => {
    const { owner, styles, paints, compiler } = fixture()
    styles.get(owner)!.opacity = '0'
    expect(paints()).toEqual(['main', 'aside'])
    compiler.dispose()
  })

  it('retains guarded lower-z escaped content before the fixed nav', () => {
    const { content, styles, compile, paints, compiler } = fixture()
    styles.get(content)!.position = 'relative'
    styles.get(content)!.zIndex = '2'
    expect(compile().issues).not.toContain(stackingError)
    expect(paints()).toEqual([
      'main',
      'section',
      'header',
      'article',
      'nav',
      'glass',
      'button',
      'aside',
    ])
    compiler.dispose()
  })

  it('retains document order for an equal-z escaped peer that follows the nav', () => {
    const { content, styles, compile, paints, compiler } = fixture()
    styles.get(content)!.position = 'relative'
    styles.get(content)!.zIndex = '100'
    expect(compile().issues).not.toContain(stackingError)
    expect(paints()).toEqual([
      'main',
      'section',
      'header',
      'nav',
      'glass',
      'button',
      'article',
      'aside',
    ])
    compiler.dispose()
  })

  it('retains fallback when a higher-z escaped peer occurs before the nav', () => {
    const { root, owner, overlay, styles, compile, compiler } = fixture()
    const higher = document.createElement('div')
    root.insertBefore(overlay, owner)
    overlay.append(higher)
    styles.get(overlay)!.position = 'static'
    styles.get(overlay)!.zIndex = 'auto'
    const higherStyle = style('higher')
    higherStyle.position = 'relative'
    higherStyle.zIndex = '101'
    styles.set(higher, higherStyle)
    vi.spyOn(higher, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 100, 50))
    expect(compile().issues).toContain(stackingError)
    compiler.dispose()
  })

  it('retains fallback for an escaped negative context', () => {
    const { content, styles, compile, compiler } = fixture()
    styles.get(content)!.position = 'relative'
    styles.get(content)!.zIndex = '-1'
    expect(compile().issues).toContain(
      'Escaping negative stacking order requires native HTML rendering'
    )
    compiler.dispose()
  })

  it('recognizes disjoint bounds after a relative subtree is clipped by its ancestor', () => {
    const { owner, nav, content, overlay, styles, compile, compiler } = fixture()
    styles.get(nav)!.zIndex = 'auto'
    styles.get(owner)!.overflowX = styles.get(owner)!.overflowY = 'hidden'
    styles.get(content)!.position = 'relative'
    styles.get(content)!.zIndex = '1'
    styles.get(content)!.overflowX = styles.get(content)!.overflowY = 'hidden'
    vi.mocked(owner.getBoundingClientRect).mockReturnValue(new DOMRect(0, 0, 400, 110))
    vi.mocked(content.getBoundingClientRect).mockReturnValue(new DOMRect(10, 90, 100, 40))
    vi.mocked(overlay.getBoundingClientRect).mockReturnValue(new DOMRect(10, 118, 100, 60))
    styles.get(overlay)!.zIndex = 'auto'
    const result = compile()
    expect(result.issues).not.toContain(stackingError)
    expect(result.liveGeometry).toBe(true)
    compiler.dispose()
  })

  it('retains fallback when clipped bounds still overlap a later sibling', () => {
    const { owner, nav, content, overlay, styles, compile, compiler } = fixture()
    styles.get(nav)!.zIndex = 'auto'
    styles.get(owner)!.overflowX = styles.get(owner)!.overflowY = 'hidden'
    styles.get(content)!.position = 'relative'
    styles.get(content)!.zIndex = '1'
    styles.get(content)!.overflowX = styles.get(content)!.overflowY = 'hidden'
    vi.mocked(owner.getBoundingClientRect).mockReturnValue(new DOMRect(0, 0, 400, 110))
    vi.mocked(content.getBoundingClientRect).mockReturnValue(new DOMRect(10, 90, 100, 40))
    vi.mocked(overlay.getBoundingClientRect).mockReturnValue(new DOMRect(10, 105, 100, 60))
    styles.get(overlay)!.zIndex = 'auto'
    expect(compile().issues).toContain(stackingError)
    compiler.dispose()
  })

  it('does not confuse a gap inside cached descendant bounds with a real overlap', () => {
    const { nav, content, overlay, styles, compile, compiler } = fixture()
    styles.get(nav)!.zIndex = 'auto'
    styles.get(content)!.position = 'relative'
    styles.get(content)!.zIndex = '1'
    styles.get(overlay)!.position = 'static'
    styles.get(overlay)!.zIndex = 'auto'
    vi.mocked(content.getBoundingClientRect).mockReturnValue(new DOMRect(10, 100, 100, 20))
    vi.mocked(overlay.getBoundingClientRect).mockReturnValue(new DOMRect(0, 0, 0, 0))
    const above = document.createElement('div')
    const below = document.createElement('div')
    overlay.append(above, below)
    styles.set(above, style('above'))
    styles.set(below, style('below'))
    vi.spyOn(above, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 0, 100, 20))
    const lower = vi
      .spyOn(below, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(10, 200, 100, 20))
    expect(compile().issues).not.toContain(stackingError)
    lower.mockReturnValue(new DOMRect(10, 105, 100, 20))
    expect(compile().issues).toContain(stackingError)
    compiler.dispose()
  })

  it('defers an off-region stacking conflict only when an entire clipped ancestor is proven outside', () => {
    const { root, owner, nav, pane, content, overlay, styles, compiler } = fixture()
    styles.get(nav)!.position = 'static'
    styles.get(nav)!.zIndex = 'auto'
    styles.get(owner)!.position = 'relative'
    styles.get(owner)!.overflowX = styles.get(owner)!.overflowY = 'hidden'
    styles.get(content)!.position = 'relative'
    styles.get(content)!.zIndex = '1'
    styles.get(overlay)!.position = 'static'
    styles.get(overlay)!.zIndex = 'auto'
    vi.mocked(owner.getBoundingClientRect).mockReturnValue(new DOMRect(0, -500, 400, 400))
    vi.mocked(content.getBoundingClientRect).mockReturnValue(new DOMRect(10, -450, 100, 270))
    vi.mocked(overlay.getBoundingClientRect).mockReturnValue(new DOMRect(0, -100, 400, 500))
    const offscreen = document.createElement('div')
    overlay.append(offscreen)
    styles.set(offscreen, style('offscreen'))
    vi.spyOn(offscreen, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, -300, 100, 150))
    const region = { x: 0, y: 0, width: 400, height: 100 }
    const compile = (samplingRegion?: typeof region) =>
      compiler.compile(root, new Map([[pane, glass]]), frame, 'white', samplingRegion)

    expect(compile().issues).toContain(stackingError)
    const outside = compile(region)
    expect(outside.issues).not.toContain(stackingError)
    expect(outside.liveGeometry).toBe(true)
    expect(compile({ ...region, width: Number.NaN }).issues).toContain(stackingError)
    const second = { x: 0, y: -400, width: 400, height: 100 }
    expect(
      compiler.compile(root, new Map([[pane, glass]]), frame, 'white', region, [region, second])
        .issues
    ).toContain(stackingError)
    vi.mocked(owner.getBoundingClientRect).mockReturnValue(new DOMRect(0, -50, 400, 400))
    expect(compile(region).issues).toContain(stackingError)
    vi.mocked(owner.getBoundingClientRect).mockReturnValue(new DOMRect(0, -500, 400, 400))
    styles.get(nav)!.position = 'fixed'
    expect(compile(region).issues).toContain(stackingError)
    compiler.dispose()
  })
})
