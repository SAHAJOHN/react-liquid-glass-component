import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import type { GlassOptions, SceneRect } from '../scene/types'
import type * as PaintBox from '../scene/paint-box'

vi.mock('../scene/paint-box', async (original) => ({
  ...(await original<typeof PaintBox>()),
  createColorReader: () => (value: string) =>
    value === 'transparent' ? [0, 0, 0, 0] : [1, 1, 1, 1],
  paintBox: () => document.createElement('canvas'),
}))
vi.mock('../scene/paint-shadow', () => ({ paintBoxShadows: () => ({ status: 'none' }) }))
vi.mock('../scene/paint-pseudo', () => ({
  measurePseudoBox: () => ({ status: 'none' }),
  paintPseudoBox: vi.fn(),
}))

const frame = { width: 400, height: 800, pixelRatio: 1, scrollX: 0, scrollY: 0 }
const region: SceneRect = { x: 0, y: 0, width: 400, height: 500 }
const glass: GlassOptions = {
  radius: 20,
  displacement: [0, 0, 0],
  blur: 0,
  saturation: 1,
  color: 'transparent',
  opacity: 1,
}

function fixture() {
  const root = document.createElement('main')
  const section = document.createElement('section')
  const child = document.createElement('div')
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 100
  const navigation = document.createElement('nav')
  const pane = document.createElement('div')
  const label = document.createElement('div')
  section.append(child)
  navigation.append(pane, label)
  root.append(canvas, section, navigation)
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
    outlineStyle: 'none',
    borderImageSource: 'none',
    backgroundBlendMode: 'normal',
    perspective: 'none',
    listStyleType: 'none',
    clip: 'auto',
    clipPath: 'none',
    maskImage: 'none',
    mixBlendMode: 'normal',
    backgroundClip: 'border-box',
    backgroundAttachment: 'scroll',
    writingMode: 'horizontal-tb',
    zIndex: 'auto',
    isolation: 'auto',
    contain: 'none',
    containerType: 'normal',
    contentVisibility: 'visible',
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
    objectFit: 'fill',
    objectPosition: '50% 50%',
  }
  const style = () => {
    const result = document.createElement('div').style
    for (const [key, value] of Object.entries(defaults))
      Object.defineProperty(result, key, { value, configurable: true, writable: true })
    vi.spyOn(result, 'getPropertyValue').mockImplementation(() => '')
    return result
  }
  const styles = new Map<Element, CSSStyleDeclaration>()
  for (const element of [root, section, child, canvas, navigation, pane, label])
    styles.set(element, style())
  const getStyle = (element: Element) => {
    const found = styles.get(element)
    if (!found) throw new Error('Missing test style')
    return found
  }
  getStyle(navigation).position = 'fixed'
  getStyle(navigation).zIndex = '100'
  getStyle(section).position = 'relative'
  getStyle(section).overflowX = getStyle(section).overflowY = 'hidden'
  getStyle(label).backgroundColor = 'white'
  const none = style()
  Object.defineProperty(none, 'content', { value: 'none', configurable: true })
  const pseudo = style()
  Object.defineProperty(pseudo, 'content', { value: 'none', configurable: true })
  const readStyle = vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, name) => {
    if (name) return element === child && name === '::before' ? pseudo : none
    return getStyle(element)
  })
  const rect = (element: Element, value: DOMRect) =>
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(value)
  rect(root, new DOMRect(0, 0, 400, 6000))
  rect(section, new DOMRect(0, 3000, 400, 500))
  const childRect = rect(child, new DOMRect(10, 3020, 100, 100))
  rect(canvas, new DOMRect(10, 100, 100, 100))
  rect(navigation, new DOMRect(10, 10, 380, 70))
  rect(pane, new DOMRect(10, 10, 380, 70))
  rect(label, new DOMRect(30, 30, 40, 20))
  const glasses = new Map([[pane, glass]])
  const compiler = createSceneCompiler(() => {})
  const compile = () =>
    compiler.compile(root, glasses, frame, 'white', region, [region], navigation)
  return {
    root,
    section,
    child,
    canvas,
    navigation,
    pane,
    label,
    pseudo,
    none,
    getStyle,
    styles,
    style,
    readStyle,
    childRect,
    glasses,
    compiler,
    compile,
  }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('scroll-translation certificate', () => {
  it('compiles a fixed subtree as its own stacking root without inspecting external siblings', () => {
    const { compiler, navigation, glasses } = fixture()
    const result = compiler.compile(navigation, glasses, frame, 'transparent', region, [region])
    expect(result.issues).toEqual([])
    expect(result.scene.items.length).toBeGreaterThan(0)
    expect(result.scene.items.every((item) => item.space === 'viewport')).toBe(true)
    compiler.dispose()
  })
  it('certifies document media with one fixed navigation branch and its foreground siblings', () => {
    const { compile, compiler, canvas } = fixture()
    const result = compile()
    expect(result.issues).toEqual([])
    expect(result.scrollTranslationSafe).toBe(true)
    expect(result.liveGeometry).toBe(true)
    expect(result.media).toContain(canvas)
    expect(
      result.scene.items.some((item) => item.space === 'viewport' && item.kind === 'sprite')
    ).toBe(true)
    compiler.dispose()
  })

  it('does not opt ordinary compiles into reuse without a requested fixed branch', () => {
    const { root, glasses, compiler } = fixture()
    const result = compiler.compile(root, glasses, frame, 'white', region)
    expect(result.scrollTranslationSafe).not.toBe(true)
    compiler.dispose()
  })

  it('checks sticky positions inside a distant culled subtree', () => {
    const { child, getStyle, compile, compiler } = fixture()
    getStyle(child).position = 'sticky'
    expect(compile().scrollTranslationSafe).not.toBe(true)
    compiler.dispose()
  })

  it('rejects fixed descendants outside the navigation branch', () => {
    const { child, childRect, getStyle, compile, compiler } = fixture()
    getStyle(child).position = 'fixed'
    childRect.mockReturnValue(new DOMRect(30, 100, 50, 50))
    expect(compile().scrollTranslationSafe).not.toBe(true)
    compiler.dispose()
  })

  it.each(['opacity', 'legacy clip', 'inset clip', 'display', 'hidden attribute'])(
    'allows a fixed leaf suppressed by %s',
    (suppression) => {
      const { child, pseudo, getStyle, compile, compiler } = fixture()
      const style = getStyle(child)
      style.position = 'fixed'
      if (suppression === 'opacity') style.opacity = '0'
      if (suppression === 'legacy clip') style.clip = 'rect(0px, 0px, 0px, 0px)'
      if (suppression === 'inset clip') style.clipPath = 'inset(50%)'
      if (suppression === 'display') style.display = 'none'
      if (suppression === 'hidden attribute') child.setAttribute('hidden', '')
      Object.defineProperty(pseudo, 'content', { value: '""' })
      pseudo.position = 'fixed'

      const result = compile()
      expect(result.issues).toEqual([])
      expect(result.scrollTranslationSafe).toBe(true)
      compiler.dispose()
    }
  )

  it.each(['opacity', 'legacy clip'])(
    'still inspects fixed descendants of a parent suppressed by %s',
    (suppression) => {
      const { child, getStyle, styles, style, compile, compiler } = fixture()
      const parentStyle = getStyle(child)
      parentStyle.position = 'fixed'
      if (suppression === 'opacity') parentStyle.opacity = '0'
      else parentStyle.clip = 'rect(0px, 0px, 0px, 0px)'
      const descendant = document.createElement('div')
      child.append(descendant)
      const descendantStyle = style()
      descendantStyle.position = 'fixed'
      styles.set(descendant, descendantStyle)

      const result = compile()
      expect(result.issues).toEqual([])
      expect(result.scrollTranslationSafe).not.toBe(true)
      compiler.dispose()
    }
  )

  it('rejects fixed generated content even when its parent is outside the capture', () => {
    const { pseudo, compile, compiler } = fixture()
    Object.defineProperty(pseudo, 'content', { value: '""' })
    pseudo.position = 'fixed'
    expect(compile().scrollTranslationSafe).not.toBe(true)
    compiler.dispose()
  })

  it.each(['fixed', 'local', 'scroll, fixed'])('rejects %s background attachment', (value) => {
    const { child, getStyle, compile, compiler } = fixture()
    getStyle(child).backgroundAttachment = value
    expect(compile().scrollTranslationSafe).not.toBe(true)
    compiler.dispose()
  })

  it.each(['container query', 'auto content visibility'])('rejects %s dependencies', (reason) => {
    const { child, getStyle, compile, compiler } = fixture()
    if (reason === 'container query') getStyle(child).containerType = 'inline-size'
    else getStyle(child).contentVisibility = 'auto'
    expect(compile().scrollTranslationSafe).not.toBe(true)
    compiler.dispose()
  })

  it('rejects a fixed backdrop that would sample a different document area after scrolling', () => {
    const { label, getStyle, compile, compiler } = fixture()
    getStyle(label).backdropFilter = 'blur(2px)'
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    expect(compile().scrollTranslationSafe).not.toBe(true)
    compiler.dispose()
  })

  it('allows the registered pane to own its native fallback backdrop style', () => {
    const { pane, getStyle, compile, compiler } = fixture()
    getStyle(pane).backdropFilter = 'blur(2px)'
    const result = compile()
    expect(result.issues).toEqual([])
    expect(result.scrollTranslationSafe).toBe(true)
    compiler.dispose()
  })

  it.each(['missing', 'invalid', 'empty disjoint'])('rejects %s capture bounds', (kind) => {
    const { root, glasses, navigation, compiler } = fixture()
    const input =
      kind === 'missing' ? undefined : kind === 'invalid' ? { ...region, width: NaN } : region
    const result = compiler.compile(
      root,
      glasses,
      frame,
      'white',
      input,
      kind === 'empty disjoint' ? [] : undefined,
      navigation
    )
    expect(result.scrollTranslationSafe).not.toBe(true)
    compiler.dispose()
  })

  it.each(['detached', 'nonfixed', 'pane moved'])(
    'rejects a %s fixed-container relationship',
    (kind) => {
      const { navigation, pane, root, getStyle, compile, compiler } = fixture()
      if (kind === 'detached') root.remove()
      if (kind === 'nonfixed') getStyle(navigation).position = 'relative'
      if (kind === 'pane moved') root.append(pane)
      expect(compile().scrollTranslationSafe).not.toBe(true)
      compiler.dispose()
    }
  )

  it.each(['nested scene', 'shadow root', 'popover'])(
    'rejects %s in an otherwise culled subtree',
    (kind) => {
      const { child, compile, compiler } = fixture()
      if (kind === 'nested scene') child.setAttribute('data-liquid-glass-scene', '')
      if (kind === 'shadow root') child.attachShadow({ mode: 'open' })
      if (kind === 'popover') child.setAttribute('popover', '')
      expect(compile().scrollTranslationSafe).not.toBe(true)
      compiler.dispose()
    }
  )

  it('does not certify a compile containing unsupported visible paint', () => {
    const { canvas, getStyle, compile, compiler } = fixture()
    getStyle(canvas).filter = 'blur(2px)'
    const result = compile()
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.scrollTranslationSafe).not.toBe(true)
    compiler.dispose()
  })

  it('does not turn unreadable proof-only pseudo styles into a rendering error', () => {
    const { child, none, getStyle, readStyle, compile, compiler } = fixture()
    readStyle.mockImplementation((element, name) => {
      if (element === child && name === '::after') throw new Error('Unavailable CSSOM')
      return name ? none : getStyle(element)
    })
    const result = compile()
    expect(result.issues).toEqual([])
    expect(result.scrollTranslationSafe).not.toBe(true)
    compiler.dispose()
  })
})
