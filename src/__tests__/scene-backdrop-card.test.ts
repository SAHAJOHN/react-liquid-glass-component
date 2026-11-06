import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import { paintBoxShadows } from '../scene/paint-shadow'
import type * as PaintBoxModule from '../scene/paint-box'

vi.mock('../scene/paint-shadow', () => ({ paintBoxShadows: vi.fn() }))
vi.mock('../scene/paint-box', async (importOriginal) => ({
  ...(await importOriginal<typeof PaintBoxModule>()),
  createColorReader: () => (value: string) =>
    value === 'transparent' ? [0, 0, 0, 0] : [1, 1, 1, 1],
  paintBox: vi.fn(() => document.createElement('canvas')),
}))

const frame = { scrollX: 0, scrollY: 0, width: 400, height: 800, pixelRatio: 1 }
const region = { x: 0, y: 0, width: 300, height: 300 }
const filterError = 'CSS filters outside LiquidGlass require native HTML rendering'
const maskError = 'CSS masks and clip paths require native HTML rendering'

function fixture() {
  const root = document.createElement('div')
  const wrapper = document.createElement('div')
  const card = document.createElement('div')
  const child = document.createElement('button')
  root.append(wrapper)
  wrapper.append(card)
  card.append(child)
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
  }
  const style = () => {
    const value = document.createElement('div').style
    for (const [key, initial] of Object.entries(defaults))
      Object.defineProperty(value, key, { value: initial, writable: true, configurable: true })
    const extra: Record<string, string> = {
      'mask-image': 'none',
      '-webkit-mask-image': 'none',
      'mask-border-source': 'none',
      '-webkit-mask-box-image-source': 'none',
    }
    vi.spyOn(value, 'getPropertyValue').mockImplementation((key) => {
      if (key in extra) return extra[key] ?? ''
      const camel = key.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
      if (!Object.prototype.hasOwnProperty.call(value, camel)) return ''
      const result = Reflect.get(value, camel)
      return typeof result === 'string' ? result : ''
    })
    return { value, extra }
  }
  const rootStyle = style()
  const wrapperStyle = style()
  const cardStyle = style()
  const childStyle = style()
  const pseudoStyle = style()
  Object.defineProperty(pseudoStyle.value, 'content', { value: 'none' })
  cardStyle.value.backdropFilter = 'blur(12px)'
  cardStyle.value.backgroundColor = 'white'
  cardStyle.value.borderTopWidth = '1px'
  cardStyle.value.borderRightWidth = '1px'
  cardStyle.value.borderBottomWidth = '1px'
  cardStyle.value.borderLeftWidth = '1px'
  cardStyle.value.borderTopLeftRadius = '15px'
  cardStyle.value.borderTopRightRadius = '15px'
  cardStyle.value.borderBottomRightRadius = '15px'
  cardStyle.value.borderBottomLeftRadius = '15px'
  childStyle.value.backgroundColor = 'white'
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 800))
  vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 800))
  vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(new DOMRect(30, 40, 200, 100))
  vi.spyOn(child, 'getBoundingClientRect').mockReturnValue(new DOMRect(50, 60, 70, 30))
  const styles = new Map<Element, CSSStyleDeclaration>([
    [root, rootStyle.value],
    [wrapper, wrapperStyle.value],
    [card, cardStyle.value],
    [child, childStyle.value],
  ])
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (pseudo) return pseudoStyle.value
    const result = styles.get(element)
    if (!result) throw new Error('Unexpected element')
    return result
  })
  const context = { fillStyle: '', fillRect: vi.fn(), clearRect: vi.fn(), setTransform: vi.fn() }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  )
  vi.mocked(paintBoxShadows).mockReturnValue({ status: 'none' })
  const compiler = createSceneCompiler(() => {})
  return { root, wrapperStyle, card, cardStyle, childStyle, context, compiler }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('plain card backdrop integration', () => {
  it('paints the rounded blur before the card box and its child', () => {
    const { root, context, compiler } = fixture()
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).not.toContain(filterError)
    expect(result.scene.items.map((item) => item.kind)).toEqual(['backdrop', 'sprite', 'sprite'])
    expect(result.scene.items[0]).toMatchObject({ kind: 'backdrop', sigma: 12, radius: 15 })
    expect(context.fillRect).toHaveBeenCalled()
    compiler.dispose()
  })

  it('paints a card with identity blur and preserves its fixed containing block', () => {
    const { root, cardStyle, childStyle, compiler } = fixture()
    cardStyle.value.filter = 'blur(0px)'
    cardStyle.value.backdropFilter = 'blur(10px)'
    childStyle.value.position = 'fixed'
    const result = compiler.compile(root, new Map(), { ...frame, scrollY: 100 }, 'white', region)
    expect(result.issues).not.toContain(filterError)
    expect(result.scene.items[0]).toMatchObject({ kind: 'backdrop', sigma: 10, radius: 15 })
    expect(result.targets[0]).toMatchObject({ space: 'document', rect: { y: 160 } })
    compiler.dispose()
  })

  it('keeps a nested backdrop within an identity-filtered card in fallback', () => {
    const { root, cardStyle, childStyle, compiler } = fixture()
    cardStyle.value.filter = 'blur(0px)'
    cardStyle.value.backdropFilter = 'blur(10px)'
    childStyle.value.backdropFilter = 'blur(4px)'
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(filterError)
    expect(result.scene.items.filter((item) => item.kind === 'backdrop')).toHaveLength(1)
    expect(result.scene.items[0]).toMatchObject({ kind: 'backdrop', sigma: 10 })
    compiler.dispose()
  })

  it('paints the backdrop before the card shadow and contents', () => {
    const { root, cardStyle, compiler } = fixture()
    cardStyle.value.boxShadow = 'rgb(0, 0, 0) 0px 3px 8px'
    const shadow = {
      bitmap: document.createElement('canvas'),
      offsetX: -10,
      offsetY: -10,
      width: 220,
      height: 120,
    }
    vi.mocked(paintBoxShadows).mockReturnValue({ status: 'ready', outer: shadow })
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).not.toContain(filterError)
    expect(result.scene.items.map((item) => item.kind)).toEqual([
      'backdrop',
      'sprite',
      'sprite',
      'sprite',
    ])
    expect(result.scene.items[1]).toMatchObject({ kind: 'sprite', bitmap: shadow.bitmap })
    compiler.dispose()
  })

  it('composes an inset shadow on a rounded backdrop card', () => {
    const { root, cardStyle, compiler } = fixture()
    cardStyle.value.boxShadow = 'inset rgb(0, 0, 0) 0px 3px 8px'
    const shadow = {
      bitmap: document.createElement('canvas'),
      offsetX: 0,
      offsetY: 0,
      width: 200,
      height: 100,
    }
    vi.mocked(paintBoxShadows).mockReturnValue({ status: 'ready', inset: shadow })
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).not.toContain(
      'Inset shadows on backdrop-filter elements require native HTML rendering'
    )
    compiler.dispose()
  })

  it('keeps conflicting standard and prefixed backdrop filters in fallback', () => {
    const { root, cardStyle, compiler } = fixture()
    cardStyle.value.backdropFilter = 'blur(12px)'
    cardStyle.extra['-webkit-backdrop-filter'] = 'blur(4px)'
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(filterError)
    expect(result.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    compiler.dispose()
  })

  it('keeps conflicting standard and prefixed mask images in fallback', () => {
    const { root, card, cardStyle, compiler } = fixture()
    card.replaceChildren()
    cardStyle.value.backgroundColor = 'transparent'
    cardStyle.value.borderTopWidth = '0px'
    cardStyle.value.borderRightWidth = '0px'
    cardStyle.value.borderBottomWidth = '0px'
    cardStyle.value.borderLeftWidth = '0px'
    cardStyle.value.borderTopLeftRadius = '0px'
    cardStyle.value.borderTopRightRadius = '0px'
    cardStyle.value.borderBottomRightRadius = '0px'
    cardStyle.value.borderBottomLeftRadius = '0px'
    const gradient = 'linear-gradient(transparent, black)'
    cardStyle.value.maskImage = gradient
    cardStyle.extra['mask-image'] = gradient
    cardStyle.extra['-webkit-mask-image'] = 'linear-gradient(black, transparent)'
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(maskError)
    expect(result.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    compiler.dispose()
  })

  it.each([
    ['unequal corners', 'borderTopLeftRadius', '10px'],
    ['elliptical corners', 'borderTopLeftRadius', '15px 10px'],
  ])('retains fallback for %s', (_label, property, value) => {
    const { root, cardStyle, compiler } = fixture()
    Object.defineProperty(cardStyle.value, property, { value, configurable: true })
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(filterError)
    expect(result.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    compiler.dispose()
  })

  it('keeps masked non-leaf content in fallback', () => {
    const { root, cardStyle, compiler } = fixture()
    const gradient = 'linear-gradient(transparent, black)'
    cardStyle.value.maskImage = gradient
    cardStyle.extra['mask-image'] = gradient
    cardStyle.extra['-webkit-mask-image'] = gradient
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(maskError)
    expect(result.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    compiler.dispose()
  })

  it('keeps a prefixed-only mask on a backdrop card in fallback', () => {
    const { root, cardStyle, compiler } = fixture()
    cardStyle.value.maskImage = 'none'
    cardStyle.extra['mask-image'] = 'none'
    cardStyle.extra['-webkit-mask-image'] = 'linear-gradient(transparent, black)'
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(maskError)
    expect(result.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    compiler.dispose()
  })

  it('keeps a prefixed-only mask without a backdrop filter in fallback', () => {
    const { root, cardStyle, compiler } = fixture()
    cardStyle.value.backdropFilter = 'none'
    cardStyle.value.maskImage = 'none'
    cardStyle.extra['mask-image'] = 'none'
    cardStyle.extra['-webkit-mask-image'] = 'linear-gradient(transparent, black)'
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(maskError)
    expect(result.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    compiler.dispose()
  })

  it('composites a backdrop card as one opacity group', () => {
    const { root, cardStyle, compiler } = fixture()
    cardStyle.value.opacity = '0.5'
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).not.toContain(filterError)
    const group = result.scene.items.find((item) => item.kind === 'opacity-group')
    expect(group?.opacity).toBe(0.5)
    if (!group || group.kind !== 'opacity-group') throw new Error('Missing opacity group')
    expect(group.items[0]).toMatchObject({ kind: 'backdrop' })
    compiler.dispose()
  })

  it('keeps filter chains in fallback', () => {
    const { root, cardStyle, compiler } = fixture()
    cardStyle.value.backdropFilter = 'blur(12px) contrast(1.2)'
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(filterError)
    expect(result.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    compiler.dispose()
  })

  it('keeps fallback when an ancestor establishes a backdrop root', () => {
    const { root, wrapperStyle, compiler } = fixture()
    wrapperStyle.value.opacity = '0.5'
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(filterError)
    expect(result.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    compiler.dispose()
  })
})
