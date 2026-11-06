import { afterEach, describe, it, expect, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { LiquidGlass } from '../LiquidGlass'
import * as capture from '../backdrop-capture'
import * as renderer from '../webgl-refraction'
import { LiquidGlassSceneContext } from '../scene/context'

describe('LiquidGlass', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  it('renders children', () => {
    render(<LiquidGlass>hello</LiquidGlass>)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('applies default liquid-glass class', () => {
    const { container } = render(<LiquidGlass>x</LiquidGlass>)
    const root = container.firstChild as HTMLElement
    expect(root).toHaveClass('liquid-glass')
  })

  it('uses the SVG filter when the URL syntax is supported outside WebKit', () => {
    vi.stubGlobal('CSS', { supports: () => false })
    const { container } = render(<LiquidGlass>x</LiquidGlass>)
    const root = container.firstChild as HTMLElement
    expect(root).toHaveClass('liquid-glass--svg')
  })

  it('uses the CSS glass treatment in WebKit even when the URL syntax parses', () => {
    vi.stubGlobal('CSS', { supports: (property: string) => property === '-webkit-touch-callout' })
    vi.spyOn(renderer, 'createWebGLRefraction').mockReturnValue(null)
    const { container } = render(<LiquidGlass>x</LiquidGlass>)
    const root = container.firstChild as HTMLElement
    expect(root).toHaveClass('liquid-glass--fallback')
  })

  it('shows the refracted capture only after the WebGL renderer succeeds and cleans up', () => {
    vi.stubGlobal('CSS', { supports: (property: string) => property === '-webkit-touch-callout' })
    const draw = vi.fn().mockReturnValue(true)
    const dispose = vi.fn()
    const unsubscribe = vi.fn()
    vi.spyOn(renderer, 'createWebGLRefraction').mockReturnValue({ render: draw, dispose })
    let deliver: ((image: HTMLCanvasElement | null) => void) | undefined
    vi.spyOn(capture, 'subscribeBackdrop').mockImplementation((listener) => {
      deliver = listener
      return unsubscribe
    })
    const { container, unmount } = render(<LiquidGlass>Content</LiquidGlass>)
    const root = container.firstChild as HTMLElement
    expect(root).not.toHaveClass('liquid-glass--webgl')
    act(() => deliver?.(document.createElement('canvas')))
    expect(draw).toHaveBeenCalledOnce()
    expect(root).toHaveClass('liquid-glass--webgl')
    expect(screen.getByText('Content')).toBeInTheDocument()
    act(() => deliver?.(null))
    expect(root).not.toHaveClass('liquid-glass--webgl')
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('redraws changed optics without recreating the renderer or capture subscription', () => {
    vi.stubGlobal('CSS', { supports: (property: string) => property === '-webkit-touch-callout' })
    const draw = vi.fn().mockReturnValue(true)
    const dispose = vi.fn()
    const unsubscribe = vi.fn()
    const create = vi
      .spyOn(renderer, 'createWebGLRefraction')
      .mockReturnValue({ render: draw, dispose })
    let deliver: ((image: HTMLCanvasElement | null, generation?: number) => void) | undefined
    const subscribe = vi.spyOn(capture, 'subscribeBackdrop').mockImplementation((listener) => {
      deliver = listener
      return unsubscribe
    })
    const { rerender, unmount } = render(<LiquidGlass distortionScale={-180}>Content</LiquidGlass>)
    const source = document.createElement('canvas')
    act(() => deliver?.(source, 12))
    expect(draw).toHaveBeenCalledWith(
      source,
      expect.objectContaining({ distortionScale: -180, frameId: 12 })
    )

    rerender(
      <LiquidGlass distortionScale={-260} redOffset={8}>
        Content
      </LiquidGlass>
    )
    expect(draw).toHaveBeenLastCalledWith(
      source,
      expect.objectContaining({ distortionScale: -260, redOffset: 8, frameId: 12 })
    )
    expect(create).toHaveBeenCalledOnce()
    expect(subscribe).toHaveBeenCalledOnce()
    expect(dispose).not.toHaveBeenCalled()
    expect(unsubscribe).not.toHaveBeenCalled()

    act(() => deliver?.(null))
    draw.mockClear()
    rerender(<LiquidGlass distortionScale={-200}>Content</LiquidGlass>)
    expect(draw).not.toHaveBeenCalled()
    unmount()
    expect(dispose).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('redraws at the new viewport position when the page scrolls without a new source frame', () => {
    vi.stubGlobal('CSS', { supports: (property: string) => property === '-webkit-touch-callout' })
    let scheduled: FrameRequestCallback | undefined
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      scheduled = callback
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const draw = vi.fn().mockReturnValue(true)
    vi.spyOn(renderer, 'createWebGLRefraction').mockReturnValue({ render: draw, dispose: vi.fn() })
    let deliver: ((image: HTMLCanvasElement | null, generation?: number) => void) | undefined
    vi.spyOn(capture, 'subscribeBackdrop').mockImplementation((listener) => {
      deliver = listener
      return vi.fn()
    })
    const { container, unmount } = render(<LiquidGlass>Content</LiquidGlass>)
    const root = container.firstChild as HTMLElement
    const rect = vi
      .spyOn(root, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(10, 80, 200, 100))
    const source = document.createElement('canvas')
    act(() => deliver?.(source, 1))
    rect.mockReturnValue(new DOMRect(10, 20, 200, 100))
    act(() => window.dispatchEvent(new Event('scroll')))
    expect(scheduled).toBeDefined()
    act(() => scheduled?.(100))
    expect(draw).toHaveBeenLastCalledWith(source, expect.objectContaining({ top: 20, frameId: 1 }))
    unmount()
  })

  it('forwards ref to root div element', () => {
    const ref = createRef<HTMLDivElement>()
    render(<LiquidGlass ref={ref}>x</LiquidGlass>)
    expect(ref.current).toBeInstanceOf(HTMLDivElement)
  })

  it('merges custom className with default classes', () => {
    const { container } = render(<LiquidGlass className="my-custom-class">x</LiquidGlass>)
    const root = container.firstChild as HTMLElement
    expect(root).toHaveClass('my-custom-class')
    expect(root).toHaveClass('liquid-glass')
  })

  it('applies borderRadius as CSS pixels', () => {
    const { container } = render(<LiquidGlass borderRadius={50}>x</LiquidGlass>)
    const root = container.firstChild as HTMLElement
    expect(root.style.borderRadius).toBe('50px')
  })

  it('uses equal channel displacement by default to avoid colored edge bands', () => {
    const { container } = render(<LiquidGlass />)
    const scales = Array.from(container.querySelectorAll('feDisplacementMap'), (channel) =>
      channel.getAttribute('scale')
    )
    expect(scales).toEqual(['-180', '-180', '-180'])
  })

  it('renders without children (empty content)', () => {
    const { container } = render(<LiquidGlass />)
    const contentEl = container.querySelector('.liquid-glass__content')
    expect(contentEl).toBeInTheDocument()
  })

  it('preserves string width/height without appending px', () => {
    const { container } = render(
      <LiquidGlass width="100%" height="50vh">
        x
      </LiquidGlass>
    )
    const root = container.firstChild as HTMLElement
    expect(root.style.width).toBe('100%')
    expect(root.style.height).toBe('50vh')
  })

  it('sets glassColor and backgroundOpacity as CSS custom properties', () => {
    const { container } = render(
      <LiquidGlass glassColor="#ff6b6b" backgroundOpacity={0.5}>
        x
      </LiquidGlass>
    )
    const root = container.firstChild as HTMLElement
    expect(root.style.getPropertyValue('--glass-color')).toBe('#ff6b6b')
    expect(root.style.getPropertyValue('--glass-frost')).toBe('0.5')
  })

  it('uses the Studio material for a managed native fallback', () => {
    const controller = { register: vi.fn(() => vi.fn()), update: vi.fn() }
    const { container } = render(
      <LiquidGlassSceneContext.Provider value={controller}>
        <LiquidGlass shapeRadius={100} blurRadius={3} tint={{ r: 22, g: 35, b: 43, a: 0.75 }} />
      </LiquidGlassSceneContext.Provider>
    )
    const root = container.firstChild as HTMLElement
    expect(root).toHaveClass('liquid-glass--managed', 'liquid-glass--fallback')
    expect(root.style.getPropertyValue('--glass-managed-background')).toBe('rgba(22, 35, 43, 0.6)')
    expect(root.style.getPropertyValue('--glass-managed-simple-background')).toBe(
      'rgba(22, 35, 43, 0.6)'
    )
    expect(root.style.getPropertyValue('--glass-managed-blur')).toBe('3px')
    expect(root.style.borderRadius).toBe('var(--glass-managed-radius, var(--glass-base-radius))')
  })

  it('keeps legacy color and radius precedence for managed panes', () => {
    const controller = { register: vi.fn(() => vi.fn()), update: vi.fn() }
    const { container } = render(
      <LiquidGlassSceneContext.Provider value={controller}>
        <LiquidGlass glassColor="#ff6b6b" backgroundOpacity={0.5} borderRadius={12} />
      </LiquidGlassSceneContext.Provider>
    )
    const root = container.firstChild as HTMLElement
    expect(root.style.getPropertyValue('--glass-managed-background')).toBe(
      'color-mix(in oklch, var(--glass-color) calc(var(--glass-frost) * 100%), transparent)'
    )
    expect(root.style.getPropertyValue('--glass-color')).toBe('#ff6b6b')
    expect(root.style.getPropertyValue('--glass-frost')).toBe('0.5')
    expect(root.style.getPropertyValue('--glass-managed-simple-background')).toBe('')
    expect(root.style.borderRadius).toBe('12px')
  })

  it('only applies the Studio fallback treatment while the scene is not ready or pending', () => {
    const controller = { register: vi.fn(() => vi.fn()), update: vi.fn() }
    const { container } = render(
      <div data-liquid-glass-scene="">
        <LiquidGlassSceneContext.Provider value={controller}>
          <LiquidGlass tint={{ r: 22, g: 35, b: 43, a: 0.75 }} />
        </LiquidGlassSceneContext.Provider>
      </div>
    )
    const scene = container.firstChild as HTMLElement
    const root = scene.firstChild as HTMLElement
    const rules: CSSStyleRule[] = []
    const collect = (list: CSSRuleList) => {
      for (const rule of Array.from(list)) {
        if (rule instanceof CSSStyleRule) rules.push(rule)
        else if ('cssRules' in rule) collect((rule as CSSGroupingRule).cssRules)
      }
    }
    for (const sheet of Array.from(document.styleSheets)) collect(sheet.cssRules)
    const fallbackRule = rules.find(
      (rule) => rule.style.background === 'var(--glass-managed-background)'
    )
    if (!fallbackRule) throw new Error('Managed fallback selector was not generated')
    // jsdom's selector engine does not support nested :not() inside :where().
    const selector = fallbackRule.selectorText
      .replace(/\s+/g, ' ')
      .replace(/^:where\((.*)\) /, '$1 ')
    expect(root.matches(selector)).toBe(true)
    scene.dataset.liquidGlassSceneReady = 'true'
    expect(root.matches(selector)).toBe(false)
    delete scene.dataset.liquidGlassSceneReady
    scene.dataset.liquidGlassScenePending = 'true'
    expect(root.matches(selector)).toBe(false)
  })
})
