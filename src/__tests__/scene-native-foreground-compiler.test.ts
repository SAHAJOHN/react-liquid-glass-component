import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import type * as BoxModule from '../scene/paint-box'
import { GLASS_STUDIO_DEFAULTS } from '../studio-props'
import type { GlassOptions } from '../scene/types'

vi.mock('../scene/paint-box', async (original) => ({
  ...(await original<typeof BoxModule>()),
  createColorReader: () => (value: string) =>
    value === 'transparent' ? [0, 0, 0, 0] : [1, 1, 1, 1],
  paintBox: () => document.createElement('canvas'),
}))

const frame = { width: 400, height: 800, pixelRatio: 1, scrollX: 0, scrollY: 0 }
const options: GlassOptions = {
  radius: 20,
  displacement: [0, 0, 0],
  blur: 0,
  saturation: 1,
  color: '#fff',
  opacity: 1,
  studio: { ...GLASS_STUDIO_DEFAULTS, shapeRoundness: 2, shadowFactor: 0 },
}

function fixture() {
  const root = document.createElement('main')
  const outside = document.createElement('div')
  const nav = document.createElement('nav')
  const pane = document.createElement('div')
  const foreground = document.createElement('button')
  const child = document.createElement('span')
  outside.setAttribute('data-liquid-glass-foreground', '')
  foreground.setAttribute('data-liquid-glass-foreground', '')
  root.append(outside, nav)
  nav.append(pane, foreground)
  foreground.append(child)
  document.body.append(root)

  const defaults: Record<string, string> = {
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    position: 'static',
    transform: 'none',
    translate: 'none',
    rotate: 'none',
    scale: 'none',
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
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    borderTopWidth: '0px',
    borderRightWidth: '0px',
    borderBottomWidth: '0px',
    borderLeftWidth: '0px',
    borderTopLeftRadius: '0px',
    borderTopRightRadius: '0px',
    borderBottomRightRadius: '0px',
    borderBottomLeftRadius: '0px',
    color: 'black',
  }
  function makeStyle(overrides: Record<string, string> = {}) {
    const result = document.createElement('div').style
    for (const [key, value] of Object.entries({ ...defaults, ...overrides }))
      Object.defineProperty(result, key, { value, writable: true, configurable: true })
    return result
  }
  const styles = new Map<Element, CSSStyleDeclaration>([
    [root, makeStyle()],
    [outside, makeStyle({ backgroundColor: 'white' })],
    [nav, makeStyle({ position: 'fixed' })],
    [pane, makeStyle()],
    [foreground, makeStyle({ backgroundColor: 'white' })],
    [child, makeStyle({ backgroundColor: 'white' })],
  ])
  const pseudo = makeStyle({ content: 'none' })
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, name) => {
    if (name) return pseudo
    const value = styles.get(element)
    if (!value) throw new Error(`Unexpected element ${element.tagName}`)
    return value
  })
  const bounds = new Map<Element, DOMRect>([
    [root, new DOMRect(0, 0, 400, 800)],
    [outside, new DOMRect(50, 100, 50, 50)],
    [nav, new DOMRect(0, 0, 400, 80)],
    [pane, new DOMRect(10, 10, 380, 60)],
    [foreground, new DOMRect(30, 20, 60, 40)],
    [child, new DOMRect(40, 25, 30, 20)],
  ])
  for (const [element, rect] of bounds)
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect)
  return { root, outside, nav, pane, foreground, child, styles, makeStyle }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('native foreground scene compilation', () => {
  it('probes the internal content wrapper in its ready state and preserves author stacking', () => {
    const { root, nav, pane, styles, makeStyle } = fixture()
    const host = document.createElement('div')
    const content = document.createElement('div')
    host.setAttribute('data-liquid-glass-scene', '')
    host.setAttribute('data-liquid-glass-foreground-mode', 'layered')
    content.className = 'liquid-glass-scene__content'
    document.body.append(host)
    host.append(content)
    content.append(root)
    styles.set(host, makeStyle())
    const contentStyle = makeStyle({ position: 'relative' })
    let readyZIndex = 'auto'
    Object.defineProperty(contentStyle, 'zIndex', {
      configurable: true,
      get: () => host.hasAttribute('data-liquid-glass-scene-ready') ? readyZIndex : '0',
    })
    styles.set(content, contentStyle)
    styles.get(nav)!.position = 'static'
    styles.get(pane)!.position = 'relative'
    const compiler = createSceneCompiler(() => {})
    const panes = new Map<HTMLElement, GlassOptions>([
      [pane, { ...options, nativeLayer: document.createElement('canvas') }],
    ])
    const compile = () => compiler.compile(host, panes, frame, 'white').issues
    const ancestor = 'Layered foreground cannot use stacking-context ancestors'
    expect(compile()).not.toContain(ancestor)
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-ready')

    readyZIndex = '0'
    expect(compile()).toContain(ancestor)
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-ready')
    readyZIndex = 'auto'
    const customAncestor = styles.get(nav)!
    customAncestor.position = 'relative'
    customAncestor.zIndex = '0'
    expect(compile()).toContain(ancestor)

    customAncestor.position = 'static'
    customAncestor.zIndex = 'auto'
    host.setAttribute('data-liquid-glass-scene-ready', 'true')
    expect(compile()).not.toContain(ancestor)
    readyZIndex = '0'
    expect(compile()).toContain(ancestor)
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    compiler.dispose()
  })

  it('guards layered pane alignment and stacking without changing normal scenes', () => {
    vi.stubGlobal('DOMMatrixReadOnly', class {
      is2D = true
      a = 1
      b = 0
      c = 0
      d = 1
    })
    const { root, nav, pane, styles } = fixture()
    const host = document.createElement('div')
    document.body.append(host)
    host.append(root)
    host.setAttribute('data-liquid-glass-foreground-mode', 'layered')
    const paneStyle = styles.get(pane)!
    const parentStyle = styles.get(nav)!
    parentStyle.position = 'static'
    paneStyle.position = 'relative'
    const compiler = createSceneCompiler(() => {})
    const panes = new Map<HTMLElement, GlassOptions>([
      [pane, { ...options, nativeLayer: document.createElement('canvas') }],
    ])
    const compile = () => compiler.compile(root, panes, frame, 'white').issues
    const border = 'Layered foreground requires panes without borders'
    const transform = 'Layered foreground requires untransformed panes'
    const stacking = 'Layered foreground requires pane stacking above the scene canvas'
    const ancestor = 'Layered foreground cannot use stacking-context ancestors'
    expect(compile()).not.toContain(border)
    expect(compile()).not.toContain(transform)
    expect(compile()).not.toContain(stacking)
    expect(compile()).not.toContain(ancestor)

    paneStyle.borderLeftWidth = '1px'
    expect(compile()).toContain(border)
    paneStyle.borderLeftWidth = '0px'
    paneStyle.transform = 'matrix(1, 0, 0, 1, 10, 0)'
    expect(compile()).toContain(transform)
    paneStyle.transform = 'none'
    paneStyle.scale = '1.1'
    expect(compile()).toContain(transform)
    paneStyle.scale = 'none'
    paneStyle.rotate = '5deg'
    expect(compile()).toContain(transform)
    paneStyle.rotate = 'none'
    paneStyle.translate = '1px'
    expect(compile()).toContain(transform)
    paneStyle.translate = 'none'
    for (const zIndex of ['0', '1', '-1']) {
      paneStyle.zIndex = zIndex
      expect(compile()).toContain(stacking)
    }
    paneStyle.zIndex = 'auto'
    paneStyle.position = 'static'
    expect(compile()).toContain(stacking)
    paneStyle.position = 'relative'
    for (const [key, value] of [
      ['opacity', '0.5'],
      ['isolation', 'isolate'],
      ['transform', 'matrix(1, 0, 0, 1, 1, 0)'],
    ] as const) {
      const previous = parentStyle[key]
      parentStyle[key] = value
      expect(compile()).toContain(ancestor)
      parentStyle[key] = previous
    }
    parentStyle.position = 'relative'
    parentStyle.zIndex = '0'
    expect(compile()).toContain(ancestor)
    parentStyle.position = 'static'
    parentStyle.zIndex = 'auto'

    // Existing modes do not inherit the stricter layered layout contract.
    host.setAttribute('data-liquid-glass-foreground-mode', 'native')
    paneStyle.borderLeftWidth = '1px'
    expect(compile()).not.toContain(border)
    compiler.dispose()
  })

  it('allows a root-level fixed navbar with authored z-index 100', () => {
    const { root, nav, styles } = fixture()
    const host = document.createElement('div')
    document.body.append(host)
    host.append(root)
    host.setAttribute('data-liquid-glass-foreground-mode', 'layered')
    styles.get(nav)!.zIndex = '100'
    const compiler = createSceneCompiler(() => {})
    const panes = new Map<HTMLElement, GlassOptions>([
      [nav, { ...options, nativeLayer: document.createElement('canvas') }],
    ])
    const issues = compiler.compile(root, panes, frame, 'white').issues
    expect(issues).not.toContain('Layered foreground requires pane stacking above the scene canvas')
    expect(issues).not.toContain('Layered foreground cannot use stacking-context ancestors')
    compiler.dispose()
  })

  it('rejects mixed layered and canvas panes only in a layered scene', () => {
    const { root, pane, foreground } = fixture()
    const host = document.createElement('div')
    document.body.append(host)
    host.append(root)
    const layer = document.createElement('canvas')
    const secondLayer = document.createElement('canvas')
    const compiler = createSceneCompiler(() => {})
    const mixed = new Map<HTMLElement, GlassOptions>([
      [pane, { ...options, nativeLayer: layer }],
      [foreground, options],
    ])
    const reason = 'Layered foreground requires nativeContent on every managed pane'

    // The ordinary canvas and anchored native modes keep their existing rules.
    expect(compiler.compile(root, mixed, frame, 'white').issues).not.toContain(reason)
    host.setAttribute('data-liquid-glass-foreground-mode', 'native')
    expect(compiler.compile(root, mixed, frame, 'white').issues).not.toContain(reason)

    host.setAttribute('data-liquid-glass-foreground-mode', 'layered')
    expect(compiler.compile(root, mixed, frame, 'white').issues).toContain(reason)
    mixed.set(foreground, { ...options, nativeLayer: secondLayer })
    expect(compiler.compile(root, mixed, frame, 'white').issues).not.toContain(reason)
    mixed.set(pane, options)
    mixed.set(foreground, options)
    expect(compiler.compile(root, mixed, frame, 'white').issues).not.toContain(reason)
    compiler.dispose()
  })

  it('retains pane content in the sampling scene and forwards the layered destination', () => {
    const { root, pane, foreground, styles } = fixture()
    const layer = document.createElement('canvas')
    layer.setAttribute('data-liquid-glass-scene-canvas', '')
    const paneStyle = styles.get(pane)
    if (!paneStyle) throw new Error('Missing pane style')
    styles.set(layer, paneStyle)
    pane.append(layer, foreground)
    const compiler = createSceneCompiler(() => {})
    const result = compiler.compile(root, new Map([[pane, { ...options, nativeLayer: layer }]]), frame, 'white')
    expect(result.issues).toEqual([])
    const glass = result.scene.items.find((item) => item.kind === 'glass')
    expect(glass).toMatchObject({ nativeLayer: layer })
    const rects = result.scene.items.filter((item) => item.kind === 'sprite').map((item) => item.rect)
    expect(rects).toContainEqual({ x: 30, y: 20, width: 60, height: 40 })
    compiler.dispose()
  })

  it('skips marked foreground subtree in the fixed container while preserving the pane and unrelated marked background', () => {
    const { root, nav, pane } = fixture()
    const compiler = createSceneCompiler(() => {}, nav)
    const result = compiler.compile(root, new Map([[pane, options]]), frame, 'white')
    expect(result.issues).toEqual([])
    expect(result.scene.items.some((item) => item.kind === 'glass')).toBe(true)
    const rects = result.scene.items
      .filter((item) => item.kind === 'sprite')
      .map((item) => item.rect)
    expect(rects).toContainEqual({ x: 50, y: 100, width: 50, height: 50 })
    expect(rects).not.toContainEqual({ x: 30, y: 20, width: 60, height: 40 })
    expect(rects).not.toContainEqual({ x: 40, y: 25, width: 30, height: 20 })
    compiler.dispose()
  })

  it('skips the same foreground when compiling the container for scroll-capture projection', () => {
    const { nav, pane } = fixture()
    const compiler = createSceneCompiler(() => {}, nav)
    const result = compiler.compile(nav, new Map([[pane, options]]), frame, 'transparent')
    expect(result.issues).toEqual([])
    expect(result.scene.items.some((item) => item.kind === 'glass')).toBe(true)
    const rects = result.scene.items
      .filter((item) => item.kind === 'sprite')
      .map((item) => item.rect)
    expect(rects).not.toContainEqual({ x: 30, y: 20, width: 60, height: 40 })
    expect(rects).not.toContainEqual({ x: 40, y: 25, width: 30, height: 20 })
    compiler.dispose()
  })

  it('keeps unmarked siblings in the compiled scene even in native foreground mode', () => {
    const { root, nav, pane, foreground } = fixture()
    foreground.removeAttribute('data-liquid-glass-foreground')
    const compiler = createSceneCompiler(() => {}, nav)
    const result = compiler.compile(root, new Map([[pane, options]]), frame, 'white')
    const rects = result.scene.items
      .filter((item) => item.kind === 'sprite')
      .map((item) => item.rect)
    expect(rects).toContainEqual({ x: 30, y: 20, width: 60, height: 40 })
    expect(rects).toContainEqual({ x: 40, y: 25, width: 30, height: 20 })
    compiler.dispose()
  })

  it('does not fail the glass because of an effect on a marked native foreground', () => {
    const { root, nav, pane, foreground, styles } = fixture()
    const style = styles.get(foreground)
    if (!style) throw new Error('Missing foreground style')
    style.filter = 'blur(3px)'
    const compiler = createSceneCompiler(() => {}, nav)
    const result = compiler.compile(root, new Map([[pane, options]]), frame, 'white')
    expect(result.issues).toEqual([])
    compiler.dispose()
  })

  it('keeps marked nodes in the rendered scene by default', () => {
    const { root, pane } = fixture()
    const compiler = createSceneCompiler(() => {})
    const result = compiler.compile(root, new Map([[pane, options]]), frame, 'white')
    const rects = result.scene.items
      .filter((item) => item.kind === 'sprite')
      .map((item) => item.rect)
    expect(rects).toContainEqual({ x: 30, y: 20, width: 60, height: 40 })
    expect(rects).toContainEqual({ x: 40, y: 25, width: 30, height: 20 })
    compiler.dispose()
  })

  it('does not hide a managed pane placed inside a marked foreground subtree', () => {
    const { root, nav, pane, foreground } = fixture()
    foreground.append(pane)
    const compiler = createSceneCompiler(() => {}, nav)
    const result = compiler.compile(root, new Map([[pane, options]]), frame, 'white')
    expect(result.issues.length).toBeGreaterThan(0)
    compiler.dispose()
  })
})
