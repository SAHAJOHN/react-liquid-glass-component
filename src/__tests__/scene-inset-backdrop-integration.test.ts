import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import { paintBoxShadows } from '../scene/paint-shadow'
import type * as PaintBoxModule from '../scene/paint-box'

vi.mock('../scene/paint-shadow', () => ({ paintBoxShadows: vi.fn() }))
vi.mock('../scene/paint-box', async (importOriginal) => ({
  ...(await importOriginal<typeof PaintBoxModule>()),
  createColorReader: () => (value: string) =>
    value === 'transparent' ? [0, 0, 0, 0] : [1, 1, 1, 1],
  paintBox: vi.fn(
    (
      _style: CSSStyleDeclaration,
      _width: number,
      _height: number,
      _ratio: number,
      _issues: Set<string>,
      _images: unknown,
      part?: string
    ) => {
      const canvas = document.createElement('canvas')
      canvas.dataset.layer = part ?? 'all'
      return canvas
    }
  ),
}))

const frame = { scrollX: 0, scrollY: 0, width: 400, height: 800, pixelRatio: 1 }
const region = { x: 0, y: 0, width: 300, height: 300 }
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

describe('backdrop inset layer integration', () => {
  it('paints backdrop, outer shadow, background, inset shadow, border, then children', () => {
    const { root, cardStyle, compiler } = fixture()
    for (const corner of [
      'borderTopLeftRadius',
      'borderTopRightRadius',
      'borderBottomRightRadius',
      'borderBottomLeftRadius',
    ] as const)
      cardStyle.value[corner] = '0px'
    cardStyle.value.boxShadow = 'black 0px 3px 8px, inset black 0px 1px 4px'
    const outer = {
      bitmap: document.createElement('canvas'),
      offsetX: -10,
      offsetY: -10,
      width: 220,
      height: 120,
    }
    const inset = {
      bitmap: document.createElement('canvas'),
      offsetX: 0,
      offsetY: 0,
      width: 200,
      height: 100,
    }
    outer.bitmap.dataset.layer = 'outer'
    inset.bitmap.dataset.layer = 'inset'
    vi.mocked(paintBoxShadows).mockReturnValue({ status: 'ready', outer, inset })
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).not.toContain(
      'Inset shadows on backdrop-filter elements require native HTML rendering'
    )
    expect(
      result.scene.items.map((item) =>
        item.kind === 'sprite' ? item.bitmap.dataset.layer : item.kind
      )
    ).toEqual(['backdrop', 'outer', 'background', 'inset', 'border', 'all'])
    compiler.dispose()
  })

  it('composes a rounded backdrop with inset shadow in layer order', () => {
    const { root, cardStyle, compiler } = fixture()
    cardStyle.value.boxShadow = 'inset black 0px 1px 4px'
    const inset = {
      bitmap: document.createElement('canvas'),
      offsetX: 0,
      offsetY: 0,
      width: 200,
      height: 100,
    }
    vi.mocked(paintBoxShadows).mockReturnValue({ status: 'ready', inset })
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).not.toContain(
      'Inset shadows on backdrop-filter elements require native HTML rendering'
    )
    compiler.dispose()
  })
})
