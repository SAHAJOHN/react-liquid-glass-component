import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiquidGlass, LiquidGlassScene } from '../index'
import * as compilerModule from '../scene/dom-scene'
import * as rendererModule from '../scene/renderer'
import type { CompiledScene, SceneRect } from '../scene/types'

function mockRect(element: Element, rect: SceneRect) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      ...rect,
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => ({}),
    }),
  })
}

describe('native foreground presentation', () => {
  let frames: Map<number, FrameRequestCallback>
  let nextFrame: number
  let compiled: CompiledScene
  const tick = () =>
    act(() => {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach((frame) => frame(100))
    })

  beforeEach(() => {
    frames = new Map()
    nextFrame = 0
    compiled = {
      scene: { background: [0, 0, 0, 1], items: [] },
      targets: [],
      issues: [],
      liveGeometry: false,
      media: [],
    }
    vi.stubGlobal('innerWidth', 400)
    vi.stubGlobal('innerHeight', 800)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback)
      return nextFrame
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    vi.spyOn(rendererModule, 'createSceneRenderer').mockReturnValue({
      render: vi.fn(() => true),
      setScene: vi.fn(),
      dispose: vi.fn(),
    })
    vi.spyOn(compilerModule, 'createSceneCompiler').mockReturnValue({
      compile: () => compiled,
      dispose: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function fixture(foreground?: 'native') {
    const clicked = vi.fn()
    function Fixture() {
      const [nav, setNav] = useState<HTMLElement | null>(null)
      return (
        <LiquidGlassScene
          presentation="glass-only"
          canvasContainer={nav}
          {...(foreground ? { foreground } : {})}
        >
          <nav ref={setNav} style={{ position: 'fixed' }}>
            <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0} />
            <button data-liquid-glass-foreground="" onClick={clicked}>
              Native button
            </button>
          </nav>
        </LiquidGlassScene>
      )
    }
    const { container } = render(<Fixture />)
    const host = container.querySelector('[data-liquid-glass-scene]')
    const nav = container.querySelector('nav')
    const pane = container.querySelector('.liquid-glass')
    const canvas = nav?.querySelector('canvas')
    if (!host || !nav || !pane || !canvas) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 1200 })
    mockRect(nav, { x: 20, y: 700, width: 360, height: 70 })
    mockRect(pane, { x: 20, y: 700, width: 360, height: 70 })
    tick()
    return { host, nav, pane, canvas, clicked }
  }

  it('keeps the existing canvas-on-top presentation by default', () => {
    const { host, canvas } = fixture()
    expect(host).not.toHaveAttribute('data-liquid-glass-foreground-mode', 'native')
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(canvas.style.zIndex).toBe('2147483647')
  })

  it('opts into native foreground while retaining a clipped, non-interactive canvas and HTML controls', () => {
    const { host, canvas, clicked } = fixture('native')
    expect(host).toHaveAttribute('data-liquid-glass-foreground-mode', 'native')
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(canvas.style.zIndex).toBe('0')
    expect(canvas.style.pointerEvents).toBe('none')
    expect(canvas.style.opacity).toBe('1')
    expect(canvas.style.clipPath).toBe('inset(700px 20px 30px 20px round 35px)')
    fireEvent.click(screen.getByRole('button', { name: 'Native button' }))
    expect(clicked).toHaveBeenCalledOnce()
  })

  it('preserves the last glass frame and native controls while an asset is pending', () => {
    const { host, canvas, clicked } = fixture('native')
    compiled.issues = ['Image is loading']
    vi.stubGlobal('scrollY', 10)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(host).toHaveAttribute('data-liquid-glass-scene-pending', 'true')
    expect(canvas.style.opacity).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'Native button' }))
    expect(clicked).toHaveBeenCalledOnce()
  })

  it('keeps the HTML control accessible and restores fallback when the renderer cannot present a scene', () => {
    const { host, canvas, clicked } = fixture('native')
    compiled.issues = ['Unsupported test effect']
    vi.stubGlobal('scrollY', 10)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-ready')
    expect(canvas.style.opacity).toBe('0')
    expect(screen.getByRole('button', { name: 'Native button' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Native button' }))
    expect(clicked).toHaveBeenCalledOnce()
  })
})
