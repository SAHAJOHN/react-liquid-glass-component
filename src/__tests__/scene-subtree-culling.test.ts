import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import * as paintBox from '../scene/paint-box'
import type * as PaintBox from '../scene/paint-box'

vi.mock('../scene/paint-box', async (original) => ({
  ...(await original<typeof PaintBox>()),
  createColorReader: () => (value: string) =>
    value === 'transparent' ? [0, 0, 0, 0] : [1, 0, 0, 1],
  paintBox: vi.fn(() => document.createElement('canvas')),
}))
vi.mock('../scene/paint-shadow', () => ({
  paintBoxShadows: () => ({ status: 'none' }),
}))
vi.mock('../scene/paint-pseudo', () => ({
  measurePseudoBox: () => ({ status: 'none' }),
  paintPseudoBox: vi.fn(),
}))

const frame = { width: 400, height: 800, pixelRatio: 1, scrollX: 0, scrollY: 0 }
const region = { x: 50, y: 20, width: 100, height: 50 }
const filterError = 'CSS filters outside LiquidGlass require native HTML rendering'

function fixture() {
  const root = document.createElement('main')
  const clipped = document.createElement('section')
  const child = document.createElement('div')
  root.append(clipped)
  clipped.append(child)
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
    for (const [name, value] of Object.entries(defaults))
      Object.defineProperty(style, name, { value, writable: true, configurable: true })
    vi.spyOn(style, 'getPropertyValue').mockImplementation(() => '')
    return style
  }
  const rootStyle = makeStyle()
  const clippedStyle = makeStyle()
  clippedStyle.position = 'relative'
  clippedStyle.overflowX = clippedStyle.overflowY = 'hidden'
  const childStyle = makeStyle()
  childStyle.filter = 'blur(2px)'
  childStyle.backgroundColor = 'red'
  const styles = new Map<Element, CSSStyleDeclaration>([
    [root, rootStyle],
    [clipped, clippedStyle],
    [child, childStyle],
  ])
  const pseudo = makeStyle()
  Object.defineProperty(pseudo, 'content', { value: 'none', configurable: true })
  const childPseudo = makeStyle()
  Object.defineProperty(childPseudo, 'content', { value: 'none', configurable: true })
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, name) => {
    if (name) return element === child && name === '::before' ? childPseudo : pseudo
    const style = styles.get(element)
    if (!style) throw new Error('Missing fixture style')
    return style
  })
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 8000))
  const bounds = vi.spyOn(clipped, 'getBoundingClientRect')
  const childBounds = vi.spyOn(child, 'getBoundingClientRect')
  const move = (y: number) => {
    bounds.mockReturnValue(new DOMRect(0, y, 300, 200))
    childBounds.mockReturnValue(new DOMRect(10, y + 10, 100, 100))
  }
  move(3000)
  const compiler = createSceneCompiler(() => {})
  const compile = () => compiler.compile(root, new Map(), frame, 'white', region)
  const paintedChild = () =>
    vi.mocked(paintBox.paintBox).mock.calls.some(([style]) => style === childStyle)
  return {
    root,
    clipped,
    child,
    rootStyle,
    clippedStyle,
    childStyle,
    childPseudo,
    styles,
    bounds,
    childBounds,
    makeStyle,
    move,
    compiler,
    compile,
    paintedChild,
  }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('distant bounded subtree paint culling', () => {
  it('omits distant clipped paint and diagnostics, then remeasures when it enters the source', () => {
    const { compile, move, compiler, paintedChild } = fixture()
    const distant = compile()
    expect(distant.issues).toEqual([])
    expect(distant.scene.items).toEqual([])
    expect(distant.liveGeometry).toBe(true)
    expect(paintedChild()).toBe(false)

    move(30)
    const visible = compile()
    expect(visible.issues).toContain(filterError)
    expect(paintedChild()).toBe(true)
    compiler.dispose()
  })

  it('keeps nearby subtrees traversable for asset warmup without unrelated diagnostics', () => {
    const { compile, move, compiler, paintedChild } = fixture()
    move(1250)
    expect(compile().issues).not.toContain(filterError)
    expect(paintedChild()).toBe(true)
    compiler.dispose()
  })

  it('checks every independent source region', () => {
    const { root, compiler, paintedChild } = fixture()
    const second = { x: 0, y: 3000, width: 300, height: 100 }
    const result = compiler.compile(root, new Map(), frame, 'white', region, [region, second])
    expect(result.issues).toContain(filterError)
    expect(paintedChild()).toBe(true)
    compiler.dispose()
  })

  it('does not cull without valid source regions', () => {
    const { root, compiler, paintedChild } = fixture()
    expect(compiler.compile(root, new Map(), frame, 'white').issues).toContain(filterError)
    expect(paintedChild()).toBe(true)
    compiler.dispose()
  })

  it('retains a fixed descendant that can escape the clipping ancestor', () => {
    const { childStyle, childBounds, compile, compiler, paintedChild } = fixture()
    childStyle.position = 'fixed'
    childBounds.mockReturnValue(new DOMRect(60, 30, 50, 50))
    expect(compile().issues).toContain(filterError)
    expect(paintedChild()).toBe(true)
    compiler.dispose()
  })

  it('retains a descendant with fixed generated content', () => {
    const { childPseudo, compile, compiler, paintedChild } = fixture()
    Object.defineProperty(childPseudo, 'content', { value: '""' })
    childPseudo.position = 'fixed'
    expect(compile().issues).toContain(filterError)
    expect(paintedChild()).toBe(true)
    compiler.dispose()
  })

  it.each(['shadow', 'invalid bounds', 'visible overflow'] as const)(
    'independently proves child paint bounds despite ancestor %s',
    (reason) => {
      const { clippedStyle, bounds, compile, compiler, paintedChild } = fixture()
      if (reason === 'shadow') clippedStyle.boxShadow = '0 0 100px red'
      if (reason === 'invalid bounds') bounds.mockReturnValue(new DOMRect(NaN, 3000, 300, 200))
      if (reason === 'visible overflow') clippedStyle.overflowY = 'visible'
      expect(compile().issues).not.toContain(filterError)
      expect(paintedChild()).toBe(false)
      compiler.dispose()
    }
  )

  it('fails closed for an unknown ancestor filter', () => {
    const { clippedStyle, compile, compiler, paintedChild } = fixture()
    clippedStyle.filter = 'url("private.svg#filter")'
    expect(compile().issues).toContain(filterError)
    expect(paintedChild()).toBe(true)
    compiler.dispose()
  })

  it('fails closed for scaled ancestors and invalid child bounds', () => {
    const scaled = fixture()
    vi.stubGlobal(
      'DOMMatrixReadOnly',
      class {
        is2D = true
        a = 2
        b = 0
        c = 0
        d = 2
      }
    )
    scaled.clippedStyle.transform = 'matrix(2, 0, 0, 2, 0, 0)'
    expect(scaled.compile().issues).toContain(filterError)
    expect(scaled.paintedChild()).toBe(true)
    scaled.compiler.dispose()
    vi.unstubAllGlobals()

    const invalid = fixture()
    invalid.clippedStyle.overflowY = 'visible'
    invalid.childBounds.mockReturnValue(new DOMRect(NaN, 3010, 100, 100))
    expect(invalid.compile().issues).toContain(filterError)
    expect(invalid.paintedChild()).toBe(true)
    invalid.compiler.dispose()
  })

  it('extends the warm boundary through backdrop blur before culling', () => {
    const { root, styles, makeStyle, move, compile, compiler, paintedChild } = fixture()
    move(1300)
    expect(compile().issues).toEqual([])
    expect(paintedChild()).toBe(false)

    const backdrop = document.createElement('div')
    root.prepend(backdrop)
    const style = makeStyle()
    style.backdropFilter = 'blur(20px)'
    styles.set(backdrop, style)
    vi.spyOn(backdrop, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 1400))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    expect(compile().issues).not.toContain(filterError)
    expect(paintedChild()).toBe(true)
    compiler.dispose()
  })
})
