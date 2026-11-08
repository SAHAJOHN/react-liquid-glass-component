import { act, cleanup, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GLASS_STUDIO_DEFAULTS, LiquidGlass, LiquidGlassScene } from '../index'
import * as capture from '../backdrop-capture'
import * as compilerModule from '../scene/dom-scene'
import * as rendererModule from '../scene/renderer'
import type { CompiledScene, GlassOptions, SceneFrame } from '../scene/types'

describe('LiquidGlassScene', () => {
  let callbacks: Map<number, FrameRequestCallback>
  let nextId: number
  let result: CompiledScene
  let registrations: ReadonlyMap<HTMLElement, GlassOptions>
  const dispose = vi.fn()
  const disposeCompiler = vi.fn()
  const draw = vi.fn<(frame: SceneFrame) => boolean>(() => true)
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

  it('keeps the default canvas pixel budget and allows an explicit higher budget', () => {
    vi.stubGlobal('innerWidth', 430)
    vi.stubGlobal('innerHeight', 932)
    vi.stubGlobal('devicePixelRatio', 3)
    const { container, rerender } = render(
      <LiquidGlassScene maxPixelRatio={3}>
        <LiquidGlass>Pane</LiquidGlass>
      </LiquidGlassScene>
    )
    tick()
    expect(draw).toHaveBeenLastCalledWith(
      expect.objectContaining({ pixelRatio: Math.sqrt(2_000_000 / (430 * 932)) })
    )

    rerender(
      <LiquidGlassScene maxPixelRatio={3} maxCanvasPixels={16_777_216}>
        <LiquidGlass>Pane</LiquidGlass>
      </LiquidGlassScene>
    )
    tick()
    expect(draw).toHaveBeenLastCalledWith(expect.objectContaining({ pixelRatio: 3 }))
    expect(container.firstElementChild).not.toHaveAttribute('maxCanvasPixels')

    rerender(
      <LiquidGlassScene maxPixelRatio={3} maxCanvasPixels={1}>
        <LiquidGlass>Pane</LiquidGlass>
      </LiquidGlassScene>
    )
    tick()
    expect(draw).toHaveBeenLastCalledWith(
      expect.objectContaining({ pixelRatio: Math.sqrt(1 / (430 * 932)) })
    )
  })

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'uses the safe default pixel budget when given %s',
    (maxCanvasPixels) => {
      vi.stubGlobal('innerWidth', 430)
      vi.stubGlobal('innerHeight', 932)
      vi.stubGlobal('devicePixelRatio', 3)
      render(
        <LiquidGlassScene maxPixelRatio={3} maxCanvasPixels={maxCanvasPixels}>
          <LiquidGlass>Pane</LiquidGlass>
        </LiquidGlassScene>
      )
      tick()
      expect(draw).toHaveBeenLastCalledWith(
        expect.objectContaining({ pixelRatio: Math.sqrt(2_000_000 / (430 * 932)) })
      )
    }
  )

  it('keeps the 4096px side limit even when the canvas pixel budget is larger', () => {
    vi.stubGlobal('innerWidth', 2000)
    vi.stubGlobal('innerHeight', 1000)
    vi.stubGlobal('devicePixelRatio', 3)
    render(
      <LiquidGlassScene maxPixelRatio={3} maxCanvasPixels={100_000_000}>
        <LiquidGlass>Pane</LiquidGlass>
      </LiquidGlassScene>
    )
    tick()
    expect(draw).toHaveBeenLastCalledWith(expect.objectContaining({ pixelRatio: 4096 / 2000 }))
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

  it('registers a per-pane layer only for opted-in panes in a layered scene', () => {
    const { container, rerender } = render(
      <LiquidGlassScene foreground="layered">
        <LiquidGlass nativeContent><button>Native</button></LiquidGlass>
        <LiquidGlass>Canvas only</LiquidGlass>
      </LiquidGlassScene>
    )
    tick()
    const scene = container.querySelector('[data-liquid-glass-scene]')
    expect(scene).toHaveAttribute('data-liquid-glass-foreground-mode', 'layered')
    expect(scene).not.toHaveAttribute('data-liquid-glass-layered-visible')
    const layer = container.querySelector<HTMLCanvasElement>('.liquid-glass__native-layer')
    expect(layer).not.toBeNull()
    expect(layer).toHaveAttribute('data-liquid-glass-scene-canvas')
    expect(layer).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelectorAll('.liquid-glass__native-layer')).toHaveLength(1)
    expect([...registrations.values()].filter((entry) => entry.nativeLayer === layer)).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Native' })).toBeVisible()

    rerender(
      <LiquidGlassScene>
        <LiquidGlass nativeContent><button>Native</button></LiquidGlass>
      </LiquidGlassScene>
    )
    tick()
    expect(scene).not.toHaveAttribute('data-liquid-glass-foreground-mode')
    expect(container.querySelector('.liquid-glass__native-layer')).toBeNull()
    expect([...registrations.values()].every((entry) => !entry.nativeLayer)).toBe(true)
  })

  it('shows native layers only after every pane is rendered, and clears them on fallback', () => {
    const { container, rerender } = render(
      <LiquidGlassScene foreground="layered">
        <LiquidGlass nativeContent>Native content</LiquidGlass>
      </LiquidGlassScene>
    )
    const scene = container.querySelector('[data-liquid-glass-scene]')
    expect(scene).not.toHaveAttribute('data-liquid-glass-layered-visible')
    tick()
    expect(scene).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(scene).toHaveAttribute('data-liquid-glass-layered-visible')

    result.issues = ['Unsupported test content']
    rerender(
      <LiquidGlassScene foreground="layered">
        <LiquidGlass nativeContent distortionScale={-200}>Native content</LiquidGlass>
      </LiquidGlassScene>
    )
    tick()
    expect(scene).not.toHaveAttribute('data-liquid-glass-layered-visible')
    expect(scene).not.toHaveAttribute('data-liquid-glass-scene-ready')
    expect(screen.getByText('Native content')).toBeVisible()
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
