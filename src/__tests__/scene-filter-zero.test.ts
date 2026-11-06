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
const stackingError = 'Escaping descendant stacking order requires native HTML rendering'

function fixture() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  const root = document.createElement('div')
  const filtered = document.createElement('div')
  const child = document.createElement('button')
  const sibling = document.createElement('div')
  root.append(filtered, sibling)
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
  const filteredStyle = style()
  const childStyle = style()
  const styles = new Map<Element, CSSStyleDeclaration>([
    [root, style()],
    [filtered, filteredStyle],
    [child, childStyle],
    [sibling, style()],
  ])
  const pseudoStyle = style()
  Object.defineProperty(pseudoStyle, 'content', { value: 'none' })
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 500))
  vi.spyOn(filtered, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 200, 100))
  vi.spyOn(child, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 100, 50))
  vi.spyOn(sibling, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 100, 50))
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (pseudo) return pseudoStyle
    const result = styles.get(element)
    if (!result) throw new Error('Unexpected element')
    return result
  })
  const compiler = createSceneCompiler(() => {})
  return { root, filtered, child, sibling, filteredStyle, childStyle, compiler }
}

afterEach(() => vi.restoreAllMocks())

describe('scene identity blur filter', () => {
  it('renders zero blur without changing sprite brightness', () => {
    const { root, filteredStyle, compiler } = fixture()
    filteredStyle.filter = 'blur(0px)'
    const result = compiler.compile(root, new Map(), frame, 'white')
    expect(result.issues).not.toContain(filterError)
    expect(
      result.scene.items
        .filter((item) => item.kind === 'sprite')
        .every((item) => (item.brightness ?? 1) === 1)
    ).toBe(true)
    compiler.dispose()
  })

  it('keeps the filter as a containing block for fixed descendants', () => {
    const { root, filteredStyle, childStyle, compiler } = fixture()
    filteredStyle.filter = 'blur(0px)'
    childStyle.position = 'fixed'
    const result = compiler.compile(root, new Map(), frame, 'white')
    expect(result.issues).not.toContain(filterError)
    expect(result.targets[0]).toMatchObject({ space: 'document', rect: { y: 130 } })
    compiler.dispose()
  })

  it('retains the stacking context of an identity filter', () => {
    const { root, filteredStyle, childStyle, compiler } = fixture()
    childStyle.position = 'relative'
    childStyle.zIndex = '10'
    const unfiltered = compiler.compile(root, new Map(), frame, 'white')
    expect(unfiltered.issues).toContain(stackingError)
    filteredStyle.filter = 'blur(0px)'
    const result = compiler.compile(root, new Map(), frame, 'white')
    expect(result.issues).not.toContain(stackingError)
    expect(result.issues).not.toContain(filterError)
    compiler.dispose()
  })

  it('does not apply a group filter to a managed glass descendant', () => {
    const { root, filteredStyle, child, compiler } = fixture()
    filteredStyle.filter = 'blur(0px)'
    const glass: GlassOptions = {
      radius: 0,
      displacement: [0, 0, 0],
      blur: 0,
      saturation: 1,
      color: '#fff',
      opacity: 1,
    }
    expect(compiler.compile(root, new Map([[child, glass]]), frame, 'white').issues).not.toContain(
      filterError
    )
    compiler.dispose()
  })

  it('does not treat identity blur as a brightness filter on an opacity group', () => {
    const { root, filteredStyle, compiler } = fixture()
    filteredStyle.filter = 'blur(0px)'
    filteredStyle.opacity = '0.5'
    expect(compiler.compile(root, new Map(), frame, 'white').issues).not.toContain(filterError)
    compiler.dispose()
  })

  it.each(['blur(0.01px)', 'blur(2px)', 'blur(0px) brightness(1)', 'blur(-1px)'])(
    'retains fallback for an unsupported filter %s',
    (filter) => {
      const { root, filteredStyle, compiler } = fixture()
      filteredStyle.filter = filter
      expect(compiler.compile(root, new Map(), frame, 'white').issues).toContain(filterError)
      compiler.dispose()
    }
  )
})
