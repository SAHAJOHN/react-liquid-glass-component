import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneRenderer } from '../scene/renderer'
import { GLASS_STUDIO_DEFAULTS } from '../studio-props'
import type { GlassScene, SceneItem, SceneOpacityPaint } from '../scene/types'

vi.mock('../scene/studio-pass', () => ({
  createStudioPass: vi.fn(() => ({ render: vi.fn(() => true), dispose: vi.fn() })),
}))
vi.mock('../scene/backdrop-pass', () => ({
  createBackdropPass: vi.fn(() => ({ render: vi.fn(() => true), dispose: vi.fn() })),
}))

function fixture() {
  let id = 0
  const make = () => ({ id: ++id })
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    TEXTURE0: 7,
    TEXTURE1: 8,
    TEXTURE_2D: 10,
    TEXTURE_WRAP_S: 11,
    TEXTURE_WRAP_T: 12,
    CLAMP_TO_EDGE: 13,
    TEXTURE_MIN_FILTER: 14,
    TEXTURE_MAG_FILTER: 15,
    LINEAR: 16,
    RGBA: 18,
    UNSIGNED_BYTE: 19,
    FRAMEBUFFER: 20,
    COLOR_ATTACHMENT0: 21,
    FRAMEBUFFER_COMPLETE: 22,
    FLOAT: 23,
    BLEND: 24,
    SCISSOR_TEST: 25,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 26,
    UNPACK_FLIP_Y_WEBGL: 27,
    TRIANGLE_STRIP: 30,
    NO_ERROR: 0,
    MAX_TEXTURE_SIZE: 31,
    DEPTH_TEST: 32,
    CULL_FACE: 33,
    ONE: 34,
    ONE_MINUS_SRC_ALPHA: 35,
    FUNC_ADD: 36,
    COLOR_BUFFER_BIT: 37,
    createProgram: vi.fn(make),
    createShader: vi.fn(make),
    createBuffer: vi.fn(make),
    createTexture: vi.fn(make),
    createFramebuffer: vi.fn(make),
    getShaderParameter: vi.fn(() => true),
    getProgramParameter: vi.fn(() => true),
    getAttribLocation: vi.fn(() => 0),
    getUniformLocation: vi.fn(make),
    getParameter: vi.fn(() => 4096),
    getError: vi.fn(() => 0),
    isContextLost: vi.fn(() => false),
    checkFramebufferStatus: vi.fn(() => 22),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    deleteShader: vi.fn(),
    deleteProgram: vi.fn(),
    deleteBuffer: vi.fn(),
    deleteTexture: vi.fn(),
    deleteFramebuffer: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    activeTexture: vi.fn(),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    texSubImage2D: vi.fn(),
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    useProgram: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    viewport: vi.fn(),
    disable: vi.fn(),
    enable: vi.fn(),
    scissor: vi.fn(),
    pixelStorei: vi.fn(),
    uniform2f: vi.fn(),
    uniform4f: vi.fn(),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    uniform3f: vi.fn(),
    uniform4fv: vi.fn(),
    uniform2fv: vi.fn(),
    drawArrays: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    blendEquation: vi.fn(),
    blendFunc: vi.fn(),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    gl as unknown as WebGLRenderingContext
  )
  const output = document.createElement('canvas')
  const source = document.createElement('canvas')
  source.width = source.height = 20
  const bitmap = document.createElement('canvas')
  bitmap.width = bitmap.height = 20
  const frame = { width: 100, height: 100, scrollX: 0, scrollY: 0, pixelRatio: 1 }
  const children: SceneOpacityPaint[] = [
    {
      kind: 'sprite',
      bitmap,
      rect: { x: 10, y: 10, width: 20, height: 20 },
      space: 'document',
      opacity: 1,
    },
    {
      kind: 'media',
      source,
      fit: 'fill',
      position: [0, 0],
      radius: 0,
      rect: { x: 10, y: 10, width: 20, height: 20 },
      space: 'document',
      opacity: 1,
    },
  ]
  const scene: GlassScene = {
    background: [1, 1, 1, 1],
    items: [
      {
        kind: 'opacity-group',
        items: children,
        rect: { x: 10, y: 10, width: 20, height: 20 },
        space: 'document',
        opacity: 0.5,
      },
    ],
  }
  const renderer = createSceneRenderer(output)
  if (!renderer) throw new Error('Scene renderer could not initialize')
  return { gl, renderer, frame, scene, source, bitmap }
}

afterEach(() => vi.restoreAllMocks())

const region = { x: 10, y: 10, width: 20, height: 20 }
const backdrop = (rect: { x: number; y: number; width: number; height: number }): SceneItem => ({
  kind: 'solid',
  rect,
  radius: 0,
  color: [0, 0, 0, 1],
  space: 'viewport',
  opacity: 1,
})

function scoped(items: SceneItem[], renderRegions = [region]): GlassScene {
  return { background: [1, 1, 1, 1], items, samplingRegion: region, renderRegions }
}

function pane(): Extract<SceneItem, { kind: 'glass' }> {
  return {
    kind: 'glass',
    rect: region,
    space: 'viewport',
    opacity: 1,
    radius: 10,
    displacement: [0, 0, 0],
    blur: 0,
    saturation: 1,
    tint: [0, 0, 0, 0],
    studio: { ...GLASS_STUDIO_DEFAULTS, refDistance: 0, blurRadius: 0, shadowFactor: 0 },
  }
}

describe('glass-only renderer source-region culling', () => {
  it('uses the current optical footprint instead of the wider compiler capture window', () => {
    const { gl, renderer, frame, source } = fixture()
    const nearSource = document.createElement('canvas')
    nearSource.width = nearSource.height = 20
    const media: Extract<SceneItem, { kind: 'media' }> = {
      kind: 'media',
      source,
      fit: 'fill',
      position: [0, 0],
      radius: 0,
      rect: { x: 10, y: 80, width: 20, height: 20 },
      space: 'document',
      opacity: 1,
    }
    renderer.setScene(
      scoped(
        [media, { ...media, source: nearSource, rect: region }, pane()],
        [{ x: 0, y: 0, width: 100, height: 100 }]
      )
    )
    expect(renderer.render(frame)).toBe(true)
    expect(gl.texImage2D.mock.calls.some((call) => call.includes(source))).toBe(false)
    expect(gl.texImage2D.mock.calls.some((call) => call.includes(nearSource))).toBe(true)
    expect(renderer.render({ ...frame, scrollY: 70 })).toBe(true)
    expect(gl.texImage2D.mock.calls.some((call) => call.includes(source))).toBe(true)
    renderer.dispose()
  })

  it('keeps media outside the pane when a backdrop blur needs its pixels', () => {
    const { gl, renderer, frame, source, bitmap } = fixture()
    const layer: Extract<SceneItem, { kind: 'backdrop' }> = {
      kind: 'backdrop',
      bitmap,
      sigma: 10,
      radius: 0,
      rect: { x: 0, y: 0, width: 100, height: 100 },
      space: 'viewport',
      opacity: 1,
    }
    const media: SceneItem = {
      kind: 'media',
      source,
      fit: 'fill',
      position: [0, 0],
      radius: 0,
      rect: { x: 50, y: 50, width: 10, height: 10 },
      space: 'viewport',
      opacity: 1,
    }
    renderer.setScene(scoped([media, layer, pane()]))
    expect(renderer.render(frame)).toBe(true)
    expect(gl.texImage2D.mock.calls.some((call) => call.includes(source))).toBe(true)
    renderer.dispose()
  })

  it('retains compiler regions when the per-frame sampling proof is unavailable', () => {
    const { gl, renderer, frame, source } = fixture()
    const media: SceneItem = {
      kind: 'media',
      source,
      fit: 'fill',
      position: [0, 0],
      radius: 0,
      rect: { x: 70, y: 70, width: 20, height: 20 },
      space: 'viewport',
      opacity: 1,
    }
    renderer.setScene(scoped([media], [{ x: 0, y: 0, width: 100, height: 100 }]))
    expect(renderer.render(frame)).toBe(true)
    expect(gl.texImage2D.mock.calls.some((call) => call.includes(source))).toBe(true)
    renderer.dispose()
  })

  it('draws inside regions and skips distant paint while preserving the presentation pass', () => {
    const { gl, renderer, frame } = fixture()
    renderer.setScene(
      scoped([
        backdrop({ x: 10, y: 10, width: 10, height: 10 }),
        backdrop({ x: 70, y: 70, width: 10, height: 10 }),
      ])
    )
    expect(renderer.render(frame)).toBe(true)
    expect(gl.drawArrays).toHaveBeenCalledTimes(2)
    renderer.dispose()
  })

  it('honors multiple disjoint regions and keeps the gap unpainted', () => {
    const { gl, renderer, frame } = fixture()
    renderer.setScene(
      scoped(
        [
          backdrop({ x: 10, y: 10, width: 10, height: 10 }),
          backdrop({ x: 45, y: 45, width: 5, height: 5 }),
          backdrop({ x: 75, y: 75, width: 10, height: 10 }),
        ],
        [region, { x: 70, y: 70, width: 20, height: 20 }]
      )
    )
    expect(renderer.render(frame)).toBe(true)
    expect(gl.drawArrays).toHaveBeenCalledTimes(3)
    renderer.dispose()
  })

  it('does not upload out-of-region media and draws it once scrolling brings it into view', () => {
    const { gl, renderer, frame, source } = fixture()
    const item: SceneItem = {
      kind: 'media',
      source,
      fit: 'fill',
      position: [0, 0],
      radius: 0,
      rect: { x: 10, y: 80, width: 20, height: 20 },
      space: 'document',
      opacity: 1,
    }
    renderer.setScene(scoped([item]))
    expect(renderer.render(frame)).toBe(true)
    expect(gl.texImage2D.mock.calls.some((call) => call.includes(source))).toBe(false)
    expect(renderer.render({ ...frame, scrollY: 70 })).toBe(true)
    expect(gl.texImage2D.mock.calls.some((call) => call.includes(source))).toBe(true)
    renderer.dispose()
  })

  it('avoids allocating a framebuffer for an out-of-region opacity group', () => {
    const { gl, renderer, frame, source } = fixture()
    const child: SceneOpacityPaint = {
      kind: 'media',
      source,
      fit: 'fill',
      position: [0, 0],
      radius: 0,
      rect: { x: 70, y: 70, width: 20, height: 20 },
      space: 'viewport',
      opacity: 1,
    }
    renderer.setScene(
      scoped([
        {
          kind: 'opacity-group',
          items: [child],
          rect: child.rect,
          space: 'viewport',
          opacity: 0.5,
        },
      ])
    )
    expect(renderer.render(frame)).toBe(true)
    expect(gl.createFramebuffer).toHaveBeenCalledTimes(1)
    expect(gl.texImage2D.mock.calls.some((call) => call.includes(source))).toBe(false)
    renderer.dispose()
  })

  it('fails open for invalid regions and unbounded group geometry', () => {
    const { gl, renderer, frame, source } = fixture()
    const child: SceneOpacityPaint = {
      kind: 'media',
      source,
      fit: 'fill',
      position: [0, 0],
      radius: 0,
      rect: { x: 10, y: 10, width: 20, height: 20 },
      space: 'viewport',
      opacity: 1,
    }
    renderer.setScene(
      scoped([
        {
          kind: 'opacity-group',
          items: [child],
          rect: { x: 70, y: 70, width: 10, height: 10 },
          space: 'viewport',
          opacity: 0.5,
        },
      ])
    )
    expect(renderer.render(frame)).toBe(true)
    expect(gl.texImage2D.mock.calls.some((call) => call.includes(source))).toBe(true)
    gl.drawArrays.mockClear()
    renderer.setScene(
      scoped(
        [backdrop({ x: 70, y: 70, width: 10, height: 10 })],
        [{ x: 0, y: 0, width: 0, height: 1 }]
      )
    )
    expect(renderer.render(frame)).toBe(true)
    expect(gl.drawArrays).toHaveBeenCalledTimes(2)
    renderer.dispose()
  })

  it('disables culling when any Studio pane has a shadow', () => {
    const { gl, renderer, frame } = fixture()
    const pane: SceneItem = {
      kind: 'glass',
      rect: { x: 70, y: 70, width: 20, height: 20 },
      space: 'viewport',
      opacity: 1,
      radius: 10,
      displacement: [0, 0, 0],
      blur: 0,
      saturation: 1,
      tint: [0, 0, 0, 0],
      studio: { ...GLASS_STUDIO_DEFAULTS, shadowFactor: 1 },
    }
    renderer.setScene(scoped([backdrop({ x: 70, y: 70, width: 10, height: 10 }), pane]))
    expect(renderer.render(frame)).toBe(true)
    expect(gl.drawArrays).toHaveBeenCalledTimes(2)
    renderer.dispose()
  })
})
