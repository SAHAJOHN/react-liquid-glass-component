import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import * as mask from '../scene/backdrop-mask'
import * as pseudo from '../scene/paint-pseudo'
import type * as PaintBoxModule from '../scene/paint-box'

vi.mock('../scene/paint-box', async (importOriginal) => ({
  ...(await importOriginal<typeof PaintBoxModule>()),
  createColorReader: () => (value: string) =>
    value === 'transparent' ? [0, 0, 0, 0] : [1, 1, 1, 1],
  paintBox: () => document.createElement('canvas'),
  paintGradient: vi.fn(() => true),
}))

const frame = { scrollX: 0, scrollY: 100, width: 400, height: 800, pixelRatio: 1 }
const region = { x: 50, y: 300, width: 250, height: 150 }
const filterError = 'CSS filters outside LiquidGlass require native HTML rendering'
const maskError = 'CSS masks and clip paths require native HTML rendering'
const gradient = 'linear-gradient(to right, transparent 0%, black 50%, transparent 100%)'

function fixture() {
  const root = document.createElement('div')
  const wrapper = document.createElement('div')
  const leaf = document.createElement('div')
  root.append(wrapper)
  wrapper.append(leaf)
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
  function makeStyle() {
    const style = document.createElement('div').style
    for (const [key, value] of Object.entries(defaults))
      Object.defineProperty(style, key, { value, writable: true, configurable: true })
    const properties: Record<string, string> = {
      'mask-image': 'none',
      '-webkit-mask-image': 'none',
      'mask-mode': 'match-source',
      'mask-position': '0% 0%',
      '-webkit-mask-position': '0% 0%',
      'mask-size': 'auto',
      '-webkit-mask-size': 'auto',
      'mask-repeat': 'repeat',
      '-webkit-mask-repeat': 'repeat',
      'mask-origin': 'border-box',
      '-webkit-mask-origin': 'border-box',
      'mask-clip': 'border-box',
      '-webkit-mask-clip': 'border-box',
      'mask-composite': 'add',
      '-webkit-mask-composite': 'source-over',
      'mask-border-source': 'none',
      '-webkit-mask-box-image-source': 'none',
      'border-top-left-radius': '0px',
      'border-top-right-radius': '0px',
      'border-bottom-right-radius': '0px',
      'border-bottom-left-radius': '0px',
    }
    vi.spyOn(style, 'getPropertyValue').mockImplementation((name) => properties[name] ?? '')
    return { style, properties }
  }
  const rootStyle = makeStyle()
  const wrapperStyle = makeStyle()
  const leafStyle = makeStyle()
  const pseudoStyle = makeStyle()
  Object.defineProperty(pseudoStyle.style, 'content', { value: 'none' })
  leafStyle.style.backdropFilter = 'blur(12px)'
  leafStyle.style.maskImage = gradient
  leafStyle.properties['mask-image'] = gradient
  leafStyle.properties['-webkit-mask-image'] = gradient
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 1200))
  vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 1000))
  const leafRect = vi
    .spyOn(leaf, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(100, 310, 50, 50))
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudoName) => {
    if (pseudoName) return pseudoStyle.style
    return element === root
      ? rootStyle.style
      : element === wrapper
        ? wrapperStyle.style
        : leafStyle.style
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform: vi.fn(),
    fillRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.stubGlobal('CSS', {
    supports: (_property: string, color: string) =>
      /^(?:rgba?\(.*\)|black|transparent)$/.test(color),
  })
  const maskSpy = vi.spyOn(mask, 'paintBackdropMask')
  const compiler = createSceneCompiler(() => {})
  return { root, wrapper, leaf, rootStyle, wrapperStyle, leafStyle, leafRect, maskSpy, compiler }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('masked backdrop integration', () => {
  it('does not ignore a prefixed backdrop filter when the standard property is none', () => {
    const { root, leafStyle, compiler } = fixture()
    leafStyle.style.backdropFilter = 'none'
    leafStyle.style.maskImage = 'none'
    leafStyle.properties['mask-image'] = 'none'
    leafStyle.properties['-webkit-mask-image'] = 'none'
    leafStyle.properties['-webkit-backdrop-filter'] = 'blur(4px) contrast(1.1)'
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(filterError)
    expect(result.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    compiler.dispose()
  })

  it('emits a supported masked backdrop using the prefixed filter when standard is none', () => {
    const { root, leafStyle, compiler } = fixture()
    leafStyle.style.backdropFilter = 'none'
    leafStyle.properties['-webkit-backdrop-filter'] = 'blur(4px)'
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).not.toContain(filterError)
    expect(result.scene.items).toContainEqual(
      expect.objectContaining({ kind: 'backdrop', sigma: 4 })
    )
    compiler.dispose()
  })

  it('emits a masked backdrop blur item for an otherwise empty supported leaf', () => {
    const { root, compiler } = fixture()
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).not.toContain(filterError)
    expect(result.issues).not.toContain(maskError)
    expect(result.scene.items).toContainEqual(
      expect.objectContaining({
        kind: 'backdrop',
        sigma: 12,
        bitmap: expect.any(HTMLCanvasElement),
      })
    )
    compiler.dispose()
  })

  it('keeps a regular filter as fallback', () => {
    const { root, leafStyle, compiler } = fixture()
    leafStyle.style.filter = 'blur(2px)'
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(filterError)
    expect(result.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    compiler.dispose()
  })

  it('keeps a multi-layer mask as fallback', () => {
    const { root, leafStyle, compiler } = fixture()
    const value = `${gradient}, ${gradient}`
    leafStyle.style.maskImage = value
    leafStyle.properties['mask-image'] = value
    leafStyle.properties['-webkit-mask-image'] = value
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(maskError)
    expect(result.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    compiler.dispose()
  })

  it('keeps fallback when a supported gradient mask also has an independent clip path', () => {
    const { root, leafStyle, compiler } = fixture()
    leafStyle.style.clipPath = 'inset(10px)'
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(maskError)
    expect(result.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    compiler.dispose()
  })

  it.each(['filter', 'backdropFilter', 'opacity', 'maskImage', 'clipPath', 'mixBlendMode'])(
    'keeps an ancestor backdrop root from flattening across %s',
    (property) => {
      const { root, wrapperStyle, compiler } = fixture()
      const values: Record<string, string> = {
        filter: 'blur(0px)',
        backdropFilter: 'blur(2px)',
        opacity: '0.5',
        maskImage: gradient,
        clipPath: 'inset(0px)',
        mixBlendMode: 'multiply',
      }
      Object.defineProperty(wrapperStyle.style, property, {
        value: values[property],
        configurable: true,
      })
      const result = compiler.compile(root, new Map(), frame, 'white', region)
      expect(result.issues).toContain(filterError)
      expect(result.scene.items.some((item) => item.kind === 'backdrop' && item.sigma === 12)).toBe(
        false
      )
      compiler.dispose()
    }
  )

  it('composites a masked backdrop layer in an opacity group', () => {
    const { root, leafStyle, compiler } = fixture()
    leafStyle.style.opacity = '0.5'
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).not.toContain(filterError)
    const group = result.scene.items.find((item) => item.kind === 'opacity-group')
    expect(group?.opacity).toBe(0.5)
    if (!group || group.kind !== 'opacity-group') throw new Error('Missing opacity group')
    expect(group.items[0]).toMatchObject({ kind: 'backdrop' })
    compiler.dispose()
  })

  it('keeps individual transform fallback', () => {
    const { root, leafStyle, compiler } = fixture()
    Object.defineProperty(leafStyle.style, 'translate', {
      value: '5px 0px 2px',
      configurable: true,
    })
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(
      'Individual CSS transform properties require native HTML rendering; use transform instead'
    )
    compiler.dispose()
  })

  it('keeps a scaled backdrop effect as fallback', () => {
    const { root, leafStyle, compiler } = fixture()
    leafStyle.style.transform = 'matrix(2, 0, 0, 2, 0, 0)'
    vi.stubGlobal(
      'DOMMatrixReadOnly',
      class {
        readonly is2D = true
        readonly a = 2
        readonly b = 0
        readonly c = 0
        readonly d = 2
      }
    )
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(filterError)
    expect(result.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    compiler.dispose()
  })

  it('keeps descendant paint as fallback', () => {
    const { root, leaf, compiler } = fixture()
    leaf.append(document.createElement('span'))
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(filterError)
    expect(result.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    compiler.dispose()
  })

  it('keeps pseudo-element paint as fallback', () => {
    const { root, leaf, compiler } = fixture()
    vi.spyOn(pseudo, 'measurePseudoBox').mockImplementation((element) =>
      element === leaf
        ? {
            status: 'unsupported',
            reason: 'Pseudo-element effects require native HTML rendering',
            detail: 'PSEUDO_FILTER',
          }
        : { status: 'none' }
    )
    const result = compiler.compile(root, new Map(), frame, 'white', region)
    expect(result.issues).toContain(filterError)
    expect(result.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    compiler.dispose()
  })

  it('watches outside leaves and emits the effect when they enter', () => {
    const { root, leaf, leafRect, compiler } = fixture()
    leafRect.mockReturnValue(new DOMRect(100, 20, 50, 50))
    const outside = compiler.compile(root, new Map(), frame, 'white', region)
    expect(outside.issues).toEqual([])
    expect(outside.samplingWatches).toContainEqual({ element: leaf, relation: 'outside' })
    expect(outside.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    leafRect.mockReturnValue(new DOMRect(100, 310, 50, 50))
    expect(
      compiler
        .compile(root, new Map(), frame, 'white', region)
        .scene.items.some((item) => item.kind === 'backdrop')
    ).toBe(true)
    compiler.dispose()
  })

  it('invalidates cached masks when a prefixed mask border changes', () => {
    const { root, leafStyle, maskSpy, compiler } = fixture()
    expect(compiler.compile(root, new Map(), frame, 'white', region).issues).not.toContain(
      maskError
    )
    expect(maskSpy).toHaveBeenCalledTimes(1)
    leafStyle.properties['-webkit-mask-box-image-source'] = 'url(example.png)'
    const next = compiler.compile(root, new Map(), frame, 'white', region)
    expect(maskSpy).toHaveBeenCalledTimes(2)
    expect(next.issues).toContain(maskError)
    expect(next.scene.items.some((item) => item.kind === 'backdrop')).toBe(false)
    compiler.dispose()
  })

  it('regenerates a cached mask when its gradient changes', () => {
    const { root, leafStyle, maskSpy, compiler } = fixture()
    compiler.compile(root, new Map(), frame, 'white', region)
    compiler.compile(root, new Map(), frame, 'white', region)
    expect(maskSpy).toHaveBeenCalledTimes(1)
    const nextGradient = 'linear-gradient(to right, black 0%, transparent 100%)'
    leafStyle.style.maskImage = nextGradient
    leafStyle.properties['mask-image'] = nextGradient
    leafStyle.properties['-webkit-mask-image'] = nextGradient
    const next = compiler.compile(root, new Map(), frame, 'white', region)
    expect(maskSpy).toHaveBeenCalledTimes(2)
    expect(next.issues).not.toContain(maskError)
    expect(next.scene.items.some((item) => item.kind === 'backdrop')).toBe(true)
    compiler.dispose()
  })

  it('refreshes cached gradients after resolved currentColor and CSS variables change', () => {
    const { root, leafStyle, maskSpy, compiler } = fixture()
    const before = 'linear-gradient(rgba(255, 0, 0, 0.3), rgba(0, 0, 0, 0.2))'
    const after = 'linear-gradient(rgba(0, 255, 0, 0.8), rgba(0, 0, 0, 0.7))'
    leafStyle.style.maskImage = before
    leafStyle.properties['mask-image'] = before
    leafStyle.properties['-webkit-mask-image'] = before
    const first = compiler.compile(root, new Map(), frame, 'white', region)
    expect(first.issues).not.toContain(maskError)
    const previous = first.scene.items.find((item) => item.kind === 'backdrop')
    leafStyle.style.maskImage = after
    leafStyle.properties['mask-image'] = after
    leafStyle.properties['-webkit-mask-image'] = after
    const next = compiler.compile(root, new Map(), frame, 'white', region)
    expect(next.issues).not.toContain(maskError)
    const current = next.scene.items.find((item) => item.kind === 'backdrop')
    expect(maskSpy).toHaveBeenCalledTimes(2)
    expect(previous?.kind === 'backdrop' && previous.bitmap).not.toBe(
      current?.kind === 'backdrop' && current.bitmap
    )
    compiler.dispose()
  })
})
