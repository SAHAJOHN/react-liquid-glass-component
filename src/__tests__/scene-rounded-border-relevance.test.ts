import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import { samplingBoundaryChanged } from '../scene/sampling-boundary'
import * as box from '../scene/paint-box'
import type * as PaintBox from '../scene/paint-box'
import type { SceneFrame, SceneRect } from '../scene/types'

const roundedBorderIssue = 'Unequal rounded borders require native HTML rendering'
vi.mock('../scene/paint-box', async (original) => ({
  ...(await original<typeof PaintBox>()),
  createColorReader: () => (value: string) =>
    value === 'transparent' ? [0, 0, 0, 0] : [1, 1, 1, 1],
  paintBox: vi.fn(
    (style: CSSStyleDeclaration, _w: number, _h: number, _ratio: number, issues: Set<string>) => {
      if (style.borderBottomWidth === '1px')
        issues.add('Unequal rounded borders require native HTML rendering')
      if (style.backgroundColor === 'red') issues.add('Other box issue')
      return document.createElement('canvas')
    }
  ),
}))

const frame: SceneFrame = { width: 400, height: 800, pixelRatio: 2, scrollX: 0, scrollY: 0 }
const pane: SceneRect = { x: 50, y: 20, width: 100, height: 50 }

function fixture() {
  const root = document.createElement('main')
  const parent = document.createElement('section')
  const child = document.createElement('div')
  const layer = document.createElement('div')
  parent.append(child)
  root.append(parent, layer)
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
    const result = document.createElement('div').style
    for (const [name, value] of Object.entries(defaults))
      Object.defineProperty(result, name, { value, configurable: true, writable: true })
    return result
  }
  const rootStyle = makeStyle(),
    parentStyle = makeStyle(),
    childStyle = makeStyle(),
    layerStyle = makeStyle()
  parentStyle.borderBottomWidth = '1px'
  parentStyle.borderTopLeftRadius = '12px'
  childStyle.backgroundColor = 'blue'
  const styles = new Map<Element, CSSStyleDeclaration>([
    [root, rootStyle],
    [parent, parentStyle],
    [child, childStyle],
    [layer, layerStyle],
  ])
  const pseudo = makeStyle()
  Object.defineProperty(pseudo, 'content', { value: 'none' })
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, name) => {
    if (name) return pseudo
    const result = styles.get(element)
    if (!result) throw new Error('Unexpected element')
    return result
  })
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 2000))
  const bounds = vi
    .spyOn(parent, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(50, 300, 100, 50))
  vi.spyOn(child, 'getBoundingClientRect').mockReturnValue(new DOMRect(60, 30, 50, 20))
  vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  return {
    root,
    parent,
    child,
    parentStyle,
    layerStyle,
    bounds,
    compiler: createSceneCompiler(() => {}),
  }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('rounded border sampling relevance', () => {
  it('defers an outside border and restores its cached issue when it enters', () => {
    const { root, parent, child, bounds, compiler } = fixture()
    const outside = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(outside.issues).not.toContain(roundedBorderIssue)
    expect(outside.samplingWatches).toContainEqual({ element: parent, relation: 'outside' })
    expect(
      vi.mocked(box.paintBox).mock.calls.some(([style]) => style.backgroundColor === 'blue')
    ).toBe(true)
    expect(root.contains(child)).toBe(true)
    expect(samplingBoundaryChanged(root, outside.samplingWatches ?? [], pane)).toBe(false)
    bounds.mockReturnValue(new DOMRect(50, 30, 100, 50))
    expect(samplingBoundaryChanged(root, outside.samplingWatches ?? [], pane)).toBe(true)
    expect(compiler.compile(root, new Map(), frame, 'white', pane).issues).toContain(
      roundedBorderIssue
    )
    compiler.dispose()
  })

  it('keeps unsupported box issues other than the bounded border issue', () => {
    const { root, parentStyle, compiler } = fixture()
    parentStyle.backgroundColor = 'red'
    const result = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(result.issues).not.toContain(roundedBorderIssue)
    expect(result.issues).toContain('Other box issue')
    compiler.dispose()
  })

  it.each([undefined, { ...pane, width: NaN }])(
    'keeps the issue without valid sampling bounds',
    (region) => {
      const { root, compiler } = fixture()
      expect(compiler.compile(root, new Map(), frame, 'white', region).issues).toContain(
        roundedBorderIssue
      )
      compiler.dispose()
    }
  )

  it('keeps a border sampled by a backdrop blur outside the optical pane', () => {
    const { root, layerStyle, bounds, compiler } = fixture()
    bounds.mockReturnValue(new DOMRect(75, 0, 20, 5))
    layerStyle.backdropFilter = 'blur(10px)'
    expect(compiler.compile(root, new Map(), frame, 'white', pane).issues).toContain(
      roundedBorderIssue
    )
    compiler.dispose()
  })

  it('defers only when the border misses every sampling region', () => {
    const { root, bounds, compiler } = fixture()
    const second = { x: 50, y: 600, width: 100, height: 50 }
    const combined = { x: 50, y: 20, width: 100, height: 630 }
    expect(
      compiler.compile(root, new Map(), frame, 'white', combined, [pane, second]).issues
    ).not.toContain(roundedBorderIssue)
    bounds.mockReturnValue(new DOMRect(75, 610, 20, 10))
    expect(
      compiler.compile(root, new Map(), frame, 'white', combined, [pane, second]).issues
    ).toContain(roundedBorderIssue)
    compiler.dispose()
  })
})
