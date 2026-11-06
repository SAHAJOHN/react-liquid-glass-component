import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneRenderer } from '../scene/renderer'
import type { GlassScene, SceneItem } from '../scene/types'

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
  const sprite: SceneItem = {
    kind: 'sprite',
    bitmap,
    rect: { x: 10, y: 10, width: 20, height: 20 },
    space: 'document',
    opacity: 1,
  }
  const media: SceneItem = {
    kind: 'media',
    source,
    fit: 'fill',
    position: [0, 0],
    radius: 0,
    rect: { x: 10, y: 10, width: 20, height: 20 },
    space: 'document',
    opacity: 1,
  }
  const scene: GlassScene = { background: [1, 1, 1, 1], items: [sprite, media] }
  const renderer = createSceneRenderer(output)
  if (!renderer) throw new Error('Scene renderer could not initialize')
  let now = 100
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  return {
    gl,
    renderer,
    frame,
    scene,
    source,
    bitmap,
    sprite,
    media,
    advance: (milliseconds: number) => {
      now += milliseconds
    },
  }
}

afterEach(() => vi.restoreAllMocks())

describe('scene upload validation', () => {
  it('validates new immutable bitmaps once and reuses them across scene changes', () => {
    const { gl, renderer, scene, sprite, bitmap } = fixture()
    renderer.setScene({ ...scene, items: [sprite] })
    expect(gl.getError).toHaveBeenCalledTimes(1)
    gl.getError.mockClear()
    gl.texImage2D.mockClear()
    renderer.setScene({ ...scene, items: [{ ...sprite, rect: { ...sprite.rect, y: 12 } }] })
    expect(gl.texImage2D).not.toHaveBeenCalled()
    expect(gl.getError).not.toHaveBeenCalled()
    const other = document.createElement('canvas')
    other.width = other.height = 20
    renderer.setScene({ ...scene, items: [sprite, { ...sprite, kind: 'sprite', bitmap: other }] })
    expect(gl.getError).toHaveBeenCalledTimes(1)
    expect(gl.texImage2D.mock.calls.some((call) => call.includes(bitmap))).toBe(false)
    renderer.dispose()
    expect(gl.deleteTexture.mock.calls.length).toBe(gl.createTexture.mock.calls.length)
  })

  it('fails immediately when a new bitmap upload reports a driver error', () => {
    const { gl, renderer, scene, frame, sprite } = fixture()
    gl.getError.mockReturnValue(1282)
    expect(() => renderer.setScene({ ...scene, items: [sprite] })).toThrow(
      'Cannot upload scene bitmaps'
    )
    expect(renderer.render(frame)).toBe(false)
    renderer.dispose()
  })

  it('continues uploading stable canvas frames without synchronous error checks', () => {
    const { gl, renderer, scene, frame, source, advance } = fixture()
    renderer.setScene(scene)
    expect(renderer.render(frame)).toBe(true)
    gl.getError.mockClear()
    gl.texSubImage2D.mockClear()
    for (let index = 0; index < 3; index += 1) {
      advance(16)
      renderer.setScene(scene)
      expect(renderer.render(frame)).toBe(true)
    }
    expect(gl.texSubImage2D.mock.calls.filter((call) => call.includes(source))).toHaveLength(3)
    expect(gl.getError).not.toHaveBeenCalled()
    advance(2000)
    expect(renderer.render(frame)).toBe(true)
    expect(gl.getError).toHaveBeenCalledTimes(1)
    renderer.dispose()
  })

  it('fails on a periodic driver error instead of silently keeping the previous texture', () => {
    const { gl, renderer, scene, frame, advance } = fixture()
    renderer.setScene(scene)
    expect(renderer.render(frame)).toBe(true)
    advance(2000)
    gl.getError.mockReturnValue(1282)
    expect(renderer.render(frame)).toBe(false)
    renderer.dispose()
  })

  it('validates first media allocation immediately', () => {
    const { gl, renderer, scene, frame, source } = fixture()
    renderer.setScene(scene)
    gl.texImage2D.mockImplementation((...args: unknown[]) => {
      if (args.includes(source)) gl.getError.mockReturnValue(1282)
    })
    expect(renderer.render(frame)).toBe(false)
    renderer.dispose()
  })

  it('validates resized media immediately', () => {
    const { gl, renderer, scene, frame, source } = fixture()
    renderer.setScene(scene)
    expect(renderer.render(frame)).toBe(true)
    source.width += 1
    gl.getError.mockReturnValue(1282)
    expect(renderer.render(frame)).toBe(false)
    renderer.dispose()
  })

  it('fails immediately when a stable canvas becomes tainted', () => {
    const { gl, renderer, scene, frame } = fixture()
    renderer.setScene(scene)
    expect(renderer.render(frame)).toBe(true)
    gl.getError.mockClear()
    gl.texSubImage2D.mockImplementation(() => {
      throw new DOMException('Tainted source', 'SecurityError')
    })
    expect(renderer.render(frame)).toBe(false)
    expect(gl.getError).not.toHaveBeenCalled()
    renderer.dispose()
    expect(gl.deleteTexture.mock.calls.length).toBe(gl.createTexture.mock.calls.length)
  })

  it('validates video source changes even when dimensions are unchanged', () => {
    const { gl, renderer, scene, media, frame } = fixture()
    const video = document.createElement('video')
    let url = 'https://example.test/first.mp4'
    Object.defineProperties(video, {
      videoWidth: { value: 20 },
      videoHeight: { value: 20 },
      readyState: { value: 4 },
      paused: { value: true },
      currentTime: { value: 0 },
      currentSrc: { get: () => url },
    })
    renderer.setScene({
      ...scene,
      items: [{ ...media, kind: 'media', source: video, fit: 'fill', position: [0, 0], radius: 0 }],
    })
    expect(renderer.render(frame)).toBe(true)
    gl.getError.mockClear()
    url = 'https://example.test/second.mp4'
    gl.getError.mockReturnValue(1282)
    expect(renderer.render(frame)).toBe(false)
    expect(gl.getError).toHaveBeenCalledTimes(1)
    renderer.dispose()
  })

  it('polls an unchecked final video upload while paused without uploading it again', () => {
    const { gl, renderer, scene, media, frame, advance } = fixture()
    const video = document.createElement('video')
    let time = 0
    Object.defineProperties(video, {
      videoWidth: { value: 20 },
      videoHeight: { value: 20 },
      readyState: { value: 4 },
      paused: { value: true },
      currentTime: { get: () => time },
      currentSrc: { value: 'https://example.test/video.mp4' },
    })
    renderer.setScene({
      ...scene,
      items: [{ ...media, kind: 'media', source: video, fit: 'fill', position: [0, 0], radius: 0 }],
    })
    expect(renderer.render(frame)).toBe(true)
    gl.getError.mockClear()
    gl.texImage2D.mockImplementation((...args: unknown[]) => {
      if (args.includes(video)) gl.getError.mockReturnValue(1282)
    })
    time = 1
    advance(16)
    expect(renderer.render(frame)).toBe(true)
    expect(gl.getError).not.toHaveBeenCalled()
    gl.texImage2D.mockClear()
    advance(2000)
    expect(renderer.render({ ...frame, scrollY: 1 })).toBe(false)
    expect(gl.getError).toHaveBeenCalledTimes(1)
    expect(gl.texImage2D).not.toHaveBeenCalled()
    renderer.dispose()
  })

  it('still refuses context loss and oversized media before upload', () => {
    const { gl, renderer, scene, frame, source } = fixture()
    renderer.setScene(scene)
    expect(renderer.render(frame)).toBe(true)
    gl.texSubImage2D.mockClear()
    source.width = 5000
    expect(renderer.render(frame)).toBe(false)
    expect(gl.texSubImage2D).not.toHaveBeenCalled()
    gl.isContextLost.mockReturnValue(true)
    expect(() => renderer.setScene(scene)).toThrow('Scene renderer is unavailable')
    renderer.dispose()
  })
})
