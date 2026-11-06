import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import type * as BoxModule from '../scene/paint-box'

vi.mock('../scene/paint-box', async (importOriginal) => ({
  ...(await importOriginal<typeof BoxModule>()),
  createColorReader: () => () => [0, 0, 0, 0],
}))

const frame = { width: 400, height: 800, pixelRatio: 2, scrollX: 0, scrollY: 0 }
const reason = 'CSS group opacity: Opacity group canvas requires a declared 2D context'

function fixture() {
  const root = document.createElement('main')
  const group = document.createElement('div')
  const canvas = document.createElement('canvas')
  canvas.width = 60
  canvas.height = 40
  root.appendChild(group)
  group.appendChild(canvas)
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
    objectFit: 'fill',
    objectPosition: '50% 50%',
  }
  function style(overrides: Record<string, string> = {}) {
    const result = document.createElement('div').style
    for (const [key, value] of Object.entries({ ...defaults, ...overrides }))
      Object.defineProperty(result, key, { value, writable: true, configurable: true })
    return result
  }
  const styles = new Map<Element, CSSStyleDeclaration>([
    [root, style()],
    [group, style({ opacity: '0.5' })],
    [canvas, style()],
  ])
  const pseudo = style({ content: 'none' })
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, name) => {
    if (name) return pseudo
    const result = styles.get(element)
    if (!result) throw new Error('Unexpected element')
    return result
  })
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 800))
  vi.spyOn(group, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 100, 80))
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(30, 30, 60, 40))
  const context = vi.spyOn(canvas, 'getContext')
  const compiler = createSceneCompiler(() => {})
  return { root, canvas, context, compiler }
}

afterEach(() => vi.restoreAllMocks())

describe('dynamic opacity group compiler', () => {
  it('keeps an unmarked canvas on the native rendering path without probing it', () => {
    const { root, canvas, context, compiler } = fixture()
    const result = compiler.compile(root, new Map(), frame, 'white')
    expect(result.issues).toContain(reason)
    expect(result.scene.items.some((item) => item.kind === 'opacity-group')).toBe(false)
    expect(context).not.toHaveBeenCalled()
    expect(canvas.hasAttribute('data-liquid-glass-canvas')).toBe(false)
    compiler.dispose()
  })

  it('emits an isolated GPU group with the original declared 2D canvas', () => {
    const { root, canvas, context, compiler } = fixture()
    canvas.setAttribute('data-liquid-glass-canvas', '2d')
    const result = compiler.compile(root, new Map(), frame, 'white')
    expect(result.issues).toEqual([])
    const item = result.scene.items.find((entry) => entry.kind === 'opacity-group')
    expect(item?.kind).toBe('opacity-group')
    if (item?.kind === 'opacity-group') {
      expect(item.opacity).toBe(0.5)
      expect(item.items).toMatchObject([{ kind: 'media', source: canvas, opacity: 1 }])
    }
    expect(result.media).toContain(canvas)
    expect(context).not.toHaveBeenCalled()
    compiler.dispose()
  })

  it('treats the marker as an owner assertion rather than probing the context', () => {
    const { root, canvas, context, compiler } = fixture()
    // The owner is responsible for using a 2D context. If a marker is spoofed,
    // probing could mutate the canvas and cannot verify its previous context.
    canvas.setAttribute('data-liquid-glass-canvas', '2d')
    context.mockReturnValue(null)
    const result = compiler.compile(root, new Map(), frame, 'white')
    expect(result.issues).toEqual([])
    expect(result.scene.items.some((item) => item.kind === 'opacity-group')).toBe(true)
    expect(context).not.toHaveBeenCalled()
    compiler.dispose()
  })
})
