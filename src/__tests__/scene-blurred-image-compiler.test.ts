import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import { paintBoxShadows } from '../scene/paint-shadow'
import * as paintContent from '../scene/paint-content'
import type * as PaintBox from '../scene/paint-box'

vi.mock('../scene/paint-shadow', () => ({ paintBoxShadows: vi.fn() }))
vi.mock('../scene/paint-box', async (original) => ({
  ...(await original<typeof PaintBox>()),
  createColorReader: () => (value: string) =>
    value === 'transparent' ? [0, 0, 0, 0] : [1, 1, 1, 1],
  paintBox: () => document.createElement('canvas'),
}))

const frame = { width: 400, height: 800, pixelRatio: 1, scrollX: 0, scrollY: 0 }
const region = { x: 0, y: 0, width: 400, height: 100 }
const filterError = 'CSS filters outside LiquidGlass require native HTML rendering'

function fixture() {
  const root = document.createElement('main')
  const parent = document.createElement('div')
  const image = document.createElement('img')
  image.src = 'data:image/png;base64,AA=='
  parent.append(image)
  root.append(parent)
  document.body.append(root)
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 100 },
    naturalHeight: { configurable: true, value: 100 },
  })

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
    objectFit: 'fill',
    objectPosition: '50% 50%',
    color: 'black',
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
  const style = (overrides: Record<string, string> = {}) => {
    const result = document.createElement('div').style
    for (const [key, value] of Object.entries({ ...defaults, ...overrides }))
      Object.defineProperty(result, key, { value, writable: true, configurable: true })
    vi.spyOn(result, 'getPropertyValue').mockImplementation((name) => {
      const camel = name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
      return Object.prototype.hasOwnProperty.call(result, camel) ? Reflect.get(result, camel) : ''
    })
    return result
  }
  const rootStyle = style()
  const parentStyle = style({
    position: 'absolute',
    filter: 'blur(12px)',
    overflowX: 'hidden',
    overflowY: 'hidden',
    borderTopLeftRadius: '50%',
    borderTopRightRadius: '50%',
    borderBottomRightRadius: '50%',
    borderBottomLeftRadius: '50%',
  })
  const imageStyle = style({ position: 'absolute', objectFit: 'contain' })
  const pseudoStyle = style({ content: 'none' })
  const styles = new Map<Element, CSSStyleDeclaration>([
    [root, rootStyle],
    [parent, parentStyle],
    [image, imageStyle],
  ])
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (pseudo) return pseudoStyle
    const result = styles.get(element)
    if (!result) throw new Error('Missing fixture style')
    return result
  })
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 800))
  const parentRect = vi
    .spyOn(parent, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(100, 20, 100, 100))
  const imageRect = vi
    .spyOn(image, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(100, 20, 100, 100))

  const paints: Array<{ image: CanvasImageSource; style: CSSStyleDeclaration }> = []
  vi.spyOn(paintContent, 'paintImage').mockImplementation((source, width, height, ratio, style) => {
    paints.push({ image: source, style })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(width * ratio))
    canvas.height = Math.max(1, Math.ceil(height * ratio))
    return canvas
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA==')
  vi.mocked(paintBoxShadows).mockReturnValue({ status: 'none' })
  const decoded: HTMLImageElement[] = []
  vi.stubGlobal('Image', function Image() {
    const result = document.createElement('img')
    decoded.push(result)
    return result
  })
  const invalidate = vi.fn()
  const compiler = createSceneCompiler(invalidate)
  return {
    root,
    parentStyle,
    parentRect,
    imageRect,
    paints,
    decoded,
    invalidate,
    compiler,
  }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('single image blur compiler integration', () => {
  it('clips the source before blur and reuses its encoding through loading and movement', () => {
    const { root, parentRect, imageRect, paints, decoded, invalidate, compiler } = fixture()

    const loading = compiler.compile(root, new Map(), frame, 'white', region)
    expect(loading.issues).toEqual(['SVG is loading'])
    expect(paints[0]?.style.borderTopLeftRadius).toBe('50%')
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledOnce()
    const blurredAsset = decoded.find((image) => image.src.startsWith('data:image/svg+xml'))
    expect(blurredAsset).toBeDefined()

    blurredAsset?.dispatchEvent(new Event('load'))
    expect(invalidate).toHaveBeenCalledOnce()
    const ready = compiler.compile(root, new Map(), frame, 'white', region)
    expect(ready.issues).toEqual([])
    expect(ready.scene.items).toHaveLength(1)
    expect(ready.scene.items[0]?.rect).toEqual({ x: 62, y: -18, width: 176, height: 176 })

    parentRect.mockReturnValue(new DOMRect(100, 30, 100, 100))
    imageRect.mockReturnValue(new DOMRect(100, 30, 100, 100))
    const moved = compiler.compile(root, new Map(), frame, 'white', region)
    expect(moved.issues).toEqual([])
    expect(moved.scene.items[0]?.rect.y).toBe(-8)
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledOnce()
    compiler.dispose()
  })

  it('returns to fallback if the decoded blur asset later errors', () => {
    const { root, decoded, compiler } = fixture()
    expect(compiler.compile(root, new Map(), frame, 'white', region).issues).toEqual([
      'SVG is loading',
    ])
    const blurredAsset = decoded.find((image) => image.src.startsWith('data:image/svg+xml'))
    if (!blurredAsset) throw new Error('Expected blurred SVG asset')
    blurredAsset.dispatchEvent(new Event('load'))
    expect(compiler.compile(root, new Map(), frame, 'white', region).issues).toEqual([])
    blurredAsset.dispatchEvent(new Event('error'))
    const failed = compiler.compile(root, new Map(), frame, 'white', region)
    expect(failed.issues).toContain(filterError)
    expect(failed.issues).toContain('Blurred image could not be rendered')
    compiler.dispose()
  })

  it('fails closed when the child does not cover its filtered parent', () => {
    const { root, imageRect, compiler } = fixture()
    imageRect.mockReturnValue(new DOMRect(110, 30, 80, 80))
    expect(compiler.compile(root, new Map(), frame, 'white', region).issues).toContain(filterError)
    expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled()
    compiler.dispose()
  })
})
