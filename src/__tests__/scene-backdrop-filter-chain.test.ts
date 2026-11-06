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

vi.mock('../scene/backdrop-mask', () => ({
  paintBackdropMask: vi.fn(() => document.createElement('canvas')),
}))

const supported = 'blur(12px) saturate(1.8) brightness(1.1)'
const expected = { kind: 'backdrop', sigma: 12, filterSaturation: 1.8, filterBrightness: 1.1 }

describe('backdrop filter chain compiler integration', () => {
  it('emits all filter parameters before an unmasked card and its content', () => {
    const { root, cardStyle, compiler } = fixture()
    cardStyle.value.backdropFilter = supported
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).not.toContain(filterError)
    expect(result.scene.items.map((item) => item.kind)).toEqual(['backdrop', 'sprite', 'sprite'])
    expect(result.scene.items[0]).toMatchObject({ ...expected, radius: 15 })
    compiler.dispose()
  })

  it('emits a masked leaf with filter parameters and its mask bitmap', () => {
    const { root, card, cardStyle, compiler } = fixture()
    card.replaceChildren()
    cardStyle.value.backdropFilter = supported
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
    cardStyle.extra['-webkit-mask-image'] = gradient
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).not.toContain(filterError)
    expect(result.issues).not.toContain(maskError)
    expect(result.scene.items[0]).toMatchObject({
      ...expected,
      radius: 0,
      bitmap: expect.any(HTMLCanvasElement),
    })
    compiler.dispose()
  })

  it('uses a supported prefixed filter when the standard value is none', () => {
    const { root, cardStyle, compiler } = fixture()
    cardStyle.value.backdropFilter = 'none'
    cardStyle.extra['-webkit-backdrop-filter'] = supported
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).not.toContain(filterError)
    expect(result.scene.items[0]).toMatchObject(expected)
    compiler.dispose()
  })

  it.each([
    'blur(12px) brightness(1.1) saturate(1.8)',
    'url(#glass-filter) saturate(1.8)',
    'blur(12px) contrast(1.2)',
    'blur(12px) saturate(1.8) brightness(4.1)',
  ])('keeps unsupported filter %s on the native path', (value) => {
    const { root, cardStyle, compiler } = fixture()
    cardStyle.value.backdropFilter = value
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(filterError)
    expect(result.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    compiler.dispose()
  })

  it('does not accept conflicting standard and prefixed filter values', () => {
    const { root, cardStyle, compiler } = fixture()
    cardStyle.value.backdropFilter = supported
    cardStyle.extra['-webkit-backdrop-filter'] = 'blur(12px) saturate(1.8) brightness(1.2)'
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(filterError)
    expect(result.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    compiler.dispose()
  })

  it('does not flatten a filter chain across an ancestor backdrop root', () => {
    const { root, cardStyle, wrapperStyle, compiler } = fixture()
    cardStyle.value.backdropFilter = supported
    wrapperStyle.value.filter = 'blur(0px)'
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(filterError)
    expect(result.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    compiler.dispose()
  })

  it('keeps the filter chain inside a supported opacity group', () => {
    const { root, cardStyle, compiler } = fixture()
    cardStyle.value.backdropFilter = supported
    cardStyle.value.opacity = '0.5'
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).not.toContain(filterError)
    expect(result.scene.items[0]).toMatchObject({
      kind: 'opacity-group',
      opacity: 0.5,
      items: [expect.objectContaining(expected), expect.anything(), expect.anything()],
    })
    compiler.dispose()
  })
})
