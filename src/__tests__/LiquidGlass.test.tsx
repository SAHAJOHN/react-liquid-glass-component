import { afterEach, describe, it, expect, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { LiquidGlass } from '../LiquidGlass'
import * as capture from '../backdrop-capture'
import * as renderer from '../webgl-refraction'

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
    const create = vi.spyOn(renderer, 'createWebGLRefraction').mockReturnValue({ render: draw, dispose })
    let deliver: ((image: HTMLCanvasElement | null, generation?: number) => void) | undefined
    const subscribe = vi.spyOn(capture, 'subscribeBackdrop').mockImplementation((listener) => {
      deliver = listener
      return unsubscribe
    })
    const { rerender, unmount } = render(<LiquidGlass distortionScale={-180}>Content</LiquidGlass>)
    const source = document.createElement('canvas')
    act(() => deliver?.(source, 12))
    expect(draw).toHaveBeenCalledWith(source, expect.objectContaining({ distortionScale: -180, frameId: 12 }))

    rerender(<LiquidGlass distortionScale={-260} redOffset={8}>Content</LiquidGlass>)
    expect(draw).toHaveBeenLastCalledWith(source, expect.objectContaining({ distortionScale: -260, redOffset: 8, frameId: 12 }))
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
    const rect = vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 80, 200, 100))
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
    const scales = Array.from(container.querySelectorAll('feDisplacementMap'),
      (channel) => channel.getAttribute('scale'))
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
      </LiquidGlass>,
    )
    const root = container.firstChild as HTMLElement
    expect(root.style.width).toBe('100%')
    expect(root.style.height).toBe('50vh')
  })

  it('sets glassColor and backgroundOpacity as CSS custom properties', () => {
    const { container } = render(
      <LiquidGlass glassColor="#ff6b6b" backgroundOpacity={0.5}>
        x
      </LiquidGlass>,
    )
    const root = container.firstChild as HTMLElement
    expect(root.style.getPropertyValue('--glass-color')).toBe('#ff6b6b')
    expect(root.style.getPropertyValue('--glass-frost')).toBe('0.5')
  })
})
