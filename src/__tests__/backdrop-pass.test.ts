import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBackdropPass, type BackdropPassInput } from '../scene/backdrop-pass'

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
    createProgram: vi.fn(make),
    createShader: vi.fn(make),
    createBuffer: vi.fn(make),
    createTexture: vi.fn(make),
    createFramebuffer: vi.fn(make),
    getShaderParameter: vi.fn(() => true),
    getProgramParameter: vi.fn(() => true),
    getAttribLocation: vi.fn(() => 0),
    getUniformLocation: vi.fn(make),
    getParameter: vi.fn(() => 0),
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
  const context = gl as unknown as WebGLRenderingContext
  const pass = createBackdropPass(context, make() as WebGLTexture)
  const input: BackdropPassInput = {
    rect: { x: 10, y: 10, width: 80, height: 60 },
    frame: { width: 100, height: 100, scrollX: 0, scrollY: 0, pixelRatio: 1 },
    framebuffer: make() as WebGLFramebuffer,
    targetWidth: 200,
    targetHeight: 201,
    sigma: 10,
    mask: make() as WebGLTexture,
    clips: [],
    radius: 0,
    opacity: 1,
  }
  return { gl, pass, input }
}

afterEach(() => vi.restoreAllMocks())

describe('backdrop pass', () => {
  it('snapshots a separate scene before writing the filtered foreground into a group', () => {
    const { gl, pass, input } = fixture()
    const sourceFramebuffer = {} as WebGLFramebuffer
    expect(pass.render({ ...input, sourceFramebuffer, foregroundOnly: true })).toBe(true)
    const bindings = gl.bindFramebuffer.mock.calls
    const sourceIndex = bindings.findIndex((call) => call[1] === sourceFramebuffer)
    const targetIndex = bindings.map((call) => call[1]).lastIndexOf(input.framebuffer)
    const copyOrder = gl.copyTexSubImage2D.mock.invocationCallOrder[0]
    expect(sourceIndex).toBeGreaterThanOrEqual(0)
    expect(targetIndex).toBeGreaterThan(sourceIndex)
    expect(gl.bindFramebuffer.mock.invocationCallOrder[sourceIndex]).toBeLessThan(copyOrder!)
    expect(gl.bindFramebuffer.mock.invocationCallOrder[targetIndex]).toBeGreaterThan(copyOrder!)
    pass.dispose()
  })

  it('rejects a mismatched separate-source compositing mode', () => {
    const { gl, pass, input } = fixture()
    const sourceFramebuffer = {} as WebGLFramebuffer
    expect(pass.render({ ...input, sourceFramebuffer })).toBe(false)
    expect(pass.render({ ...input, foregroundOnly: true })).toBe(false)
    expect(
      pass.render({ ...input, sourceFramebuffer: input.framebuffer, foregroundOnly: true })
    ).toBe(false)
    expect(gl.copyTexSubImage2D).not.toHaveBeenCalled()
    pass.dispose()
  })
  it('snapshots each overlapping layer before its two blur draws and composite', () => {
    const { gl, pass, input } = fixture()
    expect(pass.render(input)).toBe(true)
    expect(pass.render(input)).toBe(true)
    expect(gl.copyTexSubImage2D).toHaveBeenCalledTimes(2)
    expect(gl.drawArrays).toHaveBeenCalledTimes(6)
    // Rounding makes the axes differ, so one texture is cached per axis.
    expect(
      gl.texImage2D.mock.calls.filter((args) => args[3] === 100 && args[4] === 1)
    ).toHaveLength(2)
    pass.dispose()
    expect(pass.render(input)).toBe(false)
  })

  it('keeps the full snapshot and mirror bounds while limiting the three draws', () => {
    const { gl, pass, input } = fixture()
    const region = { x: 25, y: 30, width: 10, height: 5 }
    expect(pass.render({ ...input, sigma: 2, outputRegion: region })).toBe(true)
    // The backing height is rounded independently of the width. Scissors use
    // bottom-left GL coordinates; the horizontal pass retains the vertical halo.
    expect(gl.scissor.mock.calls).toEqual([
      [20, 60, 160, 121],
      [46, 113, 28, 45],
      [48, 128, 24, 15],
      [48, 128, 24, 15],
    ])
    expect(gl.copyTexSubImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D, 0, 20, 60, 20, 60, 160, 121
    )
    expect(gl.uniform4f.mock.calls.some((call) =>
      call[1] === 20.5 / 200 && call[2] === 60.5 / 201 &&
      call[3] === 179.5 / 200 && call[4] === 180.5 / 201
    )).toBe(true)
    pass.dispose()
  })

  it('uses the full layer for invalid optional bounds and skips a proven disjoint region', () => {
    const { gl, pass, input } = fixture()
    expect(pass.render({ ...input, outputRegion: { x: NaN, y: 0, width: 5, height: 5 } })).toBe(true)
    expect(gl.scissor.mock.calls.every((args) =>
      args[0] === 20 && args[1] === 60 && args[2] === 160 && args[3] === 121
    )).toBe(true)
    gl.copyTexSubImage2D.mockClear()
    gl.drawArrays.mockClear()
    expect(pass.render({ ...input, outputRegion: { x: 150, y: 150, width: 5, height: 5 } })).toBe(true)
    expect(gl.copyTexSubImage2D).not.toHaveBeenCalled()
    expect(gl.drawArrays).not.toHaveBeenCalled()
    pass.dispose()
  })

  it('clips expanded draw bounds to the visible part of a partial box', () => {
    const { gl, pass, input } = fixture()
    expect(pass.render({
      ...input,
      rect: { x: -20, y: -20, width: 80, height: 80 },
      outputRegion: { x: 0, y: 0, width: 5, height: 5 },
      sigma: 2,
      allowPartial: true,
    })).toBe(true)
    expect(gl.scissor.mock.calls).toEqual([
      [0, 80, 120, 121],
      [0, 173, 14, 28],
      [0, 188, 12, 13],
      [0, 188, 12, 13],
    ])
    pass.dispose()
  })

  it('rejects a visible border box that extends beyond the viewport', () => {
    const { gl, pass, input } = fixture()
    expect(pass.render({ ...input, rect: { x: -1, y: 10, width: 20, height: 20 } })).toBe(false)
    expect(gl.copyTexSubImage2D).not.toHaveBeenCalled()
    pass.dispose()
  })

  it('only draws a partially offscreen box when its sampling was proven safe', () => {
    const { gl, pass, input } = fixture()
    const partial = { x: -1, y: 10, width: 20, height: 20 }
    expect(pass.render({ ...input, rect: partial })).toBe(false)
    expect(pass.render({ ...input, rect: partial, allowPartial: true })).toBe(true)
    expect(gl.copyTexSubImage2D).toHaveBeenCalledTimes(1)
    pass.dispose()
  })

  it('skips invisible and fully transparent layers without drawing', () => {
    const { gl, pass, input } = fixture()
    expect(pass.render({ ...input, rect: { x: 200, y: 10, width: 20, height: 20 } })).toBe(true)
    expect(pass.render({ ...input, opacity: 0 })).toBe(true)
    expect(gl.copyTexSubImage2D).not.toHaveBeenCalled()
    pass.dispose()
  })

  it('composites a zero-radius backdrop on transparent content', () => {
    const { gl, pass, input } = fixture()
    expect(pass.render({ ...input, sigma: 0 })).toBe(true)
    expect(gl.copyTexSubImage2D).toHaveBeenCalledTimes(1)
    expect(gl.drawArrays).toHaveBeenCalledTimes(3)
    pass.dispose()
  })

  it('rejects a kernel exceeding its shader capacity', () => {
    const { gl, pass, input } = fixture()
    expect(pass.render({ ...input, sigma: 100 })).toBe(false)
    expect(gl.copyTexSubImage2D).not.toHaveBeenCalled()
    pass.dispose()
  })

  it('reuses equal-axis kernels and restores pixel store only when uploading', () => {
    const { gl, pass, input } = fixture()
    gl.getParameter.mockClear()
    gl.getParameter.mockReturnValueOnce(1).mockReturnValueOnce(1).mockReturnValueOnce(777)
    const square = { ...input, targetHeight: 200 }
    expect(pass.render(square)).toBe(true)
    const uploads = () =>
      gl.texImage2D.mock.calls.filter((args) => args[3] === 100 && args[4] === 1)
    expect(uploads()).toHaveLength(1)
    expect(gl.getParameter).toHaveBeenCalledTimes(3)
    expect(gl.pixelStorei.mock.calls).toEqual([
      [gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0],
      [gl.UNPACK_FLIP_Y_WEBGL, 0],
      [gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE],
      [gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1],
      [gl.UNPACK_FLIP_Y_WEBGL, 1],
      [gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, 777],
    ])
    const uniforms = gl.uniform1f.mock.calls
    expect(uniforms[0]?.[1]).toBe(uniforms[2]?.[1])
    expect(uniforms[1]?.[1]).toBe(uniforms[3]?.[1])

    expect(pass.render(square)).toBe(true)
    expect(uploads()).toHaveLength(1)
    expect(gl.getParameter).toHaveBeenCalledTimes(3)
    expect(pass.render({ ...square, sigma: 11 })).toBe(true)
    expect(uploads()).toHaveLength(2)
    expect(gl.getParameter).toHaveBeenCalledTimes(6)
    expect(pass.render({ ...square, targetHeight: 201 })).toBe(true)
    expect(uploads()).toHaveLength(3)
    expect(gl.getParameter).toHaveBeenCalledTimes(9)
    pass.dispose()
  })

  it('evicts least recently used kernel textures and deletes each texture once', () => {
    const { gl, pass, input } = fixture()
    const square = { ...input, targetHeight: 200 }
    for (let sigma = 1; sigma <= 32; sigma += 1) {
      expect(pass.render({ ...square, sigma })).toBe(true)
    }
    const first = gl.createTexture.mock.results[2]?.value
    const second = gl.createTexture.mock.results[3]?.value
    expect(gl.deleteTexture).not.toHaveBeenCalled()
    expect(pass.render({ ...square, sigma: 1 })).toBe(true)
    expect(pass.render({ ...square, sigma: 33 })).toBe(true)
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1)
    expect(gl.deleteTexture).toHaveBeenCalledWith(second)
    expect(gl.deleteTexture).not.toHaveBeenCalledWith(first)
    expect(pass.render({ ...square, sigma: 2 })).toBe(true)
    expect(
      gl.texImage2D.mock.calls.filter((args) => args[3] === 100 && args[4] === 1)
    ).toHaveLength(34)
    pass.dispose()
    expect(gl.deleteTexture).toHaveBeenCalledTimes(36)
    expect(new Set(gl.deleteTexture.mock.calls.map(([texture]) => texture)).size).toBe(36)
  })

  it('discards newly uploaded kernels when GL reports an error', () => {
    const { gl, pass, input } = fixture()
    const square = { ...input, targetHeight: 200 }
    gl.getError.mockReturnValueOnce(1280)
    expect(pass.render(square)).toBe(false)
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1)
    expect(pass.render(square)).toBe(true)
    expect(
      gl.texImage2D.mock.calls.filter((args) => args[3] === 100 && args[4] === 1)
    ).toHaveLength(2)
    pass.dispose()
  })

  it('discards kernels uploaded before a context loss', () => {
    const { gl, pass, input } = fixture()
    gl.isContextLost.mockReturnValueOnce(false).mockReturnValueOnce(true)
    expect(pass.render({ ...input, targetHeight: 200 })).toBe(false)
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1)
    expect(gl.getError).not.toHaveBeenCalled()
    pass.dispose()
  })

  it('restores pixel store and deletes a kernel if its upload throws', () => {
    const { gl, pass, input } = fixture()
    gl.getParameter.mockReturnValueOnce(1).mockReturnValueOnce(1).mockReturnValueOnce(777)
    gl.texImage2D
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('upload failed')
      })
    expect(() => pass.render(input)).toThrow('upload failed')
    expect(gl.pixelStorei.mock.calls.slice(-3)).toEqual([
      [gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1],
      [gl.UNPACK_FLIP_Y_WEBGL, 1],
      [gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, 777],
    ])
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1)
    pass.dispose()
    expect(gl.deleteTexture).toHaveBeenCalledTimes(3)
  })

  it('checks errors when GPU resources first appear or target storage changes', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(100)
    const { gl, pass, input } = fixture()
    expect(pass.render(input)).toBe(true)
    expect(gl.getError).toHaveBeenCalledTimes(1)
    expect(pass.render(input)).toBe(true)
    expect(gl.getError).toHaveBeenCalledTimes(1)

    const secondMask = {} as WebGLTexture
    expect(pass.render({ ...input, mask: secondMask })).toBe(true)
    expect(gl.getError).toHaveBeenCalledTimes(2)
    expect(pass.render(input)).toBe(true)
    expect(gl.getError).toHaveBeenCalledTimes(2)

    const framebuffer = {} as WebGLFramebuffer
    expect(pass.render({ ...input, framebuffer })).toBe(true)
    expect(gl.getError).toHaveBeenCalledTimes(3)
    expect(pass.render(input)).toBe(true)
    expect(gl.getError).toHaveBeenCalledTimes(3)
    expect(pass.render({ ...input, targetWidth: 201 })).toBe(true)
    expect(gl.getError).toHaveBeenCalledTimes(4)
    expect(pass.render({ ...input, targetWidth: 201, mask: secondMask })).toBe(true)
    expect(gl.getError).toHaveBeenCalledTimes(5)
    now.mockRestore()
    pass.dispose()
  })

  it('checks for later errors on a shared timer without synchronizing every layer', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(100)
    const { gl, pass, input } = fixture()
    const other = { ...input, mask: {} as WebGLTexture }
    expect(pass.render(input)).toBe(true)
    expect(pass.render(other)).toBe(true)
    expect(gl.getError).toHaveBeenCalledTimes(2)
    now.mockReturnValue(2099)
    expect(pass.render(input)).toBe(true)
    expect(gl.getError).toHaveBeenCalledTimes(2)
    now.mockReturnValue(2100)
    gl.getError.mockReturnValueOnce(1280)
    expect(pass.render(other)).toBe(false)
    expect(gl.getError).toHaveBeenCalledTimes(3)
    expect(pass.render(input)).toBe(true)
    expect(gl.getError).toHaveBeenCalledTimes(3)
    // The failing resource is checked again before it can be marked valid.
    expect(pass.render(other)).toBe(true)
    expect(gl.getError).toHaveBeenCalledTimes(4)
    now.mockRestore()
    pass.dispose()
  })

  it('validates each separate source framebuffer once for the same mask and target', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(100)
    const { gl, pass, input } = fixture()
    const firstSource = {} as WebGLFramebuffer
    const secondSource = {} as WebGLFramebuffer
    const foreground = { ...input, foregroundOnly: true }

    expect(pass.render({ ...foreground, sourceFramebuffer: firstSource })).toBe(true)
    expect(gl.getError).toHaveBeenCalledTimes(1)
    expect(pass.render({ ...foreground, sourceFramebuffer: secondSource })).toBe(true)
    expect(gl.getError).toHaveBeenCalledTimes(2)
    expect(pass.render({ ...foreground, sourceFramebuffer: firstSource })).toBe(true)
    expect(pass.render({ ...foreground, sourceFramebuffer: secondSource })).toBe(true)
    expect(gl.getError).toHaveBeenCalledTimes(2)
    now.mockRestore()
    pass.dispose()
  })

  it('rejects invalid input and context loss without waiting on getError', () => {
    const { gl, pass, input } = fixture()
    expect(pass.render({ ...input, sigma: -1 })).toBe(false)
    expect(gl.getError).not.toHaveBeenCalled()
    gl.isContextLost.mockReturnValue(true)
    expect(pass.render(input)).toBe(false)
    expect(gl.getError).not.toHaveBeenCalled()
    pass.dispose()
  })
})
