import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import { samplingBoundaryChanged } from '../scene/sampling-boundary'
import type * as PaintBox from '../scene/paint-box'
import * as subtreeMask from '../scene/subtree-mask'

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

describe('off-region masked subtree', () => {
  it('applies a shared ancestor clip only once around a rasterized masked group', () => {
    const { root, maskStyle, bounds, compiler, styles } = fixture()
    const rootStyle = styles.get(root)
    if (!rootStyle) throw new Error('Missing root style')
    rootStyle.overflowX = 'hidden'
    rootStyle.overflowY = 'hidden'
    bounds.mockReturnValue(new DOMRect(0, 30, 300, 200))
    maskStyle.value.backgroundColor = 'red'
    const bitmap = document.createElement('canvas')
    vi.spyOn(subtreeMask, 'paintSubtreeMask').mockReturnValue(bitmap)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D)
    const result = compiler.compile(root, new Map(), frame, 'white', pane)
    const group = result.scene.items.find((item) => item.kind === 'opacity-group')
    if (!group || group.kind !== 'opacity-group') throw new Error('Expected a masked group')
    expect(group.clips).toHaveLength(1)
    expect(group.items).toHaveLength(1)
    expect(group.items[0]?.clips).toBeUndefined()
    expect(group.items[0]?.clip).toBeUndefined()
    compiler.dispose()
  })
  it('composes a supported masked subtree once and fails closed for canvas media', () => {
    const { root, child, grandchild, maskStyle, childStyle, bounds, compiler, styles } = fixture()
    bounds.mockReturnValue(new DOMRect(0, 30, 300, 200))
    vi.spyOn(child, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 40, 100, 100))
    vi.spyOn(grandchild, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 50, 40, 20))
    maskStyle.value.backgroundColor = 'red'
    childStyle.value.backgroundColor = 'red'
    const bitmap = document.createElement('canvas')
    bitmap.width = 1
    bitmap.height = 100
    vi.spyOn(subtreeMask, 'paintSubtreeMask').mockReturnValue(bitmap)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D)
    const result = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(result.issues).not.toContain(maskError)
    expect(result.scene.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'opacity-group',
          mask: expect.objectContaining({ bitmap }),
        }),
      ])
    )
    const canvas = document.createElement('canvas')
    canvas.setAttribute('data-liquid-glass-canvas', '2d')
    child.append(canvas)
    childStyle.value.objectFit = 'fill'
    childStyle.value.objectPosition = '50% 50%'
    styles.set(canvas, childStyle.value)
    const canvasBounds = vi
      .spyOn(canvas, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(20, 50, 20, 20))
    const outside = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(outside.issues).not.toContain(maskError)
    expect(outside.samplingWatches).toContainEqual({ element: canvas, relation: 'outside' })
    canvasBounds.mockReturnValue(new DOMRect(60, 50, 20, 20))
    const withCanvas = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(withCanvas.issues).toContain(maskError)
    compiler.dispose()
  })

  it('preserves separately composed translucent descendants before masking the group', () => {
    const { root, child, grandchild, maskStyle, childStyle, bounds, compiler, styles } = fixture()
    const grandchildStyle = styles.get(grandchild)
    if (!grandchildStyle) throw new Error('Missing grandchild style')
    bounds.mockReturnValue(new DOMRect(0, 30, 300, 200))
    vi.spyOn(child, 'getBoundingClientRect').mockReturnValue(new DOMRect(60, 40, 60, 40))
    vi.spyOn(grandchild, 'getBoundingClientRect').mockReturnValue(new DOMRect(65, 45, 20, 20))
    maskStyle.value.backgroundColor = 'red'
    childStyle.value.backgroundColor = 'blue'
    childStyle.value.opacity = '0.5'
    grandchildStyle.backgroundColor = 'yellow'
    const mask = document.createElement('canvas')
    mask.width = 1
    mask.height = 200
    vi.spyOn(subtreeMask, 'paintSubtreeMask').mockReturnValue(mask)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D)

    const result = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(result.issues).not.toContain(maskError)
    const group = result.scene.items.find(
      (item) => item.kind === 'opacity-group' && item.mask?.bitmap === mask
    )
    if (!group || group.kind !== 'opacity-group') throw new Error('Expected masked GPU group')
    expect(group.items.map((item) => item.opacity)).toEqual([1, 0.5])
    expect(group.items[1]).toMatchObject({ kind: 'sprite' })

    grandchildStyle.opacity = '0.5'
    expect(compiler.compile(root, new Map(), frame, 'white', pane).issues).toContain(
      'CSS group opacity requires native HTML rendering'
    )
    compiler.dispose()
  })

  it('defers a bounded gradient-masked scrolling subtree and watches it entering the pane', () => {
    const { root, masked, bounds, compiler } = fixture()
    // The parser can reject a mask; entering its region must retain native rendering.
    vi.spyOn(subtreeMask, 'paintSubtreeMask').mockReturnValue(null)
    const distant = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(distant.issues).not.toContain(maskError)
    expect(distant.samplingWatches).toContainEqual({ element: masked, relation: 'outside' })
    expect(samplingBoundaryChanged(root, distant.samplingWatches ?? [], pane)).toBe(false)
    bounds.mockReturnValue(new DOMRect(0, 30, 300, 200))
    expect(samplingBoundaryChanged(root, distant.samplingWatches ?? [], pane)).toBe(true)
    expect(compiler.compile(root, new Map(), frame, 'white', pane).issues).toContain(maskError)
    compiler.dispose()
  })

  it('keeps a masked subtree above the proof budget on the native path', () => {
    const { root, masked, childStyle, compiler, styles } = fixture()
    for (let i = 0; i < 128; i += 1) {
      const node = document.createElement('div')
      node.hidden = true
      masked.append(node)
      styles.set(node, childStyle.value)
    }
    const result = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(result.issues).toContain(maskError)
    expect(result.samplingWatches).not.toContainEqual({ element: masked, relation: 'outside' })
    compiler.dispose()
  })

  it.each(['add', 'source-over'])(
    'defers an off-region subtree with the default prefixed %s composite',
    (composite) => {
      const { root, masked, maskStyle, compiler } = fixture()
      maskStyle.extra['-webkit-mask-composite'] = composite
      const result = compiler.compile(root, new Map(), frame, 'white', pane)
      expect(result.issues).not.toContain(maskError)
      expect(result.samplingWatches).toContainEqual({ element: masked, relation: 'outside' })
      compiler.dispose()
    }
  )

  it.each([
    [
      'external mask',
      (f: ReturnType<typeof fixture>) => {
        f.maskStyle.value.maskImage = 'url(#mask)'
      },
    ],
    [
      'multiple masks',
      (f: ReturnType<typeof fixture>) => {
        f.maskStyle.value.maskImage = `${gradient}, ${gradient}`
      },
    ],
    [
      'unclipped mask',
      (f: ReturnType<typeof fixture>) => {
        f.maskStyle.extra['mask-clip'] = 'no-clip'
      },
    ],
    [
      'composite',
      (f: ReturnType<typeof fixture>) => {
        f.maskStyle.extra['mask-composite'] = 'exclude'
      },
    ],
    [
      'prefixed composite',
      (f: ReturnType<typeof fixture>) => {
        f.maskStyle.extra['-webkit-mask-composite'] = 'destination-out'
      },
    ],
    [
      'filter',
      (f: ReturnType<typeof fixture>) => {
        f.maskStyle.value.filter = 'blur(5px)'
      },
    ],
    [
      'visible overflow',
      (f: ReturnType<typeof fixture>) => {
        f.maskStyle.value.overflowY = 'visible'
      },
    ],
    [
      'transformed group',
      (f: ReturnType<typeof fixture>) => {
        f.maskStyle.value.transform = 'matrix(1, 0, 0, 1, 2, 0)'
        vi.stubGlobal(
          'DOMMatrixReadOnly',
          class {
            readonly is2D = true
            readonly a = 1
            readonly b = 0
            readonly c = 0
            readonly d = 1
          }
        )
      },
    ],
    [
      'fixed child',
      (f: ReturnType<typeof fixture>) => {
        f.childStyle.value.position = 'fixed'
      },
    ],
    [
      'absolute child',
      (f: ReturnType<typeof fixture>) => {
        f.childStyle.value.position = 'absolute'
      },
    ],
    [
      'fixed pseudo',
      (f: ReturnType<typeof fixture>) => {
        Object.defineProperty(f.pseudoStyle.value, 'content', { value: '"x"', configurable: true })
        f.pseudoStyle.value.position = 'fixed'
      },
    ],
    [
      'top layer child',
      (f: ReturnType<typeof fixture>) => {
        f.grandchild.setAttribute('popover', '')
      },
    ],
  ])('does not defer an unsafe %s', (_description, change) => {
    const f = fixture()
    change(f)
    expect(f.compiler.compile(f.root, new Map(), frame, 'white', pane).issues).toContain(maskError)
    f.compiler.dispose()
  })
})
