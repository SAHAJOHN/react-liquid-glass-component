import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import type * as PaintBox from '../scene/paint-box'
import type { SceneFrame, SceneRect } from '../scene/types'

vi.mock('../scene/paint-box', async (original) => ({
  ...(await original<typeof PaintBox>()),
  createColorReader: () => (value: string) =>
    value === 'transparent' ? [0, 0, 0, 0] : [1, 1, 1, 1],
  paintBox: () => document.createElement('canvas'),
}))

const frame: SceneFrame = { width: 400, height: 800, pixelRatio: 2, scrollX: 0, scrollY: 0 }
const pane: SceneRect = { x: 50, y: 20, width: 100, height: 50 }

function fixture() {
  const root = document.createElement('div')
  const image = document.createElement('img')
  const layer = document.createElement('div')
  // The DOM has rendered this cross-origin image, while the anonymous copy
  // needed for canvas is still loading.
  image.src = 'https://cdn.example.test/example.png'
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 20 },
    naturalHeight: { configurable: true, value: 5 },
  })
  root.append(image, layer)
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
  function style() {
    const result = document.createElement('div').style
    for (const [name, value] of Object.entries(defaults))
      Object.defineProperty(result, name, { value, configurable: true, writable: true })
    return result
  }
  const rootStyle = style()
  const imageStyle = style()
  const layerStyle = style()
  const pseudoStyle = style()
  Object.defineProperty(pseudoStyle, 'content', { value: 'none' })
  layerStyle.backdropFilter = 'blur(10px)'
  const styles = new Map<Element, CSSStyleDeclaration>([
    [root, rootStyle],
    [image, imageStyle],
    [layer, layerStyle],
  ])
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (pseudo) return pseudoStyle
    const result = styles.get(element)
    if (!result) throw new Error('Missing fixture style')
    return result
  })
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 800))
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect(75, 0, 20, 5))
  vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  const pending = document.createElement('img')
  vi.stubGlobal(
    'Image',
    vi.fn(function Image() {
      return pending
    })
  )
  return { root, image, layer, styles, compiler: createSceneCompiler(() => {}) }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('compiler backdrop sampling relevance', () => {
  it('reports a loading image outside the pane when a blur layer can sample it', () => {
    const { root, compiler } = fixture()
    const result = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(result.issues).toContain('Image is loading')
    compiler.dispose()
  })

  it('reports source media reachable through two backdrop layers', () => {
    const { root, layer, styles, compiler } = fixture()
    const other = document.createElement('div')
    const layerStyle = styles.get(layer)
    if (!layerStyle) throw new Error('Missing fixture style')
    root.append(other)
    styles.set(other, layerStyle)
    vi.mocked(layer.getBoundingClientRect).mockReturnValue(new DOMRect(0, 0, 200, 42))
    vi.spyOn(other, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 30, 200, 70))
    const result = compiler.compile(root, new Map(), frame, 'white', {
      x: 50,
      y: 60,
      width: 100,
      height: 10,
    })
    expect(result.issues).toContain('Image is loading')
    compiler.dispose()
  })

  it('detects a blur halo around either of two separated panes', () => {
    const { root, image, layer, compiler } = fixture()
    vi.mocked(image.getBoundingClientRect).mockReturnValue(new DOMRect(75, 570, 20, 5))
    vi.mocked(layer.getBoundingClientRect).mockReturnValue(new DOMRect(0, 560, 200, 100))
    const second = { x: 50, y: 600, width: 100, height: 50 }
    const combined = { x: 50, y: 20, width: 100, height: 630 }
    const result = compiler.compile(root, new Map(), frame, 'white', combined, [pane, second])
    expect(result.issues).toContain('Image is loading')
    compiler.dispose()
  })

  it('does not treat an unsupported bounded effect in a distant pane gap as relevant', () => {
    const { root, image, styles, compiler } = fixture()
    const effect = document.createElement('div')
    image.replaceWith(effect)
    const effectStyle = styles.get(image)
    if (!effectStyle) throw new Error('Missing fixture style')
    effectStyle.maskImage = 'linear-gradient(black, transparent)'
    styles.set(effect, effectStyle)
    vi.spyOn(effect, 'getBoundingClientRect').mockReturnValue(new DOMRect(75, 300, 20, 5))
    const second = { x: 50, y: 600, width: 100, height: 50 }
    const combined = { x: 50, y: 20, width: 100, height: 630 }
    const result = compiler.compile(root, new Map(), frame, 'white', combined, [pane, second])
    expect(result.issues).not.toContain('CSS masks and clip paths require native HTML rendering')
    expect(result.samplingWatches).toContainEqual({ element: effect, relation: 'outside' })
    compiler.dispose()
  })

  it('does not silently defer an unsupported mask within the blur source halo', () => {
    const { root, image, styles, compiler } = fixture()
    const effect = document.createElement('div')
    image.replaceWith(effect)
    const effectStyle = styles.get(image)
    if (!effectStyle) throw new Error('Missing fixture style')
    effectStyle.maskImage = 'linear-gradient(black, transparent)'
    styles.set(effect, effectStyle)
    vi.spyOn(effect, 'getBoundingClientRect').mockReturnValue(new DOMRect(75, 0, 20, 5))
    const result = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(result.issues).toContain('CSS masks and clip paths require native HTML rendering')
    compiler.dispose()
  })

  it('keeps backdrop geometry live while an unsupported effect moves through the pane', () => {
    const { root, layer, styles, compiler } = fixture()
    const layerStyle = styles.get(layer)
    if (!layerStyle) throw new Error('Missing fixture style')
    layerStyle.backdropFilter = 'url(#unrecognized)'
    vi.mocked(layer.getBoundingClientRect).mockReturnValue(new DOMRect(0, 300, 200, 100))
    const distant = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(distant.liveGeometry).toBe(true)
    expect(distant.issues).not.toContain(
      'CSS filters outside LiquidGlass require native HTML rendering'
    )
    vi.mocked(layer.getBoundingClientRect).mockReturnValue(new DOMRect(0, 20, 200, 100))
    const intersecting = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(intersecting.liveGeometry).toBe(true)
    expect(intersecting.issues).toContain(
      'CSS filters outside LiquidGlass require native HTML rendering'
    )
    compiler.dispose()
  })
})
