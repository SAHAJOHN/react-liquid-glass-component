import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import * as imageFilter from '../scene/image-filter'
import type * as PaintBox from '../scene/paint-box'
import * as paintContent from '../scene/paint-content'

vi.mock('../scene/paint-box', async (original) => ({
  ...(await original<typeof PaintBox>()),
  createColorReader: () => (value: string) =>
    value === 'transparent' ? [0, 0, 0, 0] : [1, 1, 1, 1],
  paintBox: () => document.createElement('canvas'),
}))

const frame = { width: 400, height: 800, pixelRatio: 1, scrollX: 0, scrollY: 0 }
const filterError = 'CSS filters outside LiquidGlass require native HTML rendering'

function fixture() {
  const root = document.createElement('main')
  const image = document.createElement('img')
  image.src = 'data:image/png;base64,AA=='
  root.append(image)
  document.body.append(root)
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 20 },
    naturalHeight: { configurable: true, value: 12 },
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
  const imageStyle = style({ filter: 'brightness(0) invert(1)' })
  const pseudoStyle = style({ content: 'none' })
  const styles = new Map<Element, CSSStyleDeclaration>([
    [root, rootStyle],
    [image, imageStyle],
  ])
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (pseudo) return pseudoStyle
    const result = styles.get(element)
    if (!result) throw new Error('Missing fixture style')
    return result
  })
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 800))
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 100, 50))

  const source = document.createElement('canvas')
  source.width = 100
  source.height = 50
  const paint = vi.spyOn(paintContent, 'paintImage').mockReturnValue(source)
  const compiler = createSceneCompiler(() => {})
  return { root, imageStyle, source, paint, compiler }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('image color filter compiler integration', () => {
  it('caches the filtered raster separately from the plain image', () => {
    const { root, imageStyle, source, paint, compiler } = fixture()
    const filtered = document.createElement('canvas')
    filtered.width = source.width
    filtered.height = source.height
    const apply = vi.spyOn(imageFilter, 'paintImageFilter').mockReturnValue(filtered)

    const first = compiler.compile(root, new Map(), frame, 'white')
    expect(first.issues).not.toContain(filterError)
    expect(first.scene.items).toContainEqual(expect.objectContaining({ bitmap: filtered }))
    expect(apply).toHaveBeenCalledOnce()

    imageStyle.filter = 'none'
    const plain = compiler.compile(root, new Map(), frame, 'white')
    expect(plain.scene.items).toContainEqual(expect.objectContaining({ bitmap: source }))
    expect(paint).toHaveBeenCalledTimes(2)
    compiler.dispose()
  })

  it('retains fallback when filtering fails or the image has its own box paint', () => {
    const { root, imageStyle, compiler } = fixture()
    vi.spyOn(imageFilter, 'paintImageFilter').mockReturnValue(null)
    expect(compiler.compile(root, new Map(), frame, 'white').issues).toContain(filterError)

    imageStyle.objectPosition = '40% 50%'
    imageStyle.backgroundColor = 'red'
    expect(compiler.compile(root, new Map(), frame, 'white').issues).toContain(filterError)
    compiler.dispose()
  })

  it('retains fallback for a different filter chain', () => {
    const { root, imageStyle, compiler } = fixture()
    imageStyle.filter = 'brightness(0) invert(1) blur(1px)'
    expect(compiler.compile(root, new Map(), frame, 'white').issues).toContain(filterError)
    compiler.dispose()
  })
})
