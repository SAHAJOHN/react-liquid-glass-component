import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import type * as PaintBox from '../scene/paint-box'

vi.mock('../scene/paint-box', async (original) => ({
  ...(await original<typeof PaintBox>()),
  createColorReader: () => (value: string) =>
    value === 'transparent' ? [0, 0, 0, 0] : [1, 1, 1, 1],
  paintBox: () => document.createElement('canvas'),
}))

const frame = { width: 400, height: 800, pixelRatio: 1, scrollX: 0, scrollY: 0 }
const pane = { x: 50, y: 20, width: 100, height: 50 }
const maskError = 'CSS masks and clip paths require native HTML rendering'
const gradient = 'linear-gradient(black 0px, black calc(100% - 24px), transparent 100%)'

function fixture() {
  const root = document.createElement('div')
  const masked = document.createElement('div')
  const child = document.createElement('div')
  const grandchild = document.createElement('span')
  root.append(masked)
  masked.append(child)
  child.append(grandchild)
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
  }
  function makeStyle() {
    const value = document.createElement('div').style
    for (const [name, initial] of Object.entries(defaults))
      Object.defineProperty(value, name, { value: initial, configurable: true, writable: true })
    const extra: Record<string, string> = {}
    vi.spyOn(value, 'getPropertyValue').mockImplementation((name) => {
      if (name in extra) return extra[name] ?? ''
      const camel = name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
      return Object.prototype.hasOwnProperty.call(value, camel) ? Reflect.get(value, camel) : ''
    })
    return { value, extra }
  }
  const rootStyle = makeStyle()
  const maskStyle = makeStyle()
  const childStyle = makeStyle()
  const grandchildStyle = makeStyle()
  const pseudoStyle = makeStyle()
  Object.defineProperty(pseudoStyle.value, 'content', { value: 'none', configurable: true })
  maskStyle.value.maskImage = gradient
  maskStyle.value.display = 'flex'
  maskStyle.value.overflowX = 'hidden'
  maskStyle.value.overflowY = 'auto'
  maskStyle.extra['mask-clip'] = 'border-box'
  maskStyle.extra['mask-composite'] = 'add'
  const styles = new Map<Element, CSSStyleDeclaration>([
    [root, rootStyle.value],
    [masked, maskStyle.value],
    [child, childStyle.value],
    [grandchild, grandchildStyle.value],
  ])
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (pseudo) return pseudoStyle.value
    const result = styles.get(element)
    if (!result) throw new Error('Missing fixture style')
    return result
  })
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 2000))
  const bounds = vi
    .spyOn(masked, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 900, 300, 200))
  vi.spyOn(child, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 900, 300, 200))
  vi.spyOn(grandchild, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 920, 40, 20))
  const compiler = createSceneCompiler(() => {})
  return {
    root,
    masked,
    child,
    grandchild,
    maskStyle,
    childStyle,
    pseudoStyle,
    bounds,
    compiler,
    styles,
  }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('intersecting gradient masked subtree integration', () => {
  it.each([
    ['WebKit', 'source-in, source-in'],
    ['Chromium', 'intersect, intersect'],
  ])(
    'composes a clipped group with %s properties and rejects additive blending',
    (_engine, prefixedComposite) => {
      const { root, maskStyle, bounds, compiler } = fixture()
      const horizontal =
        'linear-gradient(to right, transparent 0%, black 24px, black calc(100% - 24px), transparent 100%)'
      const vertical = 'linear-gradient(black 0%, black 20%, transparent 100%)'
      const image = `${horizontal}, ${vertical}`
      bounds.mockReturnValue(new DOMRect(0, 30, 300, 200))
      maskStyle.value.backgroundColor = 'red'
      maskStyle.value.maskImage = image
      Object.assign(maskStyle.extra, {
        '-webkit-mask-image': image,
        'mask-mode': 'match-source, match-source',
        'mask-clip': 'border-box, border-box',
        '-webkit-mask-clip': 'border-box, border-box',
        'mask-origin': 'border-box, border-box',
        '-webkit-mask-origin': 'border-box, border-box',
        'mask-position': '0% 0%, 0% 0%',
        '-webkit-mask-position': '0% 0%, 0% 0%',
        'mask-size': 'auto, auto',
        '-webkit-mask-size': 'auto, auto',
        'mask-repeat': 'repeat, repeat',
        '-webkit-mask-repeat': 'repeat, repeat',
        'mask-composite': 'intersect, intersect',
        '-webkit-mask-composite': prefixedComposite,
      })
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        fillStyle: '',
        globalCompositeOperation: 'source-over',
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      } as unknown as CanvasRenderingContext2D)
      const result = compiler.compile(root, new Map(), frame, 'white', pane)
      expect(result.issues).not.toContain(maskError)
      const group = result.scene.items.find((item) => item.kind === 'opacity-group' && item.mask)
      if (!group || group.kind !== 'opacity-group' || !group.mask)
        throw new Error('Expected an actual two-gradient mask')
      expect(group.mask.bitmap).toBeInstanceOf(HTMLCanvasElement)
      expect(group.mask.bitmap.width).toBe(300)
      expect(group.mask.bitmap.height).toBe(200)
      maskStyle.extra['mask-composite'] = 'add, add'
      expect(compiler.compile(root, new Map(), frame, 'white', pane).issues).toContain(maskError)
      compiler.dispose()
    }
  )
})
