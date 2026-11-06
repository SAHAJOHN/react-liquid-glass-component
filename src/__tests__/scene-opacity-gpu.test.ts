import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneRenderer } from '../scene/renderer'
import { createStudioPass } from '../scene/studio-pass'
import { createBackdropPass } from '../scene/backdrop-pass'
import { GLASS_STUDIO_DEFAULTS } from '../studio-props'
import type { GlassScene, SceneOpacityPaint } from '../scene/types'

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
    getUniformLocation: vi.fn((...args: unknown[]) => {
      void args
      return make()
    }),
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

describe('GPU opacity groups', () => {
  it('uploads the mask and enables it only for the composed group draw', () => {
    const { gl, renderer, frame, scene, bitmap } = fixture()
    const mask = document.createElement('canvas')
    mask.width = 1
    mask.height = 40
    const rect = { x: 10, y: 10, width: 20, height: 20 }
    renderer.setScene({
      ...scene,
      items: [
        {
          kind: 'opacity-group',
          rect,
          space: 'document',
          opacity: 1,
          items: [{ kind: 'sprite', rect, space: 'document', opacity: 1, bitmap }],
          mask: { bitmap: mask, rect, space: 'document' },
        },
      ],
    })
    expect(renderer.render(frame)).toBe(true)
    expect(gl.texImage2D.mock.calls.some((call) => call.includes(mask))).toBe(true)
    const index = gl.getUniformLocation.mock.calls.findIndex((call) => call[1] === 'u_hasGroupMask')
    const location = gl.getUniformLocation.mock.results[index]?.value
    const values = gl.uniform1i.mock.calls
      .filter((call) => call[0] === location)
      .map((call) => call[1])
    expect(values).toEqual([0, 1, 0])
    renderer.dispose()
  })
  it('passes proven output regions to both root and grouped backdrops', () => {
    const { renderer, frame, scene, bitmap } = fixture()
    const rect = { x: 0, y: 0, width: 100, height: 100 }
    const earlier = {
      kind: 'backdrop' as const,
      bitmap,
      sigma: 4,
      radius: 0,
      rect,
      space: 'viewport' as const,
      opacity: 1,
    }
    const grouped = { ...earlier, sigma: 6 }
    const pane = {
      kind: 'glass' as const,
      rect: { x: 40, y: 40, width: 10, height: 10 },
      space: 'viewport' as const,
      opacity: 1,
      radius: 0,
      displacement: [0, 0, 0] as const,
      blur: 0,
      saturation: 1,
      tint: [0, 0, 0, 0] as const,
      studio: { ...GLASS_STUDIO_DEFAULTS, refDistance: 0, blurRadius: 0, shadowFactor: 0 },
    }
    renderer.setScene({
      ...scene,
      samplingRegion: pane.rect,
      items: [
        earlier,
        { kind: 'opacity-group', items: [grouped], rect, space: 'viewport', opacity: 0.5 },
        pane,
      ],
    })
    expect(renderer.render(frame)).toBe(true)
    const passes = vi.mocked(createBackdropPass).mock.results
    const pass = passes[passes.length - 1]?.value
    expect(pass?.render).toHaveBeenCalledTimes(2)
    const earlierInput = vi.mocked(pass!.render).mock.calls[0]?.[0]
    const groupedInput = vi.mocked(pass!.render).mock.calls[1]?.[0]
    expect(earlierInput?.outputRegion).toBeDefined()
    expect(groupedInput?.outputRegion).toBeDefined()
    expect(earlierInput!.outputRegion!.width).toBeGreaterThan(groupedInput!.outputRegion!.width)
    expect(groupedInput?.foregroundOnly).toBe(true)
    renderer.dispose()
  })

  it('samples a grouped backdrop from the main framebuffer into a distinct group target', () => {
    const { gl, renderer, frame, scene, bitmap } = fixture()
    const backdrop = {
      kind: 'backdrop' as const,
      bitmap,
      sigma: 4,
      radius: 0,
      rect: { x: 10, y: 10, width: 40, height: 20 },
      space: 'viewport' as const,
      opacity: 1,
    }
    renderer.setScene({
      ...scene,
      items: [
        {
          kind: 'opacity-group',
          items: [backdrop],
          rect: backdrop.rect,
          space: 'viewport',
          opacity: 0.5,
        },
      ],
    })
    expect(renderer.render(frame)).toBe(true)
    const framebuffers = gl.createFramebuffer.mock.results.map((result) => result.value)
    const passes = vi.mocked(createBackdropPass).mock.results
    const pass = passes[passes.length - 1]?.value
    expect(pass?.render).toHaveBeenCalledWith(
      expect.objectContaining({
        framebuffer: framebuffers[1],
        sourceFramebuffer: framebuffers[0],
        foregroundOnly: true,
        sigma: 4,
        opacity: 1,
      })
    )
    renderer.dispose()
    expect(pass?.dispose).toHaveBeenCalledOnce()
  })

  it('fails closed for a grouped backdrop over a transparent scene', () => {
    const { renderer, frame, scene, bitmap } = fixture()
    const backdrop = {
      kind: 'backdrop' as const,
      bitmap,
      sigma: 4,
      radius: 0,
      rect: { x: 10, y: 10, width: 40, height: 20 },
      space: 'viewport' as const,
      opacity: 1,
    }
    renderer.setScene({
      ...scene,
      background: [0, 0, 0, 0],
      items: [
        {
          kind: 'opacity-group',
          items: [backdrop],
          rect: backdrop.rect,
          space: 'viewport',
          opacity: 0.5,
        },
      ],
    })
    expect(renderer.render(frame)).toBe(false)
    renderer.dispose()
  })
  it('reads the existing main framebuffer and paints the fading lens into a separate group framebuffer', () => {
    const { gl, renderer, frame, scene } = fixture()
    const pane = {
      kind: 'glass' as const,
      rect: { x: 10, y: 10, width: 40, height: 20 },
      space: 'viewport' as const,
      opacity: 1,
      radius: 10,
      displacement: [0, 0, 0] as const,
      blur: 0,
      saturation: 1,
      tint: [0, 0, 0, 0] as const,
      studio: { ...GLASS_STUDIO_DEFAULTS, shapeRoundness: 2, shadowFactor: 0 },
    }
    renderer.setScene({
      ...scene,
      items: [
        { kind: 'opacity-group', items: [pane], rect: pane.rect, space: pane.space, opacity: 0.5 },
      ],
    })
    expect(renderer.render(frame)).toBe(true)
    const framebuffers = gl.createFramebuffer.mock.results.map((result) => result.value)
    const passes = vi.mocked(createStudioPass).mock.results
    const studio = passes[passes.length - 1]?.value
    expect(studio?.render).toHaveBeenCalledWith(
      expect.objectContaining({ opacity: 1 }),
      pane.rect,
      frame,
      framebuffers[1],
      100,
      100,
      framebuffers[0]
    )
    renderer.dispose()
    expect(studio?.dispose).toHaveBeenCalledOnce()
  })

  it('fails closed for grouped optical rendering on a transparent base', () => {
    const { renderer, frame, scene } = fixture()
    const pane = {
      kind: 'glass' as const,
      rect: { x: 10, y: 10, width: 40, height: 20 },
      space: 'viewport' as const,
      opacity: 1,
      radius: 10,
      displacement: [0, 0, 0] as const,
      blur: 0,
      saturation: 1,
      tint: [0, 0, 0, 0] as const,
      studio: { ...GLASS_STUDIO_DEFAULTS, shadowFactor: 0 },
    }
    renderer.setScene({
      ...scene,
      background: [0, 0, 0, 0],
      items: [
        { kind: 'opacity-group', items: [pane], rect: pane.rect, space: pane.space, opacity: 0.5 },
      ],
    })
    expect(renderer.render(frame)).toBe(false)
    renderer.dispose()
  })

  it('reuses a single transparent framebuffer, refreshes canvas media, and disposes resources', () => {
    const { gl, renderer, frame, scene, source, bitmap } = fixture()
    renderer.setScene(scene)
    expect(gl.createFramebuffer).toHaveBeenCalledTimes(1)
    expect(renderer.render(frame)).toBe(true)
    expect(gl.createFramebuffer).toHaveBeenCalledTimes(2)
    expect(gl.texImage2D.mock.calls.some((call) => call.includes(source))).toBe(true)
    expect(gl.texImage2D.mock.calls.some((call) => call.includes(bitmap))).toBe(true)
    expect(gl.clearColor).toHaveBeenCalledWith(0, 0, 0, 0)
    expect(renderer.render(frame)).toBe(true)
    expect(gl.createFramebuffer).toHaveBeenCalledTimes(2)
    expect(gl.texSubImage2D.mock.calls.some((call) => call.includes(source))).toBe(true)
    renderer.dispose()
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(2)
    expect(gl.deleteTexture.mock.calls.length).toBe(gl.createTexture.mock.calls.length)
  })

  it('reuses source texture across repeated groups without uploading the canvas twice per frame', () => {
    const { gl, renderer, frame, scene, source } = fixture()
    renderer.setScene({ ...scene, items: [...scene.items, ...scene.items] })
    expect(renderer.render(frame)).toBe(true)
    expect(gl.createFramebuffer).toHaveBeenCalledTimes(2)
    expect(gl.texImage2D.mock.calls.filter((call) => call.includes(source))).toHaveLength(1)
    renderer.dispose()
  })

  it('refreshes a paused video even if its frame callback has not run and removes listeners', () => {
    const { gl, renderer, frame, scene } = fixture()
    const video = document.createElement('video')
    const state = { paused: false, time: 0 }
    Object.defineProperties(video, {
      videoWidth: { value: 20 },
      videoHeight: { value: 20 },
      readyState: { value: 4 },
      paused: { get: () => state.paused },
      currentTime: { get: () => state.time },
      requestVideoFrameCallback: { value: vi.fn(() => 1) },
      cancelVideoFrameCallback: { value: vi.fn() },
    })
    const remove = vi.spyOn(video, 'removeEventListener')
    const child: SceneOpacityPaint = {
      kind: 'media',
      source: video,
      fit: 'fill',
      position: [0, 0],
      radius: 0,
      rect: { x: 10, y: 10, width: 20, height: 20 },
      space: 'document',
      opacity: 1,
    }
    renderer.setScene({
      ...scene,
      items: [
        {
          kind: 'opacity-group',
          items: [child],
          rect: child.rect,
          space: 'document',
          opacity: 0.5,
        },
      ],
    })
    expect(renderer.render(frame)).toBe(true)
    state.time = 0.5
    state.paused = true
    expect(renderer.render(frame)).toBe(true)
    expect(gl.texImage2D.mock.calls.filter((call) => call.includes(video))).toHaveLength(2)
    renderer.dispose()
    expect(remove).toHaveBeenCalledWith('pause', expect.any(Function))
  })
})
