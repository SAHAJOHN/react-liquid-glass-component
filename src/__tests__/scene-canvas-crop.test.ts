import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { proveBackdropSampling } from '../scene/backdrop-sampling'
import { canvasCrop, createSceneRenderer } from '../scene/renderer'
import { GLASS_STUDIO_DEFAULTS } from '../studio-props'
import type { GlassScene, SceneFrame, SceneItem, SceneRect } from '../scene/types'

vi.mock('../scene/backdrop-sampling', () => ({ proveBackdropSampling: vi.fn() }))
vi.mock('../scene/studio-pass', () => ({
  createStudioPass: () => ({ render: vi.fn(() => true), dispose: vi.fn() }),
}))
vi.mock('../scene/backdrop-pass', () => ({
  createBackdropPass: () => ({ render: vi.fn(() => true), dispose: vi.fn() }),
}))

const frame: SceneFrame = { width: 200, height: 100, scrollX: 0, scrollY: 0, pixelRatio: 1 }
const region: SceneRect = { x: 30, y: 20, width: 100, height: 50 }

function fixture(attributes: Record<string, unknown> = { colorSpace: 'srgb' }) {
  let id = 0
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
    uniform1i: vi.fn(), uniform1f: vi.fn(), uniform3f: vi.fn(), uniform4fv: vi.fn(),
    uniform2fv: vi.fn(), drawArrays: vi.fn(), clearColor: vi.fn(), clear: vi.fn(),
    blendEquation: vi.fn(), blendFunc: vi.fn(), copyTexSubImage2D: vi.fn(),
  }
  const source = document.createElement('canvas')
  source.width = 400
  source.height = 2000
  source.dataset.liquidGlassCanvas = '2d'
  source.dataset.liquidGlassCanvasFormat = 'srgb8'
  const sourceReads = vi.fn()
  const sourceContext = { getContextAttributes: vi.fn(() => attributes) }
  const stagingContext = {
    getContextAttributes: vi.fn(() => ({ colorSpace: 'srgb' })),
    setTransform: vi.fn(), drawImage: vi.fn(), globalCompositeOperation: 'source-over',
  }
  const staging: HTMLCanvasElement[] = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
    contextId: string
  ) {
    if (contextId === 'webgl') return gl as unknown as WebGLRenderingContext
    if (contextId !== '2d') return null
    if (this === source) {
      sourceReads()
      return sourceContext as unknown as CanvasRenderingContext2D
    }
    if (!staging.includes(this)) staging.push(this)
    return stagingContext as unknown as CanvasRenderingContext2D
  } as HTMLCanvasElement['getContext'])
  const renderer = createSceneRenderer(document.createElement('canvas'))
  if (!renderer) throw new Error('Cannot create WebGL test renderer')
  const media: SceneItem = {
    kind: 'media', source, rect: { x: 0, y: 0, width: 200, height: 1000 },
    space: 'document', opacity: 1, fit: 'fill', position: [0.5, 0.5], radius: 0,
  }
  const glass: SceneItem = {
    kind: 'glass', rect: region, space: 'viewport', opacity: 1, radius: 10,
    displacement: [0, 0, 0], blur: 0, saturation: 1, tint: [0, 0, 0, 0],
    studio: { ...GLASS_STUDIO_DEFAULTS, shadowFactor: 0 },
  }
  const scene = (...items: SceneItem[]): GlassScene => ({
    background: [1, 1, 1, 1], items, samplingRegion: region,
    samplingRegions: [region], renderRegions: [region],
  })
  const imageUploads = () => gl.texImage2D.mock.calls.map((args) => args[args.length - 1])
  return { gl, renderer, source, sourceReads, sourceContext, stagingContext, staging, media, glass, scene, imageUploads }
}

beforeEach(() => {
  vi.mocked(proveBackdropSampling).mockReturnValue({
    needed: new Set(), outputRegions: new Map(), sourceRegions: [region],
  })
})
afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('canvas sampling crop geometry', () => {
  it('covers the region and a bilinear margin in source pixels', () => {
    const source = document.createElement('canvas')
    source.width = 400
    source.height = 2000
    const rect = { x: 0, y: 0, width: 200, height: 1000 }
    const crop = canvasCrop(source, rect, [region], 4)
    expect(crop).toBeDefined()
    if (!crop) throw new Error('Expected a crop')
    expect(crop.x).toBeLessThanOrEqual((region.x - 4) * 2 - 2)
    expect(crop.y).toBeLessThanOrEqual((region.y - 4) * 2 - 2)
    expect(crop.x + crop.width).toBeGreaterThanOrEqual((region.x + region.width + 4) * 2 + 2)
    expect(crop.y + crop.height).toBeGreaterThanOrEqual((region.y + region.height + 4) * 2 + 2)
    expect(crop.x).toBeGreaterThanOrEqual(0)
    expect(crop.y).toBeGreaterThanOrEqual(0)
    expect(crop.x + crop.width).toBeLessThanOrEqual(source.width)
    expect(crop.y + crop.height).toBeLessThanOrEqual(source.height)
  })

  it.each([
    { x: Number.NaN, y: 0, width: 200, height: 1000 },
    { x: Number.MAX_VALUE, y: 0, width: Number.MAX_VALUE, height: 1 },
    { x: 0, y: 0, width: Number.MIN_VALUE, height: 1 },
    { x: 0, y: 0, width: 0, height: 1000 },
  ])('rejects invalid or overflowing media geometry', (rect) => {
    const source = document.createElement('canvas')
    source.width = 400
    source.height = 2000
    expect(canvasCrop(source, rect, [region], 4)).toBeUndefined()
  })

  it('rejects invalid regions and crops that exceed the staging budget', () => {
    const source = document.createElement('canvas')
    source.width = 4000
    source.height = 4000
    const rect = { x: 0, y: 0, width: 4000, height: 4000 }
    expect(canvasCrop(source, rect, [], 4)).toBeUndefined()
    expect(canvasCrop(source, rect, [{ ...region, x: Infinity }], 4)).toBeUndefined()
    expect(canvasCrop(source, rect, [{ x: 10, y: 10, width: 1200, height: 1200 }], 4)).toBeUndefined()
  })
})

describe('cropped canvas media upload', () => {
  it('uploads an sRGB8 crop and remaps media coordinates', () => {
    const { gl, renderer, source, sourceReads, stagingContext, staging, media, glass, scene, imageUploads } = fixture()
    renderer.setScene(scene(media, glass))
    expect(renderer.render(frame)).toBe(true)
    expect(sourceReads).toHaveBeenCalled()
    expect(staging).toHaveLength(1)
    expect(stagingContext.drawImage).toHaveBeenCalledWith(source, expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number), 0, 0, expect.any(Number), expect.any(Number))
    expect(imageUploads()).toContain(staging[0])
    expect(imageUploads()).not.toContain(source)
    const mediaUniform = gl.uniform4f.mock.calls.find((args) => args[0] === 'u_media')
    expect(mediaUniform).toBeDefined()
    expect(mediaUniform?.[1]).toBeGreaterThan(0)
    expect(mediaUniform?.[2]).toBeGreaterThan(0)
    expect(mediaUniform?.[3]).toBeLessThan(1)
    expect(mediaUniform?.[4]).toBeLessThan(1)
    renderer.dispose()
  })

  it.each(['none', '2d-only'] as const)('never probes an unasserted %s canvas context', (marker) => {
    const { renderer, source, sourceReads, staging, media, glass, scene, imageUploads } = fixture()
    delete source.dataset.liquidGlassCanvasFormat
    if (marker === 'none') delete source.dataset.liquidGlassCanvas
    renderer.setScene(scene(media, glass))
    expect(renderer.render(frame)).toBe(true)
    expect(sourceReads).not.toHaveBeenCalled()
    expect(staging).toHaveLength(0)
    expect(imageUploads()).toContain(source)
    renderer.dispose()
  })

  it.each([
    ['unknown', {}],
    ['P3', { colorSpace: 'display-p3' }],
    ['float16', { colorSpace: 'srgb', colorType: 'float16' }],
  ])('uses the full source for %s context attributes', (_name, attributes) => {
    const { renderer, source, staging, media, glass, scene, imageUploads } = fixture(attributes)
    renderer.setScene(scene(media, glass))
    expect(renderer.render(frame)).toBe(true)
    expect(staging).toHaveLength(0)
    expect(imageUploads()).toContain(source)
    renderer.dispose()
  })

  it('allows explicit unorm8 context attributes', () => {
    const { renderer, source, staging, media, glass, scene, imageUploads } = fixture({ colorSpace: 'srgb', colorType: 'unorm8' })
    renderer.setScene(scene(media, glass))
    expect(renderer.render(frame)).toBe(true)
    expect(staging).toHaveLength(1)
    expect(imageUploads()).not.toContain(source)
    renderer.dispose()
  })

  it('updates the crop on scroll and after source resize without sampling stale pixels', () => {
    const { gl, renderer, source, stagingContext, staging, media, glass, scene } = fixture()
    renderer.setScene(scene(media, glass))
    expect(renderer.render(frame)).toBe(true)
    const calls = stagingContext.drawImage.mock.calls
    const first = calls[calls.length - 1]
    expect(renderer.render({ ...frame, scrollY: 20 })).toBe(true)
    const second = calls[calls.length - 1]
    expect(second?.[2]).toBeGreaterThan(first?.[2] ?? Infinity)
    expect(gl.texSubImage2D.mock.calls.some((args) => args.includes(staging[0]))).toBe(true)
    source.width = 500
    expect(renderer.render({ ...frame, scrollY: 20 })).toBe(true)
    const resized = calls[calls.length - 1]
    expect(resized?.[3]).not.toEqual(second?.[3])
    expect(gl.texImage2D.mock.calls.filter((args) => args.includes(staging[0])).length).toBeGreaterThan(1)
    renderer.dispose()
  })

  it('checks WebGL errors after source resize even when the cropped texture size stays unchanged', () => {
    const { gl, renderer, source, staging, media, glass, scene } = fixture()
    vi.spyOn(performance, 'now').mockReturnValue(100)
    renderer.setScene(scene(media, glass))
    expect(renderer.render(frame)).toBe(true)
    const scratch = staging[0]
    const originalWidth = scratch?.width
    const originalHeight = scratch?.height
    const previousChecks = gl.getError.mock.calls.length

    source.height += 1
    gl.getError.mockReturnValue(1282)
    expect(renderer.render(frame)).toBe(false)
    expect(scratch?.width).toBe(originalWidth)
    expect(scratch?.height).toBe(originalHeight)
    expect(gl.getError.mock.calls.length).toBeGreaterThan(previousChecks)
    renderer.dispose()
  })

  it('releases its staging backing store when the source leaves the scene and on disposal', () => {
    const { renderer, staging, media, glass, scene } = fixture()
    renderer.setScene(scene(media, glass))
    expect(renderer.render(frame)).toBe(true)
    const first = staging[0]
    expect(first?.width).toBeGreaterThan(0)
    renderer.setScene(scene(glass))
    expect(first?.width).toBe(0)
    expect(first?.height).toBe(0)
    renderer.setScene(scene(media, glass))
    expect(renderer.render(frame)).toBe(true)
    const next = staging[1]
    expect(next?.width).toBeGreaterThan(0)
    renderer.dispose()
    expect(next?.width).toBe(0)
    expect(next?.height).toBe(0)
  })

  it('keeps the full source when the dependency proof is unavailable', () => {
    const { renderer, source, staging, media, glass, scene, imageUploads } = fixture()
    vi.mocked(proveBackdropSampling).mockReturnValue(null)
    renderer.setScene(scene(media, glass))
    expect(renderer.render(frame)).toBe(true)
    expect(staging).toHaveLength(0)
    expect(imageUploads()).toContain(source)
    renderer.dispose()
  })

  it('keeps the full source when one canvas is used more than once', () => {
    const { renderer, source, staging, media, glass, scene, imageUploads } = fixture()
    renderer.setScene(scene(media, media, glass))
    expect(renderer.render(frame)).toBe(true)
    expect(staging).toHaveLength(0)
    expect(imageUploads()).toContain(source)
    renderer.dispose()
  })

  it('keeps the full source for non-fill object fit', () => {
    const { renderer, source, staging, media, glass, scene, imageUploads } = fixture()
    if (media.kind !== 'media') throw new Error('Expected media')
    renderer.setScene(scene({ ...media, fit: 'contain' }, glass))
    expect(renderer.render(frame)).toBe(true)
    expect(staging).toHaveLength(0)
    expect(imageUploads()).toContain(source)
    renderer.dispose()
  })

  it('keeps the full source for a canvas inside an opacity group', () => {
    const { renderer, source, staging, media, glass, scene, imageUploads } = fixture()
    if (media.kind !== 'media') throw new Error('Expected media')
    renderer.setScene(scene({ kind: 'opacity-group', items: [media], rect: media.rect, space: 'document', opacity: 0.7 }, glass))
    expect(renderer.render(frame)).toBe(true)
    expect(staging).toHaveLength(0)
    expect(imageUploads()).toContain(source)
    renderer.dispose()
  })
})
