import { act, cleanup, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiquidGlass, LiquidGlassScene } from '../index'
import * as compilerModule from '../scene/dom-scene'
import * as rendererModule from '../scene/renderer'

function mockRect(element: Element, x: number, y: number, width: number, height: number) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x,
      y,
      width,
      height,
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
      toJSON: () => ({}),
    }),
  })
}

describe('individual translate anchored scene geometry', () => {
  let callbacks: Map<number, FrameRequestCallback>
  let nextId: number
  beforeEach(() => {
    callbacks = new Map()
    nextId = 0
    vi.stubGlobal('innerWidth', 400)
    vi.stubGlobal('innerHeight', 800)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++nextId, callback)
      return nextId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
    vi.spyOn(rendererModule, 'createSceneRenderer').mockReturnValue({
      render: () => true,
      setScene: vi.fn(),
      dispose: vi.fn(),
    })
    vi.spyOn(compilerModule, 'createSceneCompiler').mockReturnValue({
      compile: () => ({
        scene: { background: [0, 0, 0, 1], items: [] },
        targets: [],
        issues: [],
        liveGeometry: false,
        media: [],
      }),
      dispose: vi.fn(),
    })
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function runFixture({
    hostAncestor,
    canvasAncestor,
    containerTranslate,
  }: {
    hostAncestor?: string
    canvasAncestor?: string
    containerTranslate?: string
  }) {
    const onStatusChange = vi.fn()
    function Fixture() {
      const [nav, setNav] = useState<HTMLElement | null>(null)
      return (
        <div style={{ translate: hostAncestor }}>
          <LiquidGlassScene
            presentation="glass-only"
            canvasContainer={nav}
            onStatusChange={onStatusChange}
          >
            <div style={{ translate: canvasAncestor }}>
              <nav ref={setNav} style={{ position: 'fixed', translate: containerTranslate }}>
                <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0} />
              </nav>
            </div>
          </LiquidGlassScene>
        </div>
      )
    }
    const { container } = render(<Fixture />)
    const host = container.querySelector('[data-liquid-glass-scene]')
    const pane = container.querySelector('.liquid-glass')
    const nav = container.querySelector('nav')
    const canvas = nav?.querySelector('canvas')
    if (!host || !pane || !nav || !canvas) throw new Error('Missing scene elements')
    mockRect(host, 0, 0, 400, 800)
    mockRect(nav, 20, 700, 360, 70)
    mockRect(pane, 20, 700, 360, 70)
    act(() => {
      const pending = [...callbacks.values()]
      callbacks.clear()
      pending.forEach((callback) => callback(100))
    })
    return { onStatusChange, host, canvas }
  }

  it('accepts a pure individual translate on the fixed canvas container itself', () => {
    const { onStatusChange, host, canvas } = runFixture({ containerTranslate: '-50%' })
    expect(onStatusChange).toHaveBeenLastCalledWith({ status: 'ready' })
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(canvas.style.left).toBe('-20px')
    expect(canvas.style.top).toBe('-700px')
  })

  it('rejects a translated ancestor of the scene even when the translate is zero', () => {
    const { onStatusChange, host } = runFixture({ hostAncestor: '0px' })
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-ready')
    expect(onStatusChange.mock.lastCall?.[0]?.status).toBe('fallback')
    expect(onStatusChange.mock.lastCall?.[0]?.reasons).toContain(
      'LiquidGlassScene needs ancestors without transform, perspective or filter.'
    )
  })

  it('rejects a translated ancestor of the fixed canvas container inside the scene', () => {
    const { onStatusChange, host } = runFixture({ canvasAncestor: '1px' })
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-ready')
    expect(onStatusChange.mock.lastCall?.[0]?.status).toBe('fallback')
    expect(onStatusChange.mock.lastCall?.[0]?.reasons).toContain(
      'Canvas container needs ancestors without transform, perspective or filter.'
    )
  })

  it('rejects a 3D individual translate on the canvas container', () => {
    const { onStatusChange, host } = runFixture({ containerTranslate: '1px 2px 3px' })
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-ready')
    expect(onStatusChange.mock.lastCall?.[0]?.status).toBe('fallback')
    expect(onStatusChange.mock.lastCall?.[0]?.reasons).toContain(
      'Canvas container must be an unscaled fixed ancestor of every glass-only pane inside the scene.'
    )
  })
})
