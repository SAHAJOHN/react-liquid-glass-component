import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import type * as PaintBoxModule from '../scene/paint-box'
import type { GlassOptions } from '../scene/types'

vi.mock('../scene/paint-box', async (importOriginal) => ({
  ...(await importOriginal<typeof PaintBoxModule>()),
  createColorReader: () => () => [1, 1, 1, 1],
  paintBox: () => document.createElement('canvas'),
}))

const frame = { scrollX: 0, scrollY: 100, width: 400, height: 800, pixelRatio: 1 }
const filterError = 'CSS filters outside LiquidGlass require native HTML rendering'

function fixture() {
  const root = document.createElement('div')
  const filtered = document.createElement('div')
  const child = document.createElement('button')
  root.append(filtered)
  filtered.append(child)
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
    backgroundColor: 'white',
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
    const result = document.createElement('div').style
    for (const [key, value] of Object.entries(defaults))
      Object.defineProperty(result, key, { value, configurable: true, writable: true })
    return result
  }
  const rootStyle = style()
  const filteredStyle = style()
  const childStyle = style()
  const pseudoStyle = style()
  Object.defineProperty(pseudoStyle, 'content', { value: 'none' })
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 500))
  vi.spyOn(filtered, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 200, 100))
  vi.spyOn(child, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 100, 50))
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (pseudo) return pseudoStyle
    return element === root ? rootStyle : element === filtered ? filteredStyle : childStyle
  })
  const compiler = createSceneCompiler(() => {})
  return { root, filtered, child, rootStyle, filteredStyle, childStyle, compiler }
}

afterEach(() => vi.restoreAllMocks())

describe('scene brightness filters', () => {
  it('propagates darkening to group descendants but not sibling/background', () => {
    const { root, filteredStyle, childStyle, compiler } = fixture()
    filteredStyle.filter = 'brightness(0.97)'
    childStyle.filter = 'brightness(50%)'
    const result = compiler.compile(root, new Map(), frame, 'white')
    expect(result.issues).not.toContain(filterError)
    const sprites = result.scene.items.filter((item) => item.kind === 'sprite')
    expect(sprites).toHaveLength(3)
    expect(sprites[0]?.brightness ?? 1).toBe(1)
    expect(sprites[1]?.brightness).toBeCloseTo(0.97)
    expect(sprites[2]?.brightness).toBeCloseTo(0.485)
    compiler.dispose()
  })

  it.each(['brightness(1.1)', 'blur(2px)', 'brightness(0.8) contrast(1)', 'brightness(-1)'])(
    'retains fallback for unsupported filter %s',
    (filter) => {
      const { root, filteredStyle, compiler } = fixture()
      filteredStyle.filter = filter
      expect(compiler.compile(root, new Map(), frame, 'white').issues).toContain(filterError)
      compiler.dispose()
    }
  )

  it('does not paint a managed glass descendant with an incorrectly applied group filter', () => {
    const { root, filteredStyle, child, compiler } = fixture()
    filteredStyle.filter = 'brightness(0.97)'
    const glass: GlassOptions = {
      radius: 0,
      displacement: [0, 0, 0],
      blur: 0,
      saturation: 1,
      color: '#fff',
      opacity: 1,
    }
    const result = compiler.compile(root, new Map([[child, glass]]), frame, 'white')
    expect(result.issues).toContain(filterError)
    compiler.dispose()
  })

  it('preserves fallback when opacity-group compositing cannot be reproduced', () => {
    const { root, filteredStyle, compiler } = fixture()
    filteredStyle.filter = 'brightness(0.97)'
    filteredStyle.opacity = '0.5'
    expect(compiler.compile(root, new Map(), frame, 'white').issues).toContain(filterError)
    compiler.dispose()
  })

  it('uses the filtered containing block for fixed descendants', () => {
    const { root, filteredStyle, childStyle, compiler } = fixture()
    filteredStyle.filter = 'brightness(0.97)'
    childStyle.position = 'fixed'
    const result = compiler.compile(root, new Map(), frame, 'white')
    expect(result.issues).not.toContain(filterError)
    expect(result.targets[0]).toMatchObject({ space: 'document', rect: { y: 130 } })
    compiler.dispose()
  })

  it('darkens a filtered button focus indication without darkening the rest of the scene', () => {
    const { root, filteredStyle, child, compiler } = fixture()
    filteredStyle.filter = 'brightness(0.75)'
    const matches = child.matches.bind(child)
    vi.spyOn(child, 'matches').mockImplementation((selector) =>
      selector === ':focus-visible' ? true : matches(selector)
    )
    const result = compiler.compile(root, new Map(), frame, 'white')
    const outlines = result.scene.items.filter((item) => item.kind === 'solid')
    expect(outlines).toHaveLength(4)
    expect(outlines.every((item) => item.brightness === 0.75)).toBe(true)
    compiler.dispose()
  })
})
