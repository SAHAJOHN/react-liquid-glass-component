import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebGLRefraction } from '../webgl-refraction'

describe('shared WebGL refraction', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uploads a shared source once per frame and recreates it after context restoration', () => {
    const gl = {
      VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
      ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TEXTURE0: 8, TEXTURE_2D: 9,
      TEXTURE_WRAP_S: 10, TEXTURE_WRAP_T: 11, CLAMP_TO_EDGE: 12,
      TEXTURE_MIN_FILTER: 13, TEXTURE_MAG_FILTER: 14, LINEAR: 15,
      UNPACK_FLIP_Y_WEBGL: 16, MAX_TEXTURE_SIZE: 17, RGBA: 18,
      UNSIGNED_BYTE: 19, NO_ERROR: 0, TRIANGLE_STRIP: 20,
      createShader: vi.fn(() => ({})), shaderSource: vi.fn(), compileShader: vi.fn(),
      getShaderParameter: vi.fn(() => true), deleteShader: vi.fn(),
      createProgram: vi.fn(() => ({})), attachShader: vi.fn(), linkProgram: vi.fn(),
      getProgramParameter: vi.fn(() => true), deleteProgram: vi.fn(),
      createBuffer: vi.fn(() => ({})), createTexture: vi.fn(() => ({})),
      getAttribLocation: vi.fn(() => 0), getUniformLocation: vi.fn(() => ({})),
      deleteBuffer: vi.fn(), deleteTexture: vi.fn(), useProgram: vi.fn(),
      bindBuffer: vi.fn(), bufferData: vi.fn(), enableVertexAttribArray: vi.fn(),
      vertexAttribPointer: vi.fn(), activeTexture: vi.fn(), bindTexture: vi.fn(),
      texParameteri: vi.fn(), pixelStorei: vi.fn(), uniform1i: vi.fn(),
      getParameter: vi.fn(() => 4096), isContextLost: vi.fn(() => false),
      texImage2D: vi.fn(), getError: vi.fn(() => 0), viewport: vi.fn(),
      uniform2f: vi.fn(), uniform4f: vi.fn(), uniform1f: vi.fn(),
      uniform3f: vi.fn(), drawArrays: vi.fn(), getExtension: vi.fn(() => null),
    }
    const output = { clearRect: vi.fn(), drawImage: vi.fn() }
    const contextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      kind: string,
    ) {
      if (kind === 'webgl') {
        return gl as unknown as WebGLRenderingContext
      }
      return output as unknown as CanvasRenderingContext2D
    } as typeof HTMLCanvasElement.prototype.getContext)

    const firstCanvas = document.createElement('canvas')
    const secondCanvas = document.createElement('canvas')
    const first = createWebGLRefraction(firstCanvas)
    const second = createWebGLRefraction(secondCanvas)
    const offscreen = contextSpy.mock.instances[1]
    if (!(offscreen instanceof HTMLCanvasElement)) throw new Error('Missing shared canvas')
    const source = document.createElement('canvas')
    const unnumbered = {
      left: 0, top: 0, width: 120, height: 80, viewportWidth: 300, viewportHeight: 200,
      borderRadius: 20, distortionScale: -180, redOffset: 0, greenOffset: 10, blueOffset: 20,
    }
    const options = { ...unnumbered, frameId: 1 }
    expect(first?.render(source, options)).toBe(true)
    expect(second?.render(source, options)).toBe(true)
    expect(gl.texImage2D).toHaveBeenCalledTimes(1)
    expect(firstCanvas.width).toBe(120)
    expect(firstCanvas.height).toBe(80)

    expect(first?.render(source, { ...options, frameId: 2 })).toBe(true)
    expect(second?.render(source, { ...options, frameId: 2 })).toBe(true)
    expect(gl.texImage2D).toHaveBeenCalledTimes(2)
    expect(first?.render(document.createElement('canvas'), options)).toBe(true)
    expect(gl.texImage2D).toHaveBeenCalledTimes(3)

    expect(first?.render(source, unnumbered)).toBe(true)
    expect(second?.render(source, unnumbered)).toBe(true)
    expect(gl.texImage2D).toHaveBeenCalledTimes(5)

    offscreen.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    expect(first?.render(source, options)).toBe(false)
    offscreen.dispatchEvent(new Event('webglcontextrestored'))
    expect(first?.render(source, options)).toBe(true)
    expect(second?.render(source, options)).toBe(true)
    expect(gl.texImage2D).toHaveBeenCalledTimes(6)
    first?.dispose()
    second?.dispose()
  })
})
