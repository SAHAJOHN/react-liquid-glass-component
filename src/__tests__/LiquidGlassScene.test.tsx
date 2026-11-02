import { act, cleanup, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GLASS_STUDIO_DEFAULTS, LiquidGlass, LiquidGlassScene } from '../index'
import * as capture from '../backdrop-capture'
import * as compilerModule from '../scene/dom-scene'
import * as rendererModule from '../scene/renderer'
import type { CompiledScene, GlassOptions } from '../scene/types'

describe('LiquidGlassScene', () => {
  let callbacks: Map<number, FrameRequestCallback>
  let nextId: number
  let result: CompiledScene
  let registrations: ReadonlyMap<HTMLElement, GlassOptions>
  const dispose = vi.fn()
  const disposeCompiler = vi.fn()
  const draw = vi.fn(() => true)
  const setScene = vi.fn()
  const tick = () =>
    act(() => {
      const pending = [...callbacks.values()]
      callbacks.clear()
      pending.forEach((callback) => callback(100))
    })

  beforeEach(() => {
    callbacks = new Map()
    nextId = 0
    result = {
      scene: { background: [0, 0, 0, 1], items: [] },
      targets: [],
      issues: [],
      liveGeometry: false,
      media: [],
    }
    registrations = new Map()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++nextId, callback)
      return nextId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
    vi.stubGlobal('CSS', { supports: (property: string) => property === '-webkit-touch-callout' })
    vi.spyOn(rendererModule, 'createSceneRenderer').mockReturnValue({
      render: draw,
      setScene,
      dispose,
    })
    vi.spyOn(compilerModule, 'createSceneCompiler').mockReturnValue({
      compile: vi.fn((_root, glasses) => {
        registrations = new Map(glasses)
        return result
      }),
      dispose: disposeCompiler,
    })
    vi.spyOn(capture, 'subscribeBackdrop')
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('creates one managed canvas and registers existing LiquidGlass props without capture or markers', () => {
    const ref = createRef<HTMLDivElement>()
    const onClick = vi.fn()
    const { container, rerender, unmount } = render(
      <LiquidGlassScene ref={ref}>
        <p>Ordinary HTML</p>
        <LiquidGlass distortionScale={-180}>
          <button onClick={onClick}>Press</button>
        </LiquidGlass>
        <LiquidGlass>Another pane</LiquidGlass>
      </LiquidGlassScene>
    )
    tick()
    expect(ref.current).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(container.querySelectorAll('canvas')).toHaveLength(1)
    expect(registrations.size).toBe(2)
    expect(
      [...registrations.values()].every(
        (options) => JSON.stringify(options.studio) === JSON.stringify(GLASS_STUDIO_DEFAULTS)
      )
    ).toBe(true)
    expect(
      [...registrations.values()].every(
        (options) => options.magnification === 1 && options.thickness === 20
      )
    ).toBe(true)
    expect(capture.subscribeBackdrop).not.toHaveBeenCalled()
    expect(container.querySelector('.liquid-glass__filter')).toBeNull()
    act(() => screen.getByRole('button', { name: 'Press' }).click())
    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.getByText('Ordinary HTML')).toBeVisible()

    rerender(
      <LiquidGlassScene ref={ref}>
        <LiquidGlass distortionScale={-260} redOffset={10} magnification={1.25}>
          Updated
        </LiquidGlass>
      </LiquidGlassScene>
    )
    tick()
    expect(registrations.size).toBe(1)
    expect([...registrations.values()][0]?.displacement).toEqual([-250, -260, -260])
    expect([...registrations.values()][0]?.magnification).toBe(1.25)
    expect([...registrations.values()][0]?.map).toEqual(
      expect.objectContaining({
        blur: 11,
        brightness: 50,
        opacity: 0.93,
        borderWidth: 0.07,
        xChannel: 'R',
        yChannel: 'G',
        mixBlendMode: 'difference',
      })
    )
    rerender(
      <LiquidGlassScene ref={ref}>
        <LiquidGlass thickness={40} convexity={0} magnification={1.25}>
          Flat
        </LiquidGlass>
      </LiquidGlassScene>
    )
    tick()
    expect([...registrations.values()][0]).toEqual(
      expect.objectContaining({ thickness: 40, magnification: 1 })
    )
    rerender(
      <LiquidGlassScene ref={ref}>
        <LiquidGlass thickness={40} convexity={0.4}>
          Curved
        </LiquidGlass>
      </LiquidGlassScene>
    )
    tick()
    expect([...registrations.values()][0]).toEqual(
      expect.objectContaining({ thickness: 40, magnification: 1.2 })
    )
    unmount()
    expect(dispose).toHaveBeenCalledOnce()
    expect(disposeCompiler).toHaveBeenCalledOnce()
    expect(callbacks.size).toBe(0)
  })

  it('keeps native HTML visible for unsupported content and recovers after a supported change', () => {
    result.issues = ['Unsupported test content']
    const onStatusChange = vi.fn()
    const { container, rerender } = render(
      <LiquidGlassScene onStatusChange={onStatusChange}>
        <LiquidGlass>Native content</LiquidGlass>
      </LiquidGlassScene>
    )
    tick()
    expect(container.firstChild).not.toHaveAttribute('data-liquid-glass-scene-ready')
    expect(screen.getByText('Native content')).toBeVisible()
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: 'fallback',
      reasons: ['Unsupported test content'],
    })
    result.issues = []
    rerender(
      <LiquidGlassScene onStatusChange={onStatusChange}>
        <LiquidGlass distortionScale={-200}>Native content</LiquidGlass>
      </LiquidGlassScene>
    )
    tick()
    expect(container.firstChild).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(onStatusChange).toHaveBeenLastCalledWith({ status: 'ready' })
  })

  it('registers canonical Studio controls without forwarding them as DOM attributes', () => {
    const { container } = render(
      <LiquidGlassScene>
        <LiquidGlass
          refThickness={30}
          thickness={60}
          refDistance={0.08}
          refFactor={2}
          glareAngle={45}
          blurEdge={false}
          tint={{ r: 20, g: 40, b: 60, a: 0.2 }}
          shapeWidth={200}
          shapeHeight={160}
        >
          Studio
        </LiquidGlass>
      </LiquidGlassScene>
    )
    tick()
    const pane = container.querySelector('.liquid-glass')
    expect(pane).toHaveStyle({ width: '200px', height: '160px' })
    for (const name of [
      'refThickness',
      'refDistance',
      'refFactor',
      'glareAngle',
      'blurEdge',
      'tint',
      'shapeWidth',
      'shapeHeight',
    ]) {
      expect(pane).not.toHaveAttribute(name)
    }
    expect([...registrations.values()][0]?.studio).toEqual(
      expect.objectContaining({
        refThickness: 30,
        refDistance: 0.08,
        refFactor: 2,
        glareAngle: 45,
        blurEdge: false,
        tint: { r: 20, g: 40, b: 60, a: 0.2 },
      })
    )
  })

  it('reuses the scene on ordinary window scrolling and rebuilds after context restoration', () => {
    const { container } = render(
      <LiquidGlassScene>
        <LiquidGlass>Content</LiquidGlass>
      </LiquidGlassScene>
    )
    tick()
    const initialScenes = setScene.mock.calls.length
    expect(callbacks.size).toBe(0)
    vi.stubGlobal('scrollY', 200)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(setScene).toHaveBeenCalledTimes(initialScenes)
    expect(draw).toHaveBeenLastCalledWith(expect.objectContaining({ scrollY: 200 }))
    const canvas = container.querySelector('canvas')
    expect(canvas).not.toBeNull()
    act(() => canvas?.dispatchEvent(new Event('webglcontextlost', { cancelable: true })))
    expect(container.firstChild).not.toHaveAttribute('data-liquid-glass-scene-ready')
    expect(callbacks.size).toBe(0)
    act(() => canvas?.dispatchEvent(new Event('webglcontextrestored')))
    tick()
    expect(rendererModule.createSceneRenderer).toHaveBeenCalledTimes(2)
    expect(container.firstChild).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
  })

  it('ignores visual viewport events without a layout resize but rebuilds for a real resize', () => {
    const viewport = new EventTarget()
    vi.stubGlobal('visualViewport', viewport)
    render(
      <LiquidGlassScene>
        <LiquidGlass>Content</LiquidGlass>
      </LiquidGlassScene>
    )
    tick()
    const initialScenes = setScene.mock.calls.length
    const initialDraws = draw.mock.calls.length
    act(() => viewport.dispatchEvent(new Event('resize')))
    tick()
    expect(setScene).toHaveBeenCalledTimes(initialScenes)
    expect(draw).toHaveBeenCalledTimes(initialDraws)
    vi.stubGlobal('innerHeight', window.innerHeight - 80)
    act(() => window.dispatchEvent(new Event('resize')))
    tick()
    expect(setScene).toHaveBeenCalledTimes(initialScenes + 1)
    expect(draw).toHaveBeenCalledWith(expect.objectContaining({ height: window.innerHeight }))
  })
})
