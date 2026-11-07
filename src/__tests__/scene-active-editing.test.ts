import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import type * as BoxModule from '../scene/paint-box'
import type * as ShadowModule from '../scene/paint-shadow'

vi.mock('../scene/paint-box', async (importOriginal) => ({
  ...(await importOriginal<typeof BoxModule>()),
  createColorReader: () => (value: string) =>
    value === 'transparent' ? [0, 0, 0, 0] : [1, 1, 1, 1],
  paintBox: () => document.createElement('canvas'),
}))
vi.mock('../scene/paint-shadow', async (importOriginal) => ({
  ...(await importOriginal<typeof ShadowModule>()),
  paintBoxShadows: () => ({ status: 'none' }),
}))

const frame = { width: 400, height: 800, pixelRatio: 1, scrollX: 0, scrollY: 0 }
const pane = { x: 40, y: 20, width: 200, height: 80 }
const activeError = 'Active text editing requires native HTML rendering'
const groupError = 'CSS group opacity requires native HTML rendering'

function fixture(tag: 'input' | 'textarea' = 'input') {
  const root = document.createElement('main')
  const control = document.createElement(tag)
  if (control instanceof HTMLInputElement) control.type = 'text'
  control.value = 'Editing'
  root.append(control)
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
    outlineWidth: '0px',
    outlineOffset: '0px',
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
    borderTopWidth: '1px',
    borderRightWidth: '1px',
    borderBottomWidth: '1px',
    borderLeftWidth: '1px',
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'solid',
    borderLeftStyle: 'solid',
    borderTopColor: 'black',
    borderRightColor: 'black',
    borderBottomColor: 'black',
    borderLeftColor: 'black',
    borderTopLeftRadius: '8px',
    borderTopRightRadius: '8px',
    borderBottomRightRadius: '8px',
    borderBottomLeftRadius: '8px',
    paddingLeft: '12px',
    paddingRight: '12px',
    paddingTop: '8px',
    paddingBottom: '8px',
    color: 'black',
    font: '16px sans-serif',
    fontFamily: 'sans-serif',
    fontSize: '16px',
    fontWeight: '400',
    fontStyle: 'normal',
    letterSpacing: 'normal',
    lineHeight: 'normal',
    textTransform: 'none',
    textDecorationLine: 'none',
    textAlign: 'left',
    textOverflow: 'clip',
    appearance: 'none',
  }
  function makeStyle(overrides: Record<string, string> = {}) {
    const value = document.createElement('div').style
    for (const [name, initial] of Object.entries({ ...defaults, ...overrides }))
      Object.defineProperty(value, name, { value: initial, configurable: true, writable: true })
    const extra: Record<string, string> = {}
    vi.spyOn(value, 'getPropertyValue').mockImplementation((name) => {
      if (name in extra) return extra[name] ?? ''
      const camel = name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
      return Object.prototype.hasOwnProperty.call(value, camel) ? Reflect.get(value, camel) : ''
    })
    return { value, extra }
  }
  const rootStyle = makeStyle({ backgroundColor: 'transparent' })
  const controlStyle = makeStyle()
  const placeholderStyle = makeStyle({ color: 'gray' })
  const pseudoStyle = makeStyle({ content: 'none' })
  const styles = new Map<Element, CSSStyleDeclaration>([
    [root, rootStyle.value],
    [control, controlStyle.value],
  ])
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (pseudo === '::placeholder') return placeholderStyle.value
    if (pseudo) return pseudoStyle.value
    const style = styles.get(element)
    if (!style) throw new Error('Missing fixture style')
    return style
  })
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 1600))
  const bounds = vi
    .spyOn(control, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(40, 600, 300, 48))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    measureText: () => ({ width: 50, actualBoundingBoxAscent: 12 }),
    scale: vi.fn(),
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  control.focus()
  const compiler = createSceneCompiler(() => {})
  return { root, control, rootStyle, controlStyle, styles, makeStyle, bounds, compiler }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('active text editing outside glass sampling regions', () => {
  it.each(['input', 'textarea'] as const)(
    'keeps a focused %s native without falling back while it is outside the glass',
    (tag) => {
      const { root, control, bounds, compiler } = fixture(tag)
      expect(document.activeElement).toBe(control)

      const outside = compiler.compile(root, new Map(), frame, 'white', pane)
      expect(outside.issues).not.toContain(activeError)
      expect(outside.liveGeometry).toBe(true)
      expect(outside.scrollTranslationSafe).not.toBe(true)

      bounds.mockReturnValue(new DOMRect(40, 30, 180, 48))
      expect(compiler.compile(root, new Map(), frame, 'white', pane).issues).toContain(activeError)

      control.blur()
      expect(compiler.compile(root, new Map(), frame, 'white', pane).issues).not.toContain(
        activeError
      )
      compiler.dispose()
    }
  )

  it('fails closed without sampling bounds or when focus paint can escape', () => {
    const { root, controlStyle, compiler } = fixture()
    expect(compiler.compile(root, new Map(), frame, 'white').issues).toContain(activeError)

    controlStyle.value.boxShadow = 'var(--unresolved-focus-ring)'
    expect(compiler.compile(root, new Map(), frame, 'white', pane).issues).toContain(activeError)
    compiler.dispose()
  })

  it('never defers active password fields', () => {
    const { root, control, compiler } = fixture()
    if (!(control instanceof HTMLInputElement)) throw new Error('Expected input')
    control.type = 'password'
    const result = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(result.issues).toContain(activeError)
    expect(result.issues).toContain('Password fields retain native HTML rendering')
    compiler.dispose()
  })

  it('does not let an off-region focus ring break an opacity group', () => {
    const { root, control, rootStyle, bounds, compiler } = fixture()
    const matches = control.matches.bind(control)
    vi.spyOn(control, 'matches').mockImplementation(
      (selector) => selector === ':focus-visible' || matches(selector)
    )
    rootStyle.value.opacity = '0.5'

    const outside = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(outside.issues).not.toContain(activeError)
    expect(outside.issues).not.toContain('CSS group opacity requires native HTML rendering')

    bounds.mockReturnValue(new DOMRect(40, 30, 180, 48))
    const overlapping = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(overlapping.issues).toContain(activeError)
    expect(overlapping.issues).toContain('CSS group opacity requires native HTML rendering')
    compiler.dispose()
  })

  it.each([
    {
      name: 'wide outline',
      effect: (style: CSSStyleDeclaration) => {
        style.outlineStyle = 'solid'
        style.outlineWidth = '100px'
      },
    },
    {
      name: 'outset box shadow',
      effect: (style: CSSStyleDeclaration) => {
        style.boxShadow = 'black 0px -100px 0px 0px'
      },
    },
  ])('keeps fallback when a focused $name reaches the glass', ({ effect }) => {
    const { root, control, rootStyle, controlStyle, bounds, compiler } = fixture()
    control.blur()
    const matches = control.matches.bind(control)
    vi.spyOn(control, 'matches').mockImplementation(
      (selector) => selector === ':focus-visible' || matches(selector)
    )
    rootStyle.value.opacity = '0.5'
    bounds.mockReturnValue(new DOMRect(40, 180, 180, 48))
    effect(controlStyle.value)

    expect(compiler.compile(root, new Map(), frame, 'white', pane).issues).toContain(
      'CSS group opacity requires native HTML rendering'
    )
    compiler.dispose()
  })

  it('allows a focused field outside glass inside a backdrop-filter card', () => {
    const { root, control, controlStyle, styles, makeStyle, bounds, compiler } = fixture()
    const card = document.createElement('div')
    root.insertBefore(card, control)
    card.append(control)
    const cardStyle = makeStyle({
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
      backdropFilter: 'blur(10px)',
      filter: 'blur(0px)',
      opacity: '0.5',
    })
    cardStyle.extra['-webkit-backdrop-filter'] = 'blur(10px)'
    styles.set(card, cardStyle.value)
    const cardBounds = vi
      .spyOn(card, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(20, 520, 360, 180))
    control.focus()
    expect(document.activeElement).toBe(control)
    controlStyle.value.outlineStyle = 'solid'
    controlStyle.value.outlineWidth = '3px'
    controlStyle.value.outlineOffset = '1px'
    controlStyle.value.boxShadow =
      'rgba(0, 0, 0, 0) 0px 0px 0px 1px, oklab(0.55 0.05 -0.1 / 0.5) 0px 0px 0px 3px'
    vi.stubGlobal('CSS', { supports: (property: string) => property === 'color' })

    const outside = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(outside.issues).not.toContain(activeError)
    expect(outside.issues).not.toContain(groupError)

    cardStyle.value.backdropFilter = 'url(#unknown-filter)'
    cardStyle.extra['-webkit-backdrop-filter'] = 'url(#unknown-filter)'
    cardBounds.mockReturnValue(new DOMRect(20, 0, 360, 700))
    expect(compiler.compile(root, new Map(), frame, 'white', pane).issues).toContain(activeError)
    cardBounds.mockReturnValue(new DOMRect(20, 520, 360, 180))
    cardStyle.value.backdropFilter = 'blur(10px)'
    cardStyle.extra['-webkit-backdrop-filter'] = 'blur(10px)'

    cardStyle.value.filter = 'blur(3px)'
    expect(compiler.compile(root, new Map(), frame, 'white', pane).issues).toContain(activeError)
    cardStyle.value.filter = 'none'

    cardBounds.mockReturnValue(new DOMRect(20, 10, 360, 150))
    bounds.mockReturnValue(new DOMRect(40, 30, 180, 48))
    const overlapping = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(overlapping.issues).toContain(activeError)
    expect(overlapping.issues).toContain(groupError)
    compiler.dispose()
  })

  it.each([
    { space: 'document', position: 'static' },
    { space: 'viewport', position: 'fixed' },
  ])('compares $space active editor bounds in viewport coordinates', ({ position }) => {
    const { root, controlStyle, bounds, compiler } = fixture()
    controlStyle.value.position = position
    const scrolled = { ...frame, scrollY: 12_000 }

    bounds.mockReturnValue(new DOMRect(40, 430, 300, 48))
    expect(compiler.compile(root, new Map(), scrolled, 'white', pane).issues).not.toContain(
      activeError
    )

    bounds.mockReturnValue(new DOMRect(40, 50, 180, 48))
    expect(compiler.compile(root, new Map(), scrolled, 'white', pane).issues).toContain(activeError)
    compiler.dispose()
  })
})
