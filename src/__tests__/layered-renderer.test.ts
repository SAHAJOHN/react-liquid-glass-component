import { createSceneRenderer } from '../scene/renderer'
import { GLASS_STUDIO_DEFAULTS } from '../studio-props'
import type { GlassScene, SceneFrame, SceneItem } from '../scene/types'

const calls = vi.hoisted(() => ({ order: [] as string[] }))
vi.mock('../scene/studio-pass', () => ({
  createStudioPass: () => ({
    render: () => { calls.order.push('studio'); return true },
    dispose: vi.fn(),
  }),
}))

const frame: SceneFrame = { width: 200, height: 100, scrollX: 0, scrollY: 0, pixelRatio: 1 }

function fixture() {
  let id = 0
  let mode = -1
  const create = () => ({ id: ++id })
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, TEXTURE0: 7, TEXTURE1: 8, TEXTURE_2D: 10,
    TEXTURE_WRAP_S: 11, TEXTURE_WRAP_T: 12, CLAMP_TO_EDGE: 13, TEXTURE_MIN_FILTER: 14,
    TEXTURE_MAG_FILTER: 15, LINEAR: 16, RGBA: 18, UNSIGNED_BYTE: 19, FRAMEBUFFER: 20,
    COLOR_ATTACHMENT0: 21, FRAMEBUFFER_COMPLETE: 22, FLOAT: 23, BLEND: 24,
    SCISSOR_TEST: 25, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 26, UNPACK_FLIP_Y_WEBGL: 27,
    TRIANGLE_STRIP: 30, NO_ERROR: 0, MAX_TEXTURE_SIZE: 31, DEPTH_TEST: 32,
    CULL_FACE: 33, ONE: 34, ONE_MINUS_SRC_ALPHA: 35, FUNC_ADD: 36, COLOR_BUFFER_BIT: 37,
    createProgram: vi.fn(create), createShader: vi.fn(create), createBuffer: vi.fn(create),
    createTexture: vi.fn(create), createFramebuffer: vi.fn(create),
    getShaderParameter: vi.fn(() => true), getProgramParameter: vi.fn(() => true),
    getAttribLocation: vi.fn(() => 0), getUniformLocation: vi.fn((_program, name) => name),
    getParameter: vi.fn(() => 4096), getError: vi.fn(() => 0), isContextLost: vi.fn(() => false),
    checkFramebufferStatus: vi.fn(() => 22), shaderSource: vi.fn(), compileShader: vi.fn(),
    attachShader: vi.fn(), linkProgram: vi.fn(), deleteShader: vi.fn(), deleteProgram: vi.fn(),
    deleteBuffer: vi.fn(), deleteTexture: vi.fn(), deleteFramebuffer: vi.fn(),
    bindBuffer: vi.fn(), bufferData: vi.fn(), activeTexture: vi.fn(), bindTexture: vi.fn(),
    texParameteri: vi.fn(), texImage2D: vi.fn(), texSubImage2D: vi.fn(), bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(), useProgram: vi.fn(), enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(), viewport: vi.fn(), disable: vi.fn(), enable: vi.fn(),
    scissor: vi.fn(), pixelStorei: vi.fn(), uniform2f: vi.fn(), uniform4f: vi.fn(),
    uniform1i: vi.fn((name, value) => { if (name === 'u_mode') mode = value }),
    uniform1f: vi.fn(), uniform3f: vi.fn(), uniform4fv: vi.fn(), uniform2fv: vi.fn(),
    drawArrays: vi.fn(() => { if (mode === 1) calls.order.push('content') }),
    clearColor: vi.fn(), clear: vi.fn(), blendEquation: vi.fn(), blendFunc: vi.fn(),
    copyTexSubImage2D: vi.fn(),
  }
  const layer = document.createElement('canvas')
  const layerContext = {
    setTransform: vi.fn(), clearRect: vi.fn(),
    drawImage: vi.fn(() => { calls.order.push('snapshot') }),
  }
  const canvas = document.createElement('canvas')
  vi.spyOn(canvas, 'getContext').mockReturnValue(gl as unknown as WebGLRenderingContext)
  vi.spyOn(layer, 'getContext').mockReturnValue(layerContext as unknown as CanvasRenderingContext2D)
  const renderer = createSceneRenderer(canvas)
  if (!renderer) throw new Error('Renderer was not created')
  return { gl, canvas, layer, layerContext, renderer }
}

function glass(layer: HTMLCanvasElement): SceneItem {
  return {
    kind: 'glass', rect: { x: 10, y: 15, width: 100, height: 50 }, space: 'viewport',
    opacity: 1, radius: 4, displacement: [0, 0, 0], blur: 0, saturation: 1,
    tint: [1, 1, 1, 0], studio: GLASS_STUDIO_DEFAULTS, nativeLayer: layer,
  }
}

describe('layered scene rendering', () => {
  beforeEach(() => { calls.order.length = 0 })
  afterEach(() => vi.restoreAllMocks())

  it('captures a pane after its glass and before subsequent scene content', () => {
    const { canvas, layer, layerContext, renderer } = fixture()
    const text: SceneItem = {
      kind: 'solid', rect: { x: 20, y: 20, width: 10, height: 10 }, space: 'viewport',
      opacity: 1, radius: 0, color: [1, 1, 1, 1],
    }
    const scene: GlassScene = { background: [0, 0, 0, 1], items: [glass(layer), text] }
    renderer.setScene(scene)
    expect(renderer.render(frame)).toBe(true)
    expect(calls.order).toEqual(['studio', 'snapshot', 'content'])
    expect(layerContext.drawImage).toHaveBeenCalledWith(canvas, 10, 15, 100, 50, 0, 0, 100, 50)
    renderer.dispose()
  })

  it('fails closed if a layered pane is inside a group opacity effect', () => {
    const { layer, layerContext, renderer } = fixture()
    const pane = glass(layer)
    if (pane.kind !== 'glass') throw new Error('Expected glass')
    const scene: GlassScene = {
      background: [0, 0, 0, 1],
      items: [{ kind: 'opacity-group', rect: pane.rect, space: 'viewport', opacity: 0.5, items: [pane] }],
    }
    renderer.setScene(scene)
    expect(renderer.render(frame)).toBe(false)
    expect(layerContext.drawImage).not.toHaveBeenCalled()
    renderer.dispose()
  })

  it('batches two pane snapshots without changing their paint order', () => {
    const { gl, canvas, layer, layerContext, renderer } = fixture()
    const second = document.createElement('canvas')
    const secondContext = { setTransform: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn() }
    vi.spyOn(second, 'getContext').mockReturnValue(secondContext as unknown as CanvasRenderingContext2D)
    const staging = document.createElement('canvas')
    const stagingContext = { drawImage: vi.fn(() => calls.order.push('stage')) }
    vi.spyOn(staging, 'getContext').mockReturnValue(stagingContext as unknown as CanvasRenderingContext2D)
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((name, options) =>
      name === 'canvas' ? staging : originalCreate(name, options))
    const content: SceneItem = {
      kind: 'solid', rect: { x: 20, y: 20, width: 10, height: 10 }, space: 'viewport',
      opacity: 1, radius: 0, color: [1, 0, 0, 1],
    }
    const secondGlass = glass(second)
    secondGlass.rect = { x: 0, y: 0, width: 100, height: 40 }
    renderer.setScene({ background: [0, 0, 0, 1], items: [glass(layer), content, secondGlass] })
    expect(renderer.render(frame)).toBe(true)
    expect(calls.order).toEqual(['studio', 'content', 'studio', 'stage', 'snapshot'])
    expect(gl.copyTexSubImage2D).toHaveBeenCalledTimes(2)
    expect(stagingContext.drawImage).toHaveBeenCalledTimes(1)
    expect(stagingContext.drawImage).toHaveBeenCalledWith(canvas, 0, 0, 102, 93, 0, 0, 102, 93)
    expect(layerContext.drawImage).toHaveBeenCalledWith(staging, 1, 1, 100, 50, 0, 0, 100, 50)
    expect(secondContext.drawImage).toHaveBeenCalledWith(staging, 0, 52, 100, 40, 0, 0, 100, 40)
    renderer.dispose()
  })

  it('re-renders directly if the atlas staging copy throws', () => {
    const { layer, layerContext, renderer } = fixture()
    const second = document.createElement('canvas')
    const secondContext = { setTransform: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn() }
    vi.spyOn(second, 'getContext').mockReturnValue(secondContext as unknown as CanvasRenderingContext2D)
    const staging = document.createElement('canvas')
    const stagingContext = { drawImage: vi.fn(() => { throw new Error('staging failed') }) }
    vi.spyOn(staging, 'getContext').mockReturnValue(stagingContext as unknown as CanvasRenderingContext2D)
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((name, options) =>
      name === 'canvas' ? staging : originalCreate(name, options))
    const secondGlass = glass(second)
    secondGlass.rect = { x: 0, y: 0, width: 100, height: 40 }
    renderer.setScene({ background: [0, 0, 0, 1], items: [glass(layer), secondGlass] })
    expect(renderer.render(frame)).toBe(true)
    expect(stagingContext.drawImage).toHaveBeenCalledTimes(1)
    expect(layerContext.drawImage).toHaveBeenCalledTimes(1)
    expect(secondContext.drawImage).toHaveBeenCalledTimes(1)
    // Do not keep attempting an unavailable atlas on later frames.
    expect(renderer.render(frame)).toBe(true)
    expect(stagingContext.drawImage).toHaveBeenCalledTimes(1)
    expect(layerContext.drawImage).toHaveBeenCalledTimes(2)
    renderer.dispose()
  })

  it('does not repeat a failed staging context allocation on later frames', () => {
    const { layer, layerContext, renderer } = fixture()
    const second = document.createElement('canvas')
    const secondContext = { setTransform: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn() }
    vi.spyOn(second, 'getContext').mockReturnValue(secondContext as unknown as CanvasRenderingContext2D)
    const staging = document.createElement('canvas')
    const getContext = vi.spyOn(staging, 'getContext').mockReturnValue(null)
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((name, options) =>
      name === 'canvas' ? staging : originalCreate(name, options))
    const secondGlass = glass(second)
    secondGlass.rect = { x: 0, y: 0, width: 100, height: 40 }
    renderer.setScene({ background: [0, 0, 0, 1], items: [glass(layer), secondGlass] })
    expect(renderer.render(frame)).toBe(true)
    expect(renderer.render(frame)).toBe(true)
    expect(getContext).toHaveBeenCalledTimes(1)
    expect(layerContext.drawImage).toHaveBeenCalledTimes(2)
    expect(secondContext.drawImage).toHaveBeenCalledTimes(2)
    renderer.dispose()
  })

  it('re-renders directly if WebGL reports an atlas copy error', () => {
    const { gl, layer, layerContext, renderer } = fixture()
    const second = document.createElement('canvas')
    const secondContext = { setTransform: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn() }
    vi.spyOn(second, 'getContext').mockReturnValue(secondContext as unknown as CanvasRenderingContext2D)
    const staging = document.createElement('canvas')
    const stagingContext = { drawImage: vi.fn() }
    vi.spyOn(staging, 'getContext').mockReturnValue(stagingContext as unknown as CanvasRenderingContext2D)
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((name, options) =>
      name === 'canvas' ? staging : originalCreate(name, options))
    const secondGlass = glass(second)
    secondGlass.rect = { x: 0, y: 0, width: 100, height: 40 }
    renderer.setScene({ background: [0, 0, 0, 1], items: [glass(layer), secondGlass] })
    // Resize and atlas allocation succeed; the single post-batch error check fails.
    gl.getError.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(1282)
    expect(renderer.render(frame)).toBe(true)
    expect(stagingContext.drawImage).not.toHaveBeenCalled()
    expect(layerContext.drawImage).toHaveBeenCalledTimes(1)
    expect(secondContext.drawImage).toHaveBeenCalledTimes(1)
    renderer.dispose()
  })
})
