import { describe, expect, it, vi } from 'vitest'
import { createStudioPass } from '../scene/studio-pass'
import { GLASS_STUDIO_DEFAULTS } from '../studio-props'
import type { SceneFrame, SceneItem, SceneRect } from '../scene/types'

type Resource = { id: number }
type Failure = 'surface' | 'blur' | 'link' | 'surface-uniform' | 'blur-uniform'

function fixture(options: { uniforms?: number; maxTextureSize?: number; failure?: Failure } = {}) {
  let nextId = 0
  let injected = false
  const make = (): Resource => ({ id: ++nextId })
  const shaderSources = new WeakMap<Resource, string>()
  const optimizedPrograms = new WeakSet<Resource>()
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    TEXTURE0: 7,
    TEXTURE1: 8,
    TEXTURE_2D: 9,
    TEXTURE_WRAP_S: 10,
    TEXTURE_WRAP_T: 11,
    CLAMP_TO_EDGE: 12,
    TEXTURE_MIN_FILTER: 13,
    TEXTURE_MAG_FILTER: 14,
    LINEAR: 15,
    NEAREST: 16,
    RGBA: 17,
    UNSIGNED_BYTE: 18,
    FRAMEBUFFER: 19,
    COLOR_ATTACHMENT0: 20,
    FRAMEBUFFER_COMPLETE: 21,
    FLOAT: 22,
    BLEND: 23,
    SCISSOR_TEST: 24,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 25,
    UNPACK_FLIP_Y_WEBGL: 26,
    UNPACK_COLORSPACE_CONVERSION_WEBGL: 27,
    BROWSER_DEFAULT_WEBGL: 28,
    NONE: 0,
    TRIANGLE_STRIP: 29,
    NO_ERROR: 0,
    MAX_FRAGMENT_UNIFORM_VECTORS: 30,
    MAX_TEXTURE_SIZE: 31,
    ONE: 32,
    ONE_MINUS_SRC_ALPHA: 33,
    FUNC_ADD: 34,
    FUNC_REVERSE_SUBTRACT: 35,
    ZERO: 36,
    createProgram: vi.fn(make),
    createShader: vi.fn(make),
    createBuffer: vi.fn(make),
    createTexture: vi.fn(make),
    createFramebuffer: vi.fn(make),
    shaderSource: vi.fn((shader: Resource, source: string) => shaderSources.set(shader, source)),
    getShaderParameter: vi.fn((shader: Resource) => {
      const source = shaderSources.get(shader) ?? ''
      const capacity = source.startsWith('#define STUDIO_CAPACITY')
      const isBlur = source.includes('uniform vec3 u_direction')
      if (!injected && capacity && options.failure === (isBlur ? 'blur' : 'surface')) {
        injected = true
        return false
      }
      return true
    }),
    attachShader: vi.fn((program: Resource, shader: Resource) => {
      if (shaderSources.get(shader)?.startsWith('#define STUDIO_CAPACITY'))
        optimizedPrograms.add(program)
    }),
    getProgramParameter: vi.fn((program: Resource) => {
      if (!injected && options.failure === 'link' && optimizedPrograms.has(program)) {
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
        (options.failure === 'surface-uniform' && name === 'u_shape') ||
        (options.failure === 'blur-uniform' && name === 'u_direction')
      if (!injected && fails && optimizedPrograms.has(program)) {
        injected = true
        return null
      }
      return make()
    }),
    getParameter: vi.fn((name: number) => {
      if (name === 30) return options.uniforms ?? 1024
      if (name === 31) return options.maxTextureSize ?? 4096
      return 0
    }),
    getExtension: vi.fn(() => null),
    getError: vi.fn(() => 0),
    isContextLost: vi.fn(() => false),
    checkFramebufferStatus: vi.fn(() => 21),
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
    uniform1f: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    uniform2fv: vi.fn(),
    uniform3f: vi.fn(),
    uniform4f: vi.fn(),
    uniform4fv: vi.fn(),
    drawArrays: vi.fn(),
    blendEquation: vi.fn(),
    blendEquationSeparate: vi.fn(),
    blendFunc: vi.fn(),
    blendFuncSeparate: vi.fn(),
  }
  const pass = createStudioPass(gl as unknown as WebGLRenderingContext, make() as WebGLTexture)
  const rect: SceneRect = { x: 10, y: 20, width: 300, height: 60 }
  const frame: SceneFrame = { width: 390, height: 745, pixelRatio: 1, scrollX: 0, scrollY: 0 }
  const studio = { ...GLASS_STUDIO_DEFAULTS, blurRadius: 3, shadowFactor: 0 }
  const item = {
    kind: 'glass',
    rect,
    space: 'viewport',
    opacity: 1,
    radius: 20,
    displacement: [0, 0, 0],
    blur: 0,
    saturation: 1,
    tint: [0, 0, 0, 0],
    studio,
  } satisfies Extract<SceneItem, { kind: 'glass' }> & { studio: typeof studio }
  const framebuffer = make() as WebGLFramebuffer
  const render = (next: SceneFrame = frame) =>
    pass.render(
      item,
      rect,
      next,
      framebuffer,
      Math.round(next.width * next.pixelRatio),
      Math.round(next.height * next.pixelRatio)
    )
  const storageHeights = () =>
    gl.texImage2D.mock.calls
      .filter((args) => args.length === 9 && args[8] === null)
      .map((args) => args[4])
  return { gl, pass, frame, render, storageHeights, wasInjected: () => injected }
}

describe('Studio blur target capacity', () => {
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

  it('uses exact-size storage at fractional DPR and on low-uniform devices', () => {
    const fractional = fixture()
    expect(fractional.render({ ...fractional.frame, pixelRatio: 1.5 })).toBe(true)
    expect(fractional.render({ ...fractional.frame, height: 763, pixelRatio: 1.5 })).toBe(true)
    expect(fractional.storageHeights()).toEqual([1118, 1118, 1145, 1145])
    fractional.pass.dispose()

    const limited = fixture({ uniforms: 16 })
    expect(limited.render()).toBe(true)
    expect(limited.render({ ...limited.frame, height: 763 })).toBe(true)
    expect(limited.storageHeights()).toEqual([745, 745, 763, 763])
    expect(
      limited.gl.shaderSource.mock.calls.some(([, source]) =>
        source.startsWith('#define STUDIO_CAPACITY')
      )
    ).toBe(false)
    limited.pass.dispose()
  })

  it('respects maximum texture size and the pixel budget', () => {
    const limited = fixture({ maxTextureSize: 850 })
    expect(limited.render()).toBe(true)
    expect(limited.storageHeights()).toEqual([745, 745])
    limited.pass.dispose()

    const large = fixture()
    expect(large.render({ ...large.frame, width: 3000 })).toBe(true)
    expect(large.storageHeights()).toEqual([745, 745])
    large.pass.dispose()
  })

  it.each(['surface', 'blur', 'link', 'surface-uniform', 'blur-uniform'] as const)(
    'uses the original shader and exact-size storage when optimized %s setup fails',
    (failure) => {
      const { gl, pass, frame, render, storageHeights, wasInjected } = fixture({ failure })
      expect(wasInjected()).toBe(true)
      expect(render()).toBe(true)
      expect(render({ ...frame, height: 763 })).toBe(true)
      expect(storageHeights()).toEqual([745, 745, 763, 763])
      expect(gl.deleteProgram).toHaveBeenCalled()
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
        gl.checkFramebufferStatus.mockReturnValueOnce(21).mockReturnValueOnce(0).mockReturnValue(21)
      }
      expect(render()).toBe(true)
      expect(render({ ...frame, height: 763 })).toBe(true)
      expect(storageHeights()).toEqual([896, 896, 745, 745, 763, 763])
      pass.dispose()
    }
  )

  it('retries exact storage if the padded allocation reports OUT_OF_MEMORY', () => {
    const { gl, pass, frame, render, storageHeights } = fixture()
    gl.getError.mockReturnValueOnce(0).mockReturnValueOnce(1285).mockReturnValue(0)
    expect(render()).toBe(true)
    expect(render({ ...frame, height: 763 })).toBe(true)
    expect(storageHeights()).toEqual([896, 896, 745, 745, 763, 763])
    pass.dispose()
  })

  it('fails closed on a preexisting error without retrying as a reserve failure', () => {
    const { gl, pass, render, storageHeights } = fixture()
    gl.getError.mockReturnValueOnce(1282)
    expect(() => render()).toThrow('Cannot allocate Studio blur storage')
    expect(storageHeights()).toEqual([])
    pass.dispose()
  })

  it('fails closed on context loss rather than accepting a failed allocation', () => {
    const { gl, pass, render } = fixture()
    gl.isContextLost.mockReturnValue(true)
    expect(render()).toBe(false)
    expect(gl.texImage2D).not.toHaveBeenCalled()
    pass.dispose()
  })

  it('fails closed if the error queue cannot be cleared after a reserve failure', () => {
    const { gl, pass, render, storageHeights } = fixture()
    gl.getError.mockReturnValueOnce(0).mockReturnValue(1285)
    expect(() => render()).toThrow('Cannot allocate Studio blur storage')
    expect(storageHeights()).toEqual([896, 896])
    pass.dispose()
  })
})
