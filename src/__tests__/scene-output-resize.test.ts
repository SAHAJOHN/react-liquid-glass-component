import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneRenderer } from '../scene/renderer'
import type { GlassScene, SceneFrame } from '../scene/types'

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
  let width = output.width
  let height = output.height
  const widthWrites: number[] = []
  const heightWrites: number[] = []
  Object.defineProperties(output, {
    width: {
      configurable: true,
      get: () => width,
      set: (value: number) => {
        width = value
        widthWrites.push(value)
      },
    },
    height: {
      configurable: true,
      get: () => height,
      set: (value: number) => {
        height = value
        heightWrites.push(value)
      },
    },
  })
  const renderer = createSceneRenderer(output)
  if (!renderer) throw new Error('Scene renderer could not initialize')
  const scene: GlassScene = { background: [1, 1, 1, 1], items: [] }
  renderer.setScene(scene)
  const frame = (frameWidth: number, frameHeight: number): SceneFrame => ({
    width: frameWidth,
    height: frameHeight,
    scrollX: 0,
    scrollY: 0,
    pixelRatio: 1,
  })
  return { gl, renderer, output, frame, widthWrites, heightWrites }
}

afterEach(() => vi.restoreAllMocks())

describe('scene output resize', () => {
  it('writes only dimensions that actually change', () => {
    const { renderer, frame, widthWrites, heightWrites } = fixture()

    expect(renderer.render(frame(100, 100))).toBe(true)
    expect(widthWrites).toEqual([100])
    expect(heightWrites).toEqual([100])

    expect(renderer.render(frame(100, 120))).toBe(true)
    expect(widthWrites).toEqual([100])
    expect(heightWrites).toEqual([100, 120])

    expect(renderer.render(frame(130, 120))).toBe(true)
    expect(widthWrites).toEqual([100, 130])
    expect(heightWrites).toEqual([100, 120])

    expect(renderer.render(frame(140, 150))).toBe(true)
    expect(widthWrites).toEqual([100, 130, 140])
    expect(heightWrites).toEqual([100, 120, 150])

    expect(renderer.render(frame(140, 150))).toBe(true)
    expect(widthWrites).toEqual([100, 130, 140])
    expect(heightWrites).toEqual([100, 120, 150])
    renderer.dispose()
  })

  it('repairs an externally changed dimension without rewriting the other dimension', () => {
    const { renderer, output, frame, widthWrites, heightWrites } = fixture()
    expect(renderer.render(frame(100, 100))).toBe(true)

    output.height = 80
    heightWrites.length = 0
    expect(renderer.render(frame(100, 100))).toBe(true)
    expect(widthWrites).toEqual([100])
    expect(heightWrites).toEqual([100])
    renderer.dispose()
  })

  it('does not resize when the context is lost and does not repeat setters after failure', () => {
    const lost = fixture()
    lost.gl.isContextLost.mockReturnValue(true)
    expect(lost.renderer.render(lost.frame(100, 100))).toBe(false)
    expect(lost.widthWrites).toEqual([])
    expect(lost.heightWrites).toEqual([])
    lost.renderer.dispose()

    const failed = fixture()
    failed.gl.checkFramebufferStatus.mockReturnValue(0)
    expect(failed.renderer.render(failed.frame(100, 100))).toBe(false)
    expect(failed.widthWrites).toEqual([100])
    expect(failed.heightWrites).toEqual([100])
    expect(failed.renderer.render(failed.frame(100, 100))).toBe(false)
    expect(failed.widthWrites).toEqual([100])
    expect(failed.heightWrites).toEqual([100])
    failed.renderer.dispose()
  })
})
