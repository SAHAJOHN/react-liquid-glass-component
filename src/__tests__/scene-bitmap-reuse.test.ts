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
  const renderer = createSceneRenderer(document.createElement('canvas'))
  if (!renderer) throw new Error('Scene renderer could not initialize')
  const bitmap = (width = 20, height = 20) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  }
  const sprite = (canvas: HTMLCanvasElement): SceneItem => ({
    kind: 'sprite',
    bitmap: canvas,
    rect: { x: 0, y: 0, width: 20, height: 20 },
    space: 'document',
    opacity: 1,
  })
  const scene = (...items: SceneItem[]): GlassScene => ({ background: [1, 1, 1, 1], items })
  const uploads = (canvas: HTMLCanvasElement) =>
    gl.texImage2D.mock.calls.filter((call) => call.includes(canvas)).length
  return { gl, renderer, bitmap, sprite, scene, uploads }
}

afterEach(() => vi.restoreAllMocks())

describe('bounded immutable bitmap texture reuse', () => {
  it('reuses a bitmap that left and later re-enters the scene', () => {
    const { gl, renderer, bitmap, sprite, scene, uploads } = fixture()
    const a = bitmap()
    const b = bitmap()
    renderer.setScene(scene(sprite(a)))
    renderer.setScene(scene(sprite(b)))
    expect(gl.deleteTexture).not.toHaveBeenCalled()
    renderer.setScene(scene(sprite(a)))
    expect(uploads(a)).toBe(1)
    expect(uploads(b)).toBe(1)
    renderer.dispose()
    expect(gl.deleteTexture.mock.calls.length).toBe(gl.createTexture.mock.calls.length)
  })

  it('evicts the least recently used offscreen textures when the byte budget is exceeded', () => {
    const { gl, renderer, bitmap, sprite, scene, uploads } = fixture()
    const a = bitmap(1024, 1024)
    const b = bitmap(1024, 1024)
    const c = bitmap(1024, 1024)
    const d = bitmap(1024, 1024)
    renderer.setScene(scene(sprite(a)))
    renderer.setScene(scene(sprite(b)))
    renderer.setScene(scene(sprite(c)))
    renderer.setScene(scene(sprite(d)))
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1)
    renderer.setScene(scene(sprite(b)))
    expect(uploads(b)).toBe(1)
    renderer.setScene(scene(sprite(a)))
    expect(uploads(a)).toBe(2)
    renderer.dispose()
    expect(gl.deleteTexture.mock.calls.length).toBe(gl.createTexture.mock.calls.length)
  })

  it('bounds the number of offscreen textures while keeping current scene textures pinned', () => {
    const { gl, renderer, bitmap, sprite, scene, uploads } = fixture()
    const sources = Array.from({ length: 129 }, () => bitmap())
    const first = sources[0]!
    const last = sources[128]!
    renderer.setScene(scene(...sources.map(sprite)))
    expect(gl.deleteTexture).not.toHaveBeenCalled()
    renderer.setScene(scene())
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1)
    renderer.setScene(scene(sprite(last)))
    expect(uploads(last)).toBe(1)
    renderer.setScene(scene(sprite(first)))
    expect(uploads(first)).toBe(2)
    renderer.dispose()
    expect(gl.deleteTexture.mock.calls.length).toBe(gl.createTexture.mock.calls.length)
  })

  it('pins active textures above the retention budget and discards oversized inactive textures', () => {
    const { gl, renderer, bitmap, sprite, scene, uploads } = fixture()
    const source = bitmap(2048, 2048)
    renderer.setScene(scene(sprite(source)))
    renderer.setScene(scene(sprite(source)))
    expect(uploads(source)).toBe(1)
    expect(gl.deleteTexture).not.toHaveBeenCalled()
    renderer.setScene(scene())
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1)
    renderer.setScene(scene(sprite(source)))
    expect(uploads(source)).toBe(2)
    renderer.dispose()
    expect(gl.deleteTexture.mock.calls.length).toBe(gl.createTexture.mock.calls.length)
  })

  it('retains backdrop, group mask, and glass map snapshots', () => {
    const { gl, renderer, bitmap, scene, uploads } = fixture()
    const backdrop = bitmap()
    const mask = bitmap()
    const map = bitmap()
    const base = {
      rect: { x: 0, y: 0, width: 20, height: 20 },
      space: 'document' as const,
      opacity: 1,
    }
    const items: SceneItem[] = [
      { ...base, kind: 'backdrop', bitmap: backdrop, sigma: 2, radius: 0 },
      {
        ...base,
        kind: 'opacity-group',
        items: [],
        mask: { bitmap: mask, rect: base.rect, space: base.space },
      },
      {
        ...base,
        kind: 'glass',
        radius: 0,
        displacement: [0, 0, 0],
        blur: 0,
        saturation: 1,
        tint: [0, 0, 0, 0],
        map: { bitmap: map, xChannel: 0, yChannel: 1 },
      },
    ]
    renderer.setScene(scene(...items))
    renderer.setScene(scene())
    renderer.setScene(scene(...items))
    expect([uploads(backdrop), uploads(mask), uploads(map)]).toEqual([1, 1, 1])
    renderer.dispose()
    expect(gl.deleteTexture.mock.calls.length).toBe(gl.createTexture.mock.calls.length)
  })

  it('reuploads bitmaps that were resized, whether active or retained', () => {
    const { gl, renderer, bitmap, sprite, scene, uploads } = fixture()
    const source = bitmap()
    renderer.setScene(scene(sprite(source)))
    source.width += 1
    renderer.setScene(scene(sprite(source)))
    expect(uploads(source)).toBe(2)
    renderer.setScene(scene())
    source.height += 1
    renderer.setScene(scene(sprite(source)))
    expect(uploads(source)).toBe(3)
    renderer.dispose()
    expect(gl.deleteTexture.mock.calls.length).toBe(gl.createTexture.mock.calls.length)
  })

  it('does not retain a stale bitmap when the same canvas becomes live media', () => {
    const { gl, renderer, bitmap, sprite, scene, uploads } = fixture()
    const source = bitmap()
    const media: SceneItem = {
      kind: 'media',
      source,
      fit: 'fill',
      position: [0, 0],
      radius: 0,
      rect: { x: 0, y: 0, width: 20, height: 20 },
      space: 'document',
      opacity: 1,
    }
    renderer.setScene(scene(sprite(source)))
    renderer.setScene(scene())
    renderer.setScene(scene(media))
    renderer.setScene(scene(sprite(source)))
    expect(uploads(source)).toBe(2)
    renderer.dispose()
    expect(gl.deleteTexture.mock.calls.length).toBe(gl.createTexture.mock.calls.length)
  })

  it('does not retain or reuse a canvas that has been connected to the document', () => {
    const { gl, renderer, bitmap, sprite, scene, uploads } = fixture()
    const source = bitmap()
    renderer.setScene(scene(sprite(source)))
    document.body.append(source)
    renderer.setScene(scene(sprite(source)))
    expect(uploads(source)).toBe(2)
    renderer.setScene(scene())
    expect(gl.deleteTexture).toHaveBeenCalledTimes(2)
    source.remove()
    renderer.setScene(scene(sprite(source)))
    expect(uploads(source)).toBe(3)
    renderer.dispose()
    expect(gl.deleteTexture.mock.calls.length).toBe(gl.createTexture.mock.calls.length)
  })

  it('continues treating a previously connected canvas as mutable after detaching', () => {
    const { gl, renderer, bitmap, sprite, scene, uploads } = fixture()
    const source = bitmap()
    document.body.append(source)
    renderer.setScene(scene(sprite(source)))
    source.remove()
    renderer.setScene(scene())
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1)

    // Assigning the same width clears the canvas without changing dimensions.
    source.setAttribute('width', String(source.width))
    renderer.setScene(scene(sprite(source)))
    expect(uploads(source)).toBe(2)
    renderer.setScene(scene())
    expect(gl.deleteTexture).toHaveBeenCalledTimes(2)
    renderer.dispose()
    expect(gl.deleteTexture.mock.calls.length).toBe(gl.createTexture.mock.calls.length)
  })

  it('fails and frees allocated textures when a fresh upload hits a driver error', () => {
    const { gl, renderer, bitmap, sprite, scene } = fixture()
    const a = bitmap()
    renderer.setScene(scene(sprite(a)))
    renderer.setScene(scene())
    gl.getError.mockReturnValue(1282)
    expect(() => renderer.setScene(scene(sprite(bitmap())))).toThrow('Cannot upload scene bitmaps')
    renderer.dispose()
    expect(gl.deleteTexture.mock.calls.length).toBe(gl.createTexture.mock.calls.length)
    expect(new Set(gl.deleteTexture.mock.calls.map(([texture]) => texture)).size).toBe(
      gl.createTexture.mock.calls.length
    )
  })

  it('rejects a lost context and releases retained resources on disposal', () => {
    const { gl, renderer, bitmap, sprite, scene } = fixture()
    renderer.setScene(scene(sprite(bitmap())))
    renderer.setScene(scene())
    gl.isContextLost.mockReturnValue(true)
    expect(() => renderer.setScene(scene())).toThrow('Scene renderer is unavailable')
    renderer.dispose()
    expect(gl.deleteTexture.mock.calls.length).toBe(gl.createTexture.mock.calls.length)
  })
})
