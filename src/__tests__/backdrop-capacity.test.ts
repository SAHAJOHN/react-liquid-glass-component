import { describe, expect, it, vi } from 'vitest'
import { createBackdropPass, type BackdropPassInput } from '../scene/backdrop-pass'
import type { SceneFrame } from '../scene/types'

type Resource = { id: number }
type ShaderFailure = 'blur' | 'composite' | 'link' | 'blur-uniform' | 'composite-uniform'

function fixture(
  options: { uniforms?: number; maxTextureSize?: number; failure?: ShaderFailure } = {}
) {
  let id = 0
  let injected = false
  const make = (): Resource => ({ id: ++id })
  const shaderSources = new WeakMap<Resource, string>()
  const capacityPrograms = new WeakSet<Resource>()
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    TEXTURE0: 7,
    TEXTURE1: 8,
    TEXTURE2: 9,
    TEXTURE_2D: 10,
    TEXTURE_WRAP_S: 11,
    TEXTURE_WRAP_T: 12,
    CLAMP_TO_EDGE: 13,
    TEXTURE_MIN_FILTER: 14,
    TEXTURE_MAG_FILTER: 15,
    LINEAR: 16,
    NEAREST: 17,
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
    UNPACK_COLORSPACE_CONVERSION_WEBGL: 28,
    BROWSER_DEFAULT_WEBGL: 29,
    NONE: 0,
    TRIANGLE_STRIP: 30,
    NO_ERROR: 0,
    MAX_FRAGMENT_UNIFORM_VECTORS: 31,
    createProgram: vi.fn(make),
    createShader: vi.fn(make),
    createBuffer: vi.fn(make),
    createTexture: vi.fn(make),
    createFramebuffer: vi.fn(make),
    shaderSource: vi.fn((shader: Resource, source: string) => shaderSources.set(shader, source)),
    getShaderParameter: vi.fn((shader: Resource) => {
      const source = shaderSources.get(shader) ?? ''
      const kind = source.includes('uniform vec4 u_sampling;')
        ? 'blur'
        : source.includes('uniform vec2 u_ratioScale;')
          ? 'composite'
          : undefined
      if (!injected && kind && options.failure === kind) {
        injected = true
        return false
      }
      return true
    }),
    attachShader: vi.fn((program: Resource, shader: Resource) => {
      const source = shaderSources.get(shader) ?? ''
      if (
        source.includes('uniform vec4 u_sampling;') ||
        source.includes('uniform vec2 u_ratioScale;')
      )
        capacityPrograms.add(program)
    }),
    getProgramParameter: vi.fn((program: Resource) => {
      if (!injected && options.failure === 'link' && capacityPrograms.has(program)) {
        injected = true
        return false
      }
      return true
    }),
    getShaderInfoLog: vi.fn(() => 'Injected shader failure'),
    getProgramInfoLog: vi.fn(() => 'Injected link failure'),
    getAttribLocation: vi.fn(() => 0),
    getUniformLocation: vi.fn((program: Resource, name: string) => {
      const fails =
        (options.failure === 'blur-uniform' && name === 'u_sampling') ||
        (options.failure === 'composite-uniform' && name === 'u_ratioScale')
      if (!injected && fails && capacityPrograms.has(program)) {
        injected = true
        return null
      }
      return make()
    }),
    getParameter: vi.fn((name: number) => (name === 31 ? (options.uniforms ?? 1024) : 0)),
    getError: vi.fn(() => 0),
    isContextLost: vi.fn(() => false),
    checkFramebufferStatus: vi.fn(() => 22),
    compileShader: vi.fn(),
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
    texImage2D: vi.fn((...args: unknown[]) => void args),
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    useProgram: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    viewport: vi.fn(),
    disable: vi.fn(),
    enable: vi.fn(),
    scissor: vi.fn(),
    copyTexSubImage2D: vi.fn(),
    pixelStorei: vi.fn(),
    uniform2f: vi.fn(),
    uniform4f: vi.fn(),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    uniform4fv: vi.fn(),
    uniform2fv: vi.fn(),
    drawArrays: vi.fn(),
  }
  const pass = createBackdropPass(gl as unknown as WebGLRenderingContext, make() as WebGLTexture)
  const frame: SceneFrame = { width: 390, height: 745, pixelRatio: 1, scrollX: 0, scrollY: 0 }
  const input: BackdropPassInput = {
    rect: { x: 10, y: 10, width: 80, height: 60 },
    frame,
    framebuffer: make() as WebGLFramebuffer,
    targetWidth: frame.width,
    targetHeight: frame.height,
    maxTextureSize: options.maxTextureSize ?? 4096,
    sigma: 3,
    mask: make() as WebGLTexture,
    clips: [],
    radius: 0,
    opacity: 1,
  }
  const render = (next: SceneFrame = frame) =>
    pass.render({
      ...input,
      frame: next,
      targetWidth: Math.round(next.width * next.pixelRatio),
      targetHeight: Math.round(next.height * next.pixelRatio),
    })
  const storageHeights = () =>
    gl.texImage2D.mock.calls
      .filter((args) => args.length === 9 && args[8] === null)
      .map((args) => args[4])
  return { gl, pass, frame, render, storageHeights, wasInjected: () => injected }
}

describe('backdrop blur target capacity', () => {
  it('reuses bounded DPR 1 storage across toolbar height changes', () => {
    const { gl, pass, frame, render, storageHeights } = fixture()
    for (const height of [745, 763, 781, 799, 817, 835, 853, 745])
      expect(render({ ...frame, height })).toBe(true)
    expect(storageHeights()).toEqual([896, 896])
    expect(gl.checkFramebufferStatus).toHaveBeenCalledTimes(2)
    pass.dispose()
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(2)
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(1)
    expect(render()).toBe(false)
  })

  it('uses exact storage for fractional DPR, fractional viewport, and low uniform limits', () => {
    const fractional = fixture()
    expect(fractional.render({ ...fractional.frame, pixelRatio: 1.5 })).toBe(true)
    expect(fractional.render({ ...fractional.frame, height: 763, pixelRatio: 1.5 })).toBe(true)
    expect(fractional.storageHeights()).toEqual([1118, 1118, 1145, 1145])
    fractional.pass.dispose()

    const fractionalViewport = fixture()
    expect(fractionalViewport.render({ ...fractionalViewport.frame, height: 745.5 })).toBe(true)
    expect(fractionalViewport.storageHeights()).toEqual([746, 746])
    fractionalViewport.pass.dispose()

    const limited = fixture({ uniforms: 16 })
    expect(limited.render()).toBe(true)
    expect(limited.render({ ...limited.frame, height: 763 })).toBe(true)
    expect(limited.storageHeights()).toEqual([745, 745, 763, 763])
    expect(
      limited.gl.shaderSource.mock.calls.some(([, source]) =>
        source.includes('uniform vec4 u_sampling;')
      )
    ).toBe(false)
    limited.pass.dispose()
  })

  it('respects the maximum texture size and pixel budget', () => {
    const limited = fixture({ maxTextureSize: 850 })
    expect(limited.render()).toBe(true)
    expect(limited.storageHeights()).toEqual([745, 745])
    limited.pass.dispose()

    const large = fixture()
    expect(large.render({ ...large.frame, width: 3000 })).toBe(true)
    expect(large.storageHeights()).toEqual([745, 745])
    large.pass.dispose()
  })

  it.each(['blur', 'composite', 'link', 'blur-uniform', 'composite-uniform'] as const)(
    'uses the original shaders and exact storage when optimized %s setup fails',
    (failure) => {
      const { gl, pass, frame, render, storageHeights, wasInjected } = fixture({ failure })
      expect(wasInjected()).toBe(true)
      expect(render()).toBe(true)
      expect(render({ ...frame, height: 763 })).toBe(true)
      expect(storageHeights()).toEqual([745, 745, 763, 763])
      pass.dispose()
      const deleted = gl.deleteProgram.mock.calls.map(([program]) => program)
      expect(deleted).toHaveLength(gl.createProgram.mock.calls.length)
      expect(new Set(deleted).size).toBe(gl.createProgram.mock.calls.length)
    }
  )

  it.each(['allocation', 'framebuffer'] as const)(
    'retries exact storage and disables reserve after a padded %s failure',
    (failure) => {
      const { gl, pass, frame, render, storageHeights } = fixture()
      let paddedUploads = 0
      if (failure === 'allocation') {
        gl.texImage2D.mockImplementation((...args: unknown[]) => {
          if (args[4] === 896 && args[8] === null && ++paddedUploads === 2)
            throw new Error('Injected allocation failure')
        })
      } else {
        gl.checkFramebufferStatus.mockReturnValueOnce(22).mockReturnValueOnce(0).mockReturnValue(22)
      }
      expect(render()).toBe(true)
      expect(render({ ...frame, height: 763 })).toBe(true)
      expect(storageHeights()).toEqual([896, 896, 745, 745, 763, 763])
      pass.dispose()
    }
  )

  it('retries exact storage if padded allocation reports OUT_OF_MEMORY', () => {
    const { gl, pass, frame, render, storageHeights } = fixture()
    gl.getError.mockReturnValueOnce(0).mockReturnValueOnce(1285).mockReturnValue(0)
    expect(render()).toBe(true)
    expect(render({ ...frame, height: 763 })).toBe(true)
    expect(storageHeights()).toEqual([896, 896, 745, 745, 763, 763])
    pass.dispose()
  })

  it('fails closed on a preexisting error before allocating padded storage', () => {
    const { gl, pass, render, storageHeights } = fixture()
    gl.getError.mockReturnValueOnce(1282)
    expect(() => render()).toThrow('Backdrop had a prior WebGL error')
    expect(storageHeights()).toEqual([])
    pass.dispose()
  })

  it('fails closed if the GL error queue cannot be cleared', () => {
    const { gl, pass, render, storageHeights } = fixture()
    gl.getError.mockReturnValueOnce(0).mockReturnValue(1285)
    expect(() => render()).toThrow('Backdrop reserve allocation failed')
    expect(storageHeights()).toEqual([896, 896])
    pass.dispose()
  })

  it('rejects context loss and disposes retained resources', () => {
    const { gl, pass, render } = fixture()
    gl.isContextLost.mockReturnValue(true)
    expect(render()).toBe(false)
    expect(gl.texImage2D).not.toHaveBeenCalled()
    pass.dispose()
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(2)
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(1)
  })
})
