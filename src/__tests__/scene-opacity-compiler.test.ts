import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import type * as BoxModule from '../scene/paint-box'
import { paintBoxShadows } from '../scene/paint-shadow'
import * as paintContent from '../scene/paint-content'
import { GLASS_STUDIO_DEFAULTS } from '../studio-props'
import type { GlassOptions } from '../scene/types'

vi.mock('../scene/paint-shadow', () => ({ paintBoxShadows: vi.fn() }))
vi.mock('../scene/paint-box', async (importOriginal) => ({
  ...(await importOriginal<typeof BoxModule>()),
  createColorReader: () => (value: string) =>
    value === 'transparent' ? [0, 0, 0, 0] : [1, 1, 1, 1],
  paintBox: () => document.createElement('canvas'),
}))

const frame = { width: 400, height: 800, pixelRatio: 2, scrollX: 0, scrollY: 0 }
const groupError = 'CSS group opacity requires native HTML rendering'

function fixture() {
  const root = document.createElement('main')
  const button = document.createElement('button')
  const label = document.createElement('span')
  label.appendChild(document.createTextNode('Hello'))
  button.appendChild(label)
  root.appendChild(button)
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
    color: 'black',
  }
  function style(overrides: Record<string, string> = {}) {
    const result = document.createElement('div').style
    for (const [key, value] of Object.entries({ ...defaults, ...overrides }))
      Object.defineProperty(result, key, { value, writable: true, configurable: true })
    return result
  }
  const rootStyle = style()
  const buttonStyle = style({ opacity: '0.5', boxShadow: 'rgb(0, 0, 0) 0px 3px 8px' })
  const labelStyle = style()
  const pseudoStyle = style({ content: 'none' })
  const styles = new Map<Element, CSSStyleDeclaration>([
    [root, rootStyle],
    [button, buttonStyle],
    [label, labelStyle],
  ])
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (pseudo) return pseudoStyle
    const value = styles.get(element)
    if (!value) throw new Error('Unexpected element')
    return value
  })
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 800))
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(30, 40, 100, 50))
  vi.spyOn(label, 'getBoundingClientRect').mockReturnValue(new DOMRect(45, 55, 40, 20))
  vi.spyOn(document, 'createRange').mockReturnValue({
    selectNodeContents: vi.fn(),
    getBoundingClientRect: () => new DOMRect(45, 55, 40, 20),
  } as unknown as Range)
  vi.spyOn(paintContent, 'paintText').mockReturnValue(document.createElement('canvas'))
  const shadow = document.createElement('canvas')
  vi.mocked(paintBoxShadows).mockReturnValue({
    status: 'ready',
    outer: {
      bitmap: shadow,
      offsetX: -10,
      offsetY: -10,
      width: 120,
      height: 70,
    },
  })
  const drawing = { drawImage: vi.fn(), fillRect: vi.fn(), setTransform: vi.fn() }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    drawing as unknown as CanvasRenderingContext2D
  )
  const compiler = createSceneCompiler(() => {})
  return { root, button, label, rootStyle, buttonStyle, labelStyle, styles, drawing, compiler }
}

afterEach(() => vi.restoreAllMocks())

describe('opacity group compiler integration', () => {
  it('keeps a fading Studio glass and its native controls in one GPU opacity group', () => {
    const { root, button, buttonStyle, labelStyle, styles, compiler } = fixture()
    buttonStyle.boxShadow = 'none'
    buttonStyle.backgroundColor = 'transparent'
    const pane = document.createElement('div')
    button.prepend(pane)
    styles.set(pane, labelStyle)
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(30, 40, 100, 50))
    const options: GlassOptions = {
      radius: 20,
      displacement: [0, 0, 0],
      blur: 0,
      saturation: 1,
      color: '#fff',
      opacity: 1,
      studio: { ...GLASS_STUDIO_DEFAULTS, shapeRoundness: 2, shadowFactor: 0 },
    }
    const result = compiler.compile(root, new Map([[pane, options]]), frame, 'white')
    expect(result.issues).not.toContain(groupError)
    const group = result.scene.items.find((item) => item.kind === 'opacity-group')
    expect(group?.kind).toBe('opacity-group')
    if (group?.kind === 'opacity-group') {
      expect(group.opacity).toBe(0.5)
      expect(group.items[0]).toMatchObject({ kind: 'glass', opacity: 1 })
    }
    expect(result.targets.some((target) => target.element === button)).toBe(true)
    compiler.dispose()
  })

  it('composes box, outer shadow, child background and text into one translucent sprite', () => {
    const { root, button, drawing, compiler } = fixture()
    const result = compiler.compile(root, new Map(), frame, 'white')
    expect(result.issues).not.toContain(groupError)
    expect(result.issues).not.toContain(
      'CSS box shadows with opacity require native HTML rendering'
    )
    const sprites = result.scene.items.filter((item) => item.kind === 'sprite')
    expect(sprites).toHaveLength(2)
    expect(sprites[1]).toMatchObject({ opacity: 0.5, space: 'document' })
    expect(result.targets.some((target) => target.element === button)).toBe(true)
    expect(drawing.drawImage).toHaveBeenCalledTimes(4)
    compiler.dispose()
  })

  it('reuses the raster when only parent opacity changes', () => {
    const { root, buttonStyle, drawing, compiler } = fixture()
    const first = compiler.compile(root, new Map(), frame, 'white')
    buttonStyle.opacity = '0.25'
    const second = compiler.compile(root, new Map(), frame, 'white')
    const a = first.scene.items.find((item) => item.kind === 'sprite' && item.opacity === 0.5)
    const b = second.scene.items.find((item) => item.kind === 'sprite' && item.opacity === 0.25)
    expect(a?.kind).toBe('sprite')
    expect(b?.kind).toBe('sprite')
    if (a?.kind === 'sprite' && b?.kind === 'sprite') expect(a.bitmap).toBe(b.bitmap)
    expect(drawing.drawImage).toHaveBeenCalledTimes(4)
    compiler.dispose()
  })

  it('keeps nested opacity fallback instead of flattening it incorrectly', () => {
    const { root, labelStyle, compiler } = fixture()
    labelStyle.opacity = '0.5'
    expect(compiler.compile(root, new Map(), frame, 'white').issues).toContain(groupError)
    compiler.dispose()
  })

  it('keeps focus-visible fallback because the focus indicator is emitted outside the group', () => {
    const { root, button, compiler } = fixture()
    const matches = button.matches.bind(button)
    vi.spyOn(button, 'matches').mockImplementation(
      (selector) => selector === ':focus-visible' || matches(selector)
    )
    expect(compiler.compile(root, new Map(), frame, 'white').issues).toContain(groupError)
    compiler.dispose()
  })

  it('keeps fallback when a nested backdrop effect belongs to another backdrop root', () => {
    const { root, labelStyle, compiler } = fixture()
    labelStyle.backdropFilter = 'blur(10px)'
    expect(compiler.compile(root, new Map(), frame, 'white').issues).toContain(
      'CSS filters outside LiquidGlass require native HTML rendering'
    )
    compiler.dispose()
  })

  it('keeps fallback for live canvas media inside the group', () => {
    const { root, button, styles, labelStyle, compiler } = fixture()
    const canvas = document.createElement('canvas')
    canvas.width = 30
    canvas.height = 20
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(50, 50, 30, 20))
    styles.set(canvas, labelStyle)
    button.appendChild(canvas)
    expect(compiler.compile(root, new Map(), frame, 'white').issues).toContain(groupError)
    compiler.dispose()
  })

  it('retains a shared ancestor clip on the composited opacity group', () => {
    const { root, rootStyle, compiler } = fixture()
    rootStyle.overflowX = 'hidden'
    rootStyle.overflowY = 'hidden'
    vi.mocked(root.getBoundingClientRect).mockReturnValue(new DOMRect(30, 40, 100, 50))
    const result = compiler.compile(root, new Map(), frame, 'white')
    expect(result.issues).not.toContain(groupError)
    expect(result.scene.items.some((item) => (item.clips?.length ?? 0) > 0)).toBe(true)
    compiler.dispose()
  })
})
