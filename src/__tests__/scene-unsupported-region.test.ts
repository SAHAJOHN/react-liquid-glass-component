import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import type * as PaintBox from '../scene/paint-box'
import * as paintContent from '../scene/paint-content'

vi.mock('../scene/paint-box', async (original) => ({
  ...(await original<typeof PaintBox>()),
  createColorReader: () => (value: string) =>
    value === 'transparent' ? [0, 0, 0, 0] : [1, 1, 1, 1],
  paintBox: () => document.createElement('canvas'),
}))

const frame = { width: 400, height: 800, pixelRatio: 1, scrollX: 0, scrollY: 0 }
const region = { x: 0, y: 0, width: 200, height: 80 }
const filterError = 'CSS filters outside LiquidGlass require native HTML rendering'
const shadowError = 'CSS text shadows require native HTML rendering'
const clipTextError = 'Text-clipped and fixed CSS backgrounds require native HTML rendering'

function fixture() {
  const root = document.createElement('main')
  const clipped = document.createElement('section')
  const effect = document.createElement('div')
  const label = document.createElement('span')
  label.append(document.createTextNode('Effect'))
  effect.append(label)
  root.append(clipped)
  clipped.append(effect)
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
    textOverflow: 'clip',
    borderTopWidth: '0px',
    borderRightWidth: '0px',
    borderBottomWidth: '0px',
    borderLeftWidth: '0px',
    borderTopStyle: 'none',
    borderRightStyle: 'none',
    borderBottomStyle: 'none',
    borderLeftStyle: 'none',
    borderTopColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
    borderTopLeftRadius: '0px',
    borderTopRightRadius: '0px',
    borderBottomRightRadius: '0px',
    borderBottomLeftRadius: '0px',
  }
  function style(overrides: Record<string, string> = {}) {
    const result = document.createElement('div').style
    const properties: Record<string, string> = {}
    for (const [key, value] of Object.entries({ ...defaults, ...overrides }))
      Object.defineProperty(result, key, { value, writable: true, configurable: true })
    vi.spyOn(result, 'getPropertyValue').mockImplementation((name) => {
      if (name in properties) return properties[name] ?? ''
      const camel = name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
      return Object.prototype.hasOwnProperty.call(result, camel) ? Reflect.get(result, camel) : ''
    })
    return { value: result, properties }
  }
  const rootStyle = style()
  const clippedStyle = style({ position: 'relative', overflowX: 'hidden', overflowY: 'hidden' })
  const effectStyle = style()
  const labelStyle = style()
  const pseudoStyle = style({ content: 'none' })
  const styles = new Map<Element, CSSStyleDeclaration>([
    [root, rootStyle.value],
    [clipped, clippedStyle.value],
    [effect, effectStyle.value],
    [label, labelStyle.value],
  ])
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (pseudo) return pseudoStyle.value
    const result = styles.get(element)
    if (!result) throw new Error('Missing fixture style')
    return result
  })
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 2000))
  vi.spyOn(clipped, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 2000))
  const effectRect = vi
    .spyOn(effect, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(100, 1600, 100, 40))
  const labelRect = vi
    .spyOn(label, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(110, 1610, 60, 20))
  vi.spyOn(document, 'createRange').mockReturnValue({
    selectNodeContents: vi.fn(),
    setStart: vi.fn(),
    setEnd: vi.fn(),
    getBoundingClientRect: () => label.getBoundingClientRect(),
  } as unknown as Range)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    scale: vi.fn(),
    translate: vi.fn(),
    setTransform: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    measureText: () => ({
      width: 60,
      actualBoundingBoxLeft: 2,
      actualBoundingBoxRight: 60,
      actualBoundingBoxAscent: 16,
      actualBoundingBoxDescent: 4,
    }),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(paintContent, 'paintText').mockReturnValue(document.createElement('canvas'))
  const compiler = createSceneCompiler(() => {})
  return {
    root,
    effect,
    label,
    clippedStyle,
    effectStyle,
    labelStyle,
    pseudoStyle,
    styles,
    effectRect,
    labelRect,
    compiler,
  }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('unsupported effect region deferral', () => {
  it('treats prefixed backdrop none as absent and fails closed for a real backdrop', () => {
    const { root, clippedStyle, effectStyle, compiler } = fixture()
    effectStyle.value.filter = 'drop-shadow(0px 0px 4px black)'
    clippedStyle.properties['-webkit-backdrop-filter'] = 'none'
    expect(compiler.compile(root, new Map(), frame, 'white', region).issues).not.toContain(
      filterError
    )

    clippedStyle.properties['-webkit-backdrop-filter'] = 'blur(3px)'
    expect(compiler.compile(root, new Map(), frame, 'white', region).issues).toContain(filterError)
    compiler.dispose()
  })

  it('uses a successfully rasterized text shadow and retains fallback when painting fails', () => {
    const { root, labelStyle, compiler } = fixture()
    vi.stubGlobal('CSS', { supports: () => true })
    labelStyle.value.textShadow = 'rgb(0, 0, 0) 0px 2px 4px'
    labelStyle.properties['-webkit-text-fill-color'] = 'rgb(0, 0, 0)'

    const supported = compiler.compile(root, new Map(), frame, 'white')
    expect(supported.issues).not.toContain(shadowError)

    vi.mocked(paintContent.paintText).mockImplementation(() => {
      throw new Error('paint failed')
    })
    labelStyle.value.fontWeight = '500'
    expect(compiler.compile(root, new Map(), frame, 'white').issues).toContain(shadowError)
    compiler.dispose()
  })

  it('rasterizes clipped gradient glyphs without painting their gradient as a box', () => {
    const { root, labelStyle, compiler } = fixture()
    vi.stubGlobal('CSS', { supports: () => true })
    labelStyle.value.backgroundClip = 'text'
    labelStyle.value.backgroundImage = 'linear-gradient(90deg, red, blue)'
    labelStyle.value.backgroundColor = 'transparent'
    labelStyle.properties['-webkit-text-fill-color'] = 'transparent'

    const result = compiler.compile(root, new Map(), frame, 'white')
    expect(result.issues).not.toContain(clipTextError)
    expect(result.scene.items.filter((item) => item.kind === 'sprite')).toHaveLength(1)
    compiler.dispose()
  })

  it('defers a bounded drop shadow until its halo reaches the glass', () => {
    const { root, effectStyle, effectRect, labelRect, compiler } = fixture()
    effectStyle.value.filter = 'drop-shadow(rgba(0, 0, 0, 0.5) 0px 0px 4px)'

    const outside = compiler.compile(root, new Map(), frame, 'white', region)
    expect(outside.issues).not.toContain(filterError)
    expect(outside.liveGeometry).toBe(true)
    expect(outside.scrollTranslationSafe).not.toBe(true)

    effectRect.mockReturnValue(new DOMRect(100, 65, 100, 40))
    labelRect.mockReturnValue(new DOMRect(110, 75, 60, 20))
    expect(compiler.compile(root, new Map(), frame, 'white', region).issues).toContain(filterError)
    compiler.dispose()
  })

  it('defers bounded text shadows and clipped gradient text outside the glass', () => {
    const { root, effectStyle, effectRect, labelRect, compiler } = fixture()
    effectStyle.value.textShadow = 'rgba(0, 0, 0, 0.5) 0px 2px 4px'
    effectStyle.value.backgroundClip = 'text'

    const outside = compiler.compile(root, new Map(), frame, 'white', region)
    expect(outside.issues).not.toContain(shadowError)
    expect(outside.issues).not.toContain(clipTextError)

    effectRect.mockReturnValue(new DOMRect(100, 20, 100, 40))
    labelRect.mockReturnValue(new DOMRect(110, 30, 60, 20))
    const inside = compiler.compile(root, new Map(), frame, 'white', region)
    expect(inside.issues).toContain(shadowError)
    expect(inside.issues).toContain(clipTextError)
    compiler.dispose()
  })

  it('adds text-shadow and filter outsets before declaring the effect outside', () => {
    const { root, effectStyle, effectRect, labelRect, compiler } = fixture()
    effectStyle.value.filter = 'blur(4px)'
    effectStyle.value.textShadow = 'rgba(0, 0, 0, 0.5) 0px 2px 4px'
    effectRect.mockReturnValue(new DOMRect(100, 100, 100, 40))
    labelRect.mockReturnValue(new DOMRect(110, 110, 60, 20))

    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(filterError)
    expect(result.issues).toContain(shadowError)
    compiler.dispose()
  })

  it('keeps large glyph overhang near the region on the fallback path', () => {
    const { root, effectStyle, labelStyle, effectRect, labelRect, compiler } = fixture()
    effectStyle.value.backgroundClip = 'text'
    labelStyle.value.fontSize = '32px'
    effectRect.mockReturnValue(new DOMRect(100, 92, 100, 40))
    labelRect.mockReturnValue(new DOMRect(110, 92, 60, 32))

    expect(compiler.compile(root, new Map(), frame, 'white', region).issues).toContain(
      clipTextError
    )
    compiler.dispose()
  })

  it('fails closed for unknown filters, generated content and fixed backgrounds', () => {
    const { root, effectStyle, pseudoStyle, compiler } = fixture()
    effectStyle.value.filter = 'url("private.svg#filter")'
    expect(compiler.compile(root, new Map(), frame, 'white', region).issues).toContain(filterError)

    effectStyle.value.filter = 'drop-shadow(0px 0px 4px black)'
    pseudoStyle.value.content = '"generated"'
    expect(compiler.compile(root, new Map(), frame, 'white', region).issues).toContain(filterError)

    pseudoStyle.value.content = 'none'
    effectStyle.value.filter = 'none'
    effectStyle.value.backgroundClip = 'text'
    effectStyle.value.backgroundAttachment = 'fixed'
    expect(compiler.compile(root, new Map(), frame, 'white', region).issues).toContain(
      clipTextError
    )
    compiler.dispose()
  })

  it('does not defer when an escaping descendant reaches the glass', () => {
    const { root, effectStyle, labelRect, compiler } = fixture()
    effectStyle.value.filter = 'drop-shadow(0px 0px 4px black)'
    labelRect.mockReturnValue(new DOMRect(100, 30, 60, 20))
    expect(compiler.compile(root, new Map(), frame, 'white', region).issues).toContain(filterError)
    compiler.dispose()
  })

  it.each(['matrix(2, 0, 0, 2, 0, 0)', 'matrix(0, 1, -1, 0, 0, 0)'])(
    'fails closed when %s can scale effect outsets',
    (transform) => {
      const { root, effectStyle, compiler } = fixture()
      vi.stubGlobal(
        'DOMMatrixReadOnly',
        class {
          is2D = true
          a: number
          b: number
          c: number
          d: number
          constructor(value: string) {
            const [a = 1, b = 0, c = 0, d = 1] = value
              .slice(value.indexOf('(') + 1, value.lastIndexOf(')'))
              .split(',')
              .map(Number)
            this.a = a
            this.b = b
            this.c = c
            this.d = d
          }
        }
      )
      effectStyle.value.filter = 'drop-shadow(0px 0px 4px black)'
      effectStyle.value.transform = transform
      expect(compiler.compile(root, new Map(), frame, 'white', region).issues).toContain(
        filterError
      )
      compiler.dispose()
    }
  )

  it('does not defer without a valid sampling region', () => {
    const { root, effectStyle, compiler } = fixture()
    effectStyle.value.filter = 'drop-shadow(0px 0px 4px black)'
    expect(compiler.compile(root, new Map(), frame, 'white').issues).toContain(filterError)
    expect(
      compiler.compile(root, new Map(), frame, 'white', { ...region, width: NaN }).issues
    ).toContain(filterError)
    compiler.dispose()
  })
})
