import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import type * as PaintBoxModule from '../scene/paint-box'

vi.mock('../scene/paint-box', async (importOriginal) => ({
  ...(await importOriginal<typeof PaintBoxModule>()),
  createColorReader: () => () => [1, 1, 1, 1],
  paintBox: () => document.createElement('canvas'),
}))

const frame = { scrollX: 0, scrollY: 100, width: 400, height: 800, pixelRatio: 1 }
const filterError = 'CSS filters outside LiquidGlass require native HTML rendering'
const stackingError = 'Escaping descendant stacking order requires native HTML rendering'

function fixture() {
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

describe('scene individual translate', () => {
  it.each(['0px', '-50%', '20px -10%'])(
    'keeps %s as a containing block for fixed descendants',
    (translate) => {
      const { root, filteredStyle, childStyle, compiler } = fixture()
      Object.defineProperty(filteredStyle, 'translate', { configurable: true, value: translate })
      childStyle.position = 'fixed'
      const result = compiler.compile(root, new Map(), frame, 'white')
      expect(result.issues).not.toContain(filterError)
      expect(result.issues).not.toContain(
        'Individual CSS transform properties require native HTML rendering; use transform instead'
      )
      expect(result.targets[0]).toMatchObject({ space: 'document', rect: { y: 130 } })
      compiler.dispose()
    }
  )

  it('treats even zero translate as a stacking context for positioned descendants', () => {
    const { root, filteredStyle, childStyle, compiler } = fixture()
    childStyle.position = 'relative'
    childStyle.zIndex = '10'
    expect(compiler.compile(root, new Map(), frame, 'white').issues).toContain(stackingError)
    Object.defineProperty(filteredStyle, 'translate', { configurable: true, value: '0px' })
    expect(compiler.compile(root, new Map(), frame, 'white').issues).not.toContain(stackingError)
    compiler.dispose()
  })

  it.each(['1px 2px 0px', 'calc(50% + 1px)', '12em'])(
    'preserves fallback for unsupported translate %s',
    (translate) => {
      const { root, filteredStyle, compiler } = fixture()
      Object.defineProperty(filteredStyle, 'translate', { configurable: true, value: translate })
      expect(compiler.compile(root, new Map(), frame, 'white').issues).toContain(
        'Individual CSS transform properties require native HTML rendering; use transform instead'
      )
      compiler.dispose()
    }
  )
})
