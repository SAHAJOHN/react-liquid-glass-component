import type {
  GlassScene,
  SceneFrame,
  SceneItem,
  SceneOpacityPaint,
  SceneRect,
  SceneRenderer,
} from './types'
import { createStudioPass } from './studio-pass'
import { createBackdropPass } from './backdrop-pass'
import { proveBackdropSampling } from './backdrop-sampling'
import { samplingRelationToRegions, validSamplingRegion } from './sampling-boundary'
import { studioSdfSource } from './studio-shader'
import { MAX_SCENE_CLIPS, packSceneClips, sceneClips } from './clip-stack'

const vertexSource = `
attribute vec2 a_position;
uniform vec2 u_viewport;
uniform vec4 u_rect;
varying vec2 v_local;
void main() {
  v_local = a_position;
  vec2 position = (u_rect.xy + a_position * u_rect.zw) / u_viewport;
  gl_Position = vec4(position.x * 2.0 - 1.0, 1.0 - position.y * 2.0, 0.0, 1.0);
}
`

const fragmentSource = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_source;
uniform sampler2D u_map;
uniform bool u_hasMap;
uniform bool u_hasGroupMask;
uniform vec4 u_groupMaskRect;
uniform int u_xChannel;
uniform int u_yChannel;
uniform int u_mode;
uniform vec2 u_viewport;
uniform vec2 u_texel;
uniform vec4 u_rect;
uniform vec4 u_color;
uniform vec3 u_displacement;
uniform float u_radius;
uniform float u_blur;
uniform float u_pixelRatio;
uniform float u_opacity;
uniform float u_brightness;
uniform float u_saturation;
uniform float u_magnification;
uniform float u_thickness;
uniform int u_clipCount;
uniform vec4 u_clips[${MAX_SCENE_CLIPS}];
uniform vec2 u_clipShapes[${MAX_SCENE_CLIPS}];
uniform vec4 u_media;
varying vec2 v_local;

${studioSdfSource}

float mapChannel(vec3 value, int channel) {
  if (channel == 0) return value.r;
  if (channel == 1) return value.g;
  return value.b;
}

float roundedCoverage(vec2 point, vec2 size, float requestedRadius, float roundness) {
  float distance = studioSdf(point, size, requestedRadius, roundness);
  float aa = 0.75 / u_pixelRatio;
  return 1.0 - smoothstep(-aa, aa, distance);
}

vec2 safeUv(vec2 uv, vec2 center) {
  vec2 limit = u_texel * 0.5;
  if (any(lessThan(uv, limit)) || any(greaterThan(uv, vec2(1.0) - limit))) {
    return center;
  }
  return uv;
}

vec3 sampleGlass(vec2 uv, vec2 center) {
  uv = safeUv(uv, center);
  vec3 color = texture2D(u_source, uv).rgb;
  if (u_blur <= 0.0) return color;
  vec2 tap = vec2(u_blur) / u_viewport;
  color *= 0.4;
  color += texture2D(u_source, safeUv(uv + vec2(tap.x, 0.0), center)).rgb * 0.15;
  color += texture2D(u_source, safeUv(uv - vec2(tap.x, 0.0), center)).rgb * 0.15;
  color += texture2D(u_source, safeUv(uv + vec2(0.0, tap.y), center)).rgb * 0.15;
  color += texture2D(u_source, safeUv(uv - vec2(0.0, tap.y), center)).rgb * 0.15;
  return color;
}

void main() {
  float clipCoverage = u_opacity;
  for (int i = 0; i < ${MAX_SCENE_CLIPS}; i++) {
    if (i < u_clipCount) {
      vec2 point = u_rect.xy + v_local * u_rect.zw - u_clips[i].xy;
      clipCoverage *= roundedCoverage(point, u_clips[i].zw, u_clipShapes[i].x, u_clipShapes[i].y);
    }
  }
  if (clipCoverage <= 0.0) discard;
  if (u_mode == 0) {
    vec4 pixel = texture2D(u_source, vec2(v_local.x, 1.0 - v_local.y));
    if (u_hasGroupMask) {
      vec2 maskUv = (u_rect.xy + v_local * u_rect.zw - u_groupMaskRect.xy) / u_groupMaskRect.zw;
      if (any(lessThan(maskUv, vec2(0.0))) || any(greaterThan(maskUv, vec2(1.0)))) discard;
      pixel *= texture2D(u_map, vec2(maskUv.x, 1.0 - maskUv.y)).a;
    }
    gl_FragColor = vec4(pixel.rgb * u_brightness, pixel.a) * clipCoverage;
    return;
  }

  vec2 size = u_rect.zw;
  vec2 p = (v_local - 0.5) * size;
  float radius = clamp(u_radius, 0.0, min(size.x, size.y) * 0.5);
  vec2 q = abs(p) - size * 0.5 + radius;
  float distance = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  float aa = 0.75 / u_pixelRatio;
  float coverage = (1.0 - smoothstep(-aa, aa, distance)) * clipCoverage;
  if (coverage <= 0.0) discard;

  if (u_mode == 3) {
    vec2 uv = (v_local - u_media.xy) / u_media.zw;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
    vec4 pixel = texture2D(u_source, vec2(uv.x, 1.0 - uv.y));
    gl_FragColor = vec4(pixel.rgb * u_brightness, pixel.a) * coverage;
    return;
  }

  if (u_mode == 1) {
    float alpha = u_color.a * coverage;
    gl_FragColor = vec4(u_color.rgb * alpha * u_brightness, alpha);
    return;
  }

  vec2 screen = (u_rect.xy + v_local * size) / u_viewport;
  vec2 center = vec2(screen.x, 1.0 - screen.y);
  vec2 offset;
  if (u_hasMap) {
    vec3 map = texture2D(u_map, vec2(v_local.x, 1.0 - v_local.y)).rgb;
    offset = vec2(mapChannel(map, u_xChannel) - 0.5,
                 0.5 - mapChannel(map, u_yChannel)) / u_viewport;
  } else {
    vec2 normal;
    if (q.x > 0.0 || q.y > 0.0) {
      vec2 corner = max(q, 0.0);
      normal = length(corner) > 0.0 ? normalize(corner) * sign(p) : vec2(0.0);
    } else {
      normal = q.x > q.y ? vec2(sign(p.x), 0.0) : vec2(0.0, sign(p.y));
    }
    float depth = max(12.0, min(size.x, size.y) * 0.25);
    float edge = 1.0 - smoothstep(0.0, depth, max(-distance, 0.0));
    offset = vec2(normal.x, -normal.y) * edge * 0.12 / u_viewport;
  }
  float insideDepth = max(-distance, 0.0);
  // Thickness is the width of the refracting rim, in CSS pixels. A finite
  // profile leaves the plate's interior undistorted unless its body lens is on.
  // Negative thickness keeps the legacy profile for older internal callers.
  if (u_thickness >= 0.0) {
    if (u_thickness == 0.0) offset = vec2(0.0);
    else offset *= 1.0 - smoothstep(0.0, u_thickness, insideDepth);
  }
  // A lens also changes the scale of the scene across its body. The legacy map
  // is nearly flat in the center, so it cannot supply this on its own. Keep
  // optical scaling through the inner region, returning smoothly at the rim.
  float bodyWeight = smoothstep(0.0, min(size.x, size.y) * 0.2, insideDepth);
  float lensScale = (1.0 - 1.0 / u_magnification) * bodyWeight / 180.0;
  offset += vec2(p.x, -p.y) * lensScale / u_viewport;
  // The outside of the rounded pane samples the unmodified scene. Legacy maps
  // can request tens of pixels of travel right at that boundary, producing a
  // visible seam and a folded inner band. Converge smoothly to identity, with
  // travel bounded by the distance to the edge instead of a hard clamp.
  float maxScale = max(abs(u_displacement.r), max(abs(u_displacement.g), abs(u_displacement.b)));
  float travel = length(offset * u_viewport) * maxScale;
  offset *= insideDepth / max(insideDepth + travel, 0.0001);
  vec3 color = sampleGlass(center + offset * u_displacement.r, center);
  if (u_displacement.g != u_displacement.r || u_displacement.b != u_displacement.r) {
    color.g = sampleGlass(center + offset * u_displacement.g, center).g;
    color.b = sampleGlass(center + offset * u_displacement.b, center).b;
  }
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luminance), color, u_saturation);
  color = mix(color, u_color.rgb, u_color.a);
  gl_FragColor = vec4(color * coverage, coverage);
}
`

interface MediaTexture {
  texture: WebGLTexture
  width: number
  height: number
  textureWidth: number
  textureHeight: number
  crop: { x: number; y: number; width: number; height: number } | undefined
  revision: number
  uploadedRevision: number
  time: number
  url: string
  lastFrame: number
  lastErrorCheck: number
  tracksVideoFrames: boolean
  stop: () => void
}

function viewportRect(
  rect: SceneRect,
  space: 'document' | 'viewport',
  frame: SceneFrame
): SceneRect {
  return {
    x: rect.x - (space === 'document' ? frame.scrollX : 0),
    y: rect.y - (space === 'document' ? frame.scrollY : 0),
    width: rect.width,
    height: rect.height,
  }
}

// Align the scratch size to limit GPU reallocations while scrolling.
const canvasCropAlignment = 32
const maxCanvasCropPixels = 1_000_000

export function canvasCrop(
  source: HTMLCanvasElement,
  rect: SceneRect,
  regions: readonly SceneRect[],
  margin: number
): { x: number; y: number; width: number; height: number } | undefined {
  if (
    !validSamplingRegion(rect) ||
    !Number.isFinite(margin) ||
    margin < 0 ||
    !regions.length ||
    !regions.every(validSamplingRegion)
  )
    return undefined
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const region of regions) {
    const x1 = Math.max(rect.x, region.x - margin)
    const y1 = Math.max(rect.y, region.y - margin)
    const x2 = Math.min(rect.x + rect.width, region.x + region.width + margin)
    const y2 = Math.min(rect.y + rect.height, region.y + region.height + margin)
    if (x2 <= x1 || y2 <= y1) continue
    left = Math.min(left, x1)
    top = Math.min(top, y1)
    right = Math.max(right, x2)
    bottom = Math.max(bottom, y2)
  }
  if (!Number.isFinite(left)) return undefined
  const sx = source.width / rect.width
  const sy = source.height / rect.height
  if (![sx, sy].every(Number.isFinite) || sx <= 0 || sy <= 0) return undefined
  const x1 = Math.max(0, Math.floor((left - rect.x) * sx) - 2)
  const y1 = Math.max(0, Math.floor((top - rect.y) * sy) - 2)
  const x2 = Math.min(source.width, Math.ceil((right - rect.x) * sx) + 2)
  const y2 = Math.min(source.height, Math.ceil((bottom - rect.y) * sy) + 2)
  if (![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) return undefined
  const width = Math.min(
    source.width,
    Math.ceil((x2 - x1) / canvasCropAlignment) * canvasCropAlignment
  )
  const height = Math.min(
    source.height,
    Math.ceil((y2 - y1) / canvasCropAlignment) * canvasCropAlignment
  )
  if (
    width <= 0 ||
    height <= 0 ||
    width * height > maxCanvasCropPixels ||
    width * height >= source.width * source.height * 0.75
  )
    return undefined
  return {
    x: Math.max(0, Math.min(x1, source.width - width)),
    y: Math.max(0, Math.min(y1, source.height - height)),
    width,
    height,
  }
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Cannot allocate scene shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const reason = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Cannot compile scene shader: ${reason}`)
  }
  return shader
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  let fragment: WebGLShader | undefined
  let program: WebGLProgram | null = null
  try {
    fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
    program = gl.createProgram()
    if (!program) throw new Error('Cannot allocate scene program')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Cannot link scene program: ${gl.getProgramInfoLog(program)}`)
    }
    return program
  } catch (error) {
    if (program) gl.deleteProgram(program)
    throw error
  } finally {
    gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
  }
}

/** A complete frame is composed on the GPU and presented to this canvas once. */
export function createSceneRenderer(canvas: HTMLCanvasElement): SceneRenderer | null {
  let gl: WebGLRenderingContext | null
  try {
    gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    })
  } catch {
    return null
  }
  if (!gl) return null
  const context = gl
  const textures = new Set<WebGLTexture>()
  const bitmaps = new Map<
    HTMLCanvasElement,
    { texture: WebGLTexture; width: number; height: number }
  >()
  // Only unused, immutable compiler bitmaps count toward these limits. The
  // current scene remains pinned even when it exceeds the cache budget.
  const retainedBitmaps = new Map<HTMLCanvasElement, number>()
  const mutableCanvases = new WeakSet<HTMLCanvasElement>()
  const maxRetainedBytes = 8 * 1024 * 1024
  const maxRetainedCount = 128
  let retainedBytes = 0
  const media = new Map<HTMLVideoElement | HTMLCanvasElement, MediaTexture>()
  let cropCanvases = new Set<HTMLCanvasElement>()
  let mediaStaging:
    | { source: HTMLCanvasElement; canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }
    | undefined
  let program: WebGLProgram | undefined
  let buffer: WebGLBuffer | null = null
  let framebuffer: WebGLFramebuffer | null = null
  let groupFramebuffer: WebGLFramebuffer | null = null
  let scene: GlassScene | null = null
  let disposed = false
  let failed = false
  let studioPass: ReturnType<typeof createStudioPass> | undefined
  let backdropPass: ReturnType<typeof createBackdropPass> | undefined

  const releaseMediaStaging = () => {
    if (!mediaStaging) return
    mediaStaging.canvas.width = 0
    mediaStaging.canvas.height = 0
    mediaStaging = undefined
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    studioPass?.dispose()
    backdropPass?.dispose()
    for (const texture of textures) context.deleteTexture(texture)
    textures.clear()
    bitmaps.clear()
    retainedBitmaps.clear()
    retainedBytes = 0
    for (const entry of media.values()) entry.stop()
    media.clear()
    releaseMediaStaging()
    if (framebuffer) context.deleteFramebuffer(framebuffer)
    if (groupFramebuffer) context.deleteFramebuffer(groupFramebuffer)
    if (buffer) context.deleteBuffer(buffer)
    if (program) context.deleteProgram(program)
    scene = null
  }

  const createTexture = () => {
    const texture = context.createTexture()
    if (!texture) throw new Error('Cannot allocate scene texture')
    textures.add(texture)
    context.activeTexture(context.TEXTURE0)
    context.bindTexture(context.TEXTURE_2D, texture)
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE)
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE)
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR)
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR)
    return texture
  }

  try {
    program = createProgram(context)
    const activeProgram = program
    const position = context.getAttribLocation(activeProgram, 'a_position')
    if (position < 0) throw new Error('Missing scene vertex attribute')
    const uniform = (name: string) => {
      const location = context.getUniformLocation(activeProgram, name)
      if (!location) throw new Error(`Missing scene uniform: ${name}`)
      return location
    }
    const uniforms = {
      source: uniform('u_source'),
      map: uniform('u_map'),
      hasMap: uniform('u_hasMap'),
      hasGroupMask: uniform('u_hasGroupMask'),
      groupMaskRect: uniform('u_groupMaskRect'),
      xChannel: uniform('u_xChannel'),
      yChannel: uniform('u_yChannel'),
      mode: uniform('u_mode'),
      viewport: uniform('u_viewport'),
      texel: uniform('u_texel'),
      rect: uniform('u_rect'),
      color: uniform('u_color'),
      displacement: uniform('u_displacement'),
      radius: uniform('u_radius'),
      blur: uniform('u_blur'),
      pixelRatio: uniform('u_pixelRatio'),
      opacity: uniform('u_opacity'),
      brightness: uniform('u_brightness'),
      saturation: uniform('u_saturation'),
      magnification: uniform('u_magnification'),
      thickness: uniform('u_thickness'),
      clipCount: uniform('u_clipCount'),
      clips: uniform('u_clips[0]'),
      clipShapes: uniform('u_clipShapes[0]'),
      media: uniform('u_media'),
    }
    const maxTextureSize: unknown = context.getParameter(context.MAX_TEXTURE_SIZE)
    if (typeof maxTextureSize !== 'number' || maxTextureSize <= 0) {
      throw new Error('Cannot determine scene texture limit')
    }
    buffer = context.createBuffer()
    framebuffer = context.createFramebuffer()
    if (!buffer || !framebuffer) throw new Error('Cannot allocate scene drawing resources')
    const quadBuffer = buffer
    const sceneFramebuffer = framebuffer
    const sceneTexture = createTexture()
    const snapshotTexture = createTexture()
    context.bindBuffer(context.ARRAY_BUFFER, quadBuffer)
    context.bufferData(
      context.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      context.STATIC_DRAW
    )
    context.disable(context.DEPTH_TEST)
    context.disable(context.CULL_FACE)
    context.disable(context.SCISSOR_TEST)
    context.blendFunc(context.ONE, context.ONE_MINUS_SRC_ALPHA)
    context.activeTexture(context.TEXTURE0)
    let targetWidth = 0
    let targetHeight = 0
    let frameNumber = 0
    let groupTexture: WebGLTexture | undefined
    let groupWidth = 0
    let groupHeight = 0

    const ensureGroupTarget = () => {
      groupFramebuffer ??= context.createFramebuffer()
      groupTexture ??= createTexture()
      if (!groupFramebuffer || !groupTexture) return false
      if (groupWidth === targetWidth && groupHeight === targetHeight) return true
      context.activeTexture(context.TEXTURE0)
      context.bindTexture(context.TEXTURE_2D, groupTexture)
      context.texImage2D(
        context.TEXTURE_2D,
        0,
        context.RGBA,
        targetWidth,
        targetHeight,
        0,
        context.RGBA,
        context.UNSIGNED_BYTE,
        null
      )
      context.bindFramebuffer(context.FRAMEBUFFER, groupFramebuffer)
      context.framebufferTexture2D(
        context.FRAMEBUFFER,
        context.COLOR_ATTACHMENT0,
        context.TEXTURE_2D,
        groupTexture,
        0
      )
      if (
        context.checkFramebufferStatus(context.FRAMEBUFFER) !== context.FRAMEBUFFER_COMPLETE ||
        context.getError() !== context.NO_ERROR
      )
        return false
      groupWidth = targetWidth
      groupHeight = targetHeight
      return true
    }

    const resize = (frame: SceneFrame) => {
      // The hook caps DPR at 2 and the backing buffer at two million pixels.
      // Keep the device's texture-size limit as the final allocation boundary.
      const width = Math.max(1, Math.round(frame.width * frame.pixelRatio))
      const height = Math.max(1, Math.round(frame.height * frame.pixelRatio))
      if (width > maxTextureSize || height > maxTextureSize) return false
      if (
        targetWidth === width &&
        targetHeight === height &&
        canvas.width === width &&
        canvas.height === height
      )
        return true
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      context.activeTexture(context.TEXTURE0)
      for (const texture of [sceneTexture, snapshotTexture]) {
        context.bindTexture(context.TEXTURE_2D, texture)
        context.texImage2D(
          context.TEXTURE_2D,
          0,
          context.RGBA,
          width,
          height,
          0,
          context.RGBA,
          context.UNSIGNED_BYTE,
          null
        )
      }
      context.bindFramebuffer(context.FRAMEBUFFER, sceneFramebuffer)
      context.framebufferTexture2D(
        context.FRAMEBUFFER,
        context.COLOR_ATTACHMENT0,
        context.TEXTURE_2D,
        sceneTexture,
        0
      )
      if (
        context.checkFramebufferStatus(context.FRAMEBUFFER) !== context.FRAMEBUFFER_COMPLETE ||
        context.getError() !== context.NO_ERROR
      )
        return false
      targetWidth = width
      targetHeight = height
      return true
    }

    const deleteBitmap = (bitmap: HTMLCanvasElement) => {
      const entry = bitmaps.get(bitmap)
      if (!entry) return
      const bytes = retainedBitmaps.get(bitmap)
      if (bytes !== undefined) {
        retainedBytes -= bytes
        retainedBitmaps.delete(bitmap)
      }
      context.deleteTexture(entry.texture)
      textures.delete(entry.texture)
      bitmaps.delete(bitmap)
    }

    const upload = (bitmap: HTMLCanvasElement) => {
      if (
        bitmap.width <= 0 ||
        bitmap.height <= 0 ||
        bitmap.width > maxTextureSize ||
        bitmap.height > maxTextureSize
      ) {
        throw new Error('Scene bitmap exceeds texture limits')
      }
      // Compiler snapshots are immutable. A resized canvas must be uploaded
      // again, including when it returned after being retained offscreen.
      const existing = bitmaps.get(bitmap)
      if (bitmap.isConnected) mutableCanvases.add(bitmap)
      if (
        existing &&
        !mutableCanvases.has(bitmap) &&
        existing.width === bitmap.width &&
        existing.height === bitmap.height
      )
        return false
      if (existing) deleteBitmap(bitmap)
      const texture = createTexture()
      bitmaps.set(bitmap, { texture, width: bitmap.width, height: bitmap.height })
      context.activeTexture(context.TEXTURE0)
      context.bindTexture(context.TEXTURE_2D, texture)
      context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, 1)
      context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
      context.texImage2D(
        context.TEXTURE_2D,
        0,
        context.RGBA,
        context.RGBA,
        context.UNSIGNED_BYTE,
        bitmap
      )
      return true
    }

    const drawSprite = (texture: WebGLTexture, rect: SceneRect) => {
      context.uniform1i(uniforms.mode, 0)
      context.uniform4f(uniforms.rect, rect.x, rect.y, rect.width, rect.height)
      context.activeTexture(context.TEXTURE0)
      context.bindTexture(context.TEXTURE_2D, texture)
      context.drawArrays(context.TRIANGLE_STRIP, 0, 4)
    }

    const createMedia = (source: HTMLVideoElement | HTMLCanvasElement): MediaTexture => {
      const entry: MediaTexture = {
        texture: createTexture(),
        width: 0,
        height: 0,
        textureWidth: 0,
        textureHeight: 0,
        crop: undefined,
        revision: 0,
        uploadedRevision: -1,
        time: -1,
        url: '',
        lastFrame: -1,
        lastErrorCheck: -Infinity,
        tracksVideoFrames: false,
        stop: () => {},
      }
      if (source instanceof HTMLVideoElement) {
        let callback: number | undefined
        let active = true
        const changed = () => {
          entry.revision += 1
        }
        const watch = () => {
          if (!active || typeof source.requestVideoFrameCallback !== 'function') return
          callback = source.requestVideoFrameCallback(() => {
            changed()
            watch()
          })
        }
        entry.tracksVideoFrames = typeof source.requestVideoFrameCallback === 'function'
        source.addEventListener('loadeddata', changed)
        source.addEventListener('seeked', changed)
        source.addEventListener('pause', changed)
        source.addEventListener('resize', changed)
        watch()
        entry.stop = () => {
          active = false
          if (callback !== undefined) source.cancelVideoFrameCallback(callback)
          source.removeEventListener('loadeddata', changed)
          source.removeEventListener('seeked', changed)
          source.removeEventListener('pause', changed)
          source.removeEventListener('resize', changed)
        }
      }
      media.set(source, entry)
      return entry
    }

    const uploadMedia = (
      source: HTMLVideoElement | HTMLCanvasElement,
      requestedCrop?: { x: number; y: number; width: number; height: number }
    ): MediaTexture | null => {
      const entry = media.get(source) ?? createMedia(source)
      const video = source instanceof HTMLVideoElement ? source : null
      const width = video ? video.videoWidth : source.width
      const height = video ? video.videoHeight : source.height
      if ((video && video.readyState < 2) || !width || !height) return null
      if (width > maxTextureSize || height > maxTextureSize) {
        throw new Error('Scene media exceeds texture limits')
      }
      if (entry.lastFrame === frameNumber) return entry
      let uploadSource: HTMLCanvasElement | HTMLVideoElement = source
      let crop: typeof requestedCrop
      // The format marker asserts that the owner already created the context.
      // Probing an uninitialized canvas could lock it into the wrong context.
      if (
        requestedCrop &&
        source instanceof HTMLCanvasElement &&
        source.dataset.liquidGlassCanvas === '2d' &&
        source.dataset.liquidGlassCanvasFormat === 'srgb8'
      ) {
        try {
          const sourceContext = source.getContext('2d')
          const attributes = sourceContext?.getContextAttributes?.()
          const colorType = attributes ? Reflect.get(attributes, 'colorType') : undefined
          const unorm8 = colorType === 'unorm8' || colorType === undefined
          if (attributes?.colorSpace === 'srgb' && unorm8) {
            if (!mediaStaging || mediaStaging.source !== source) {
              releaseMediaStaging()
              const canvas = document.createElement('canvas')
              const stagingContext = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb' })
              if (stagingContext?.getContextAttributes?.().colorSpace === 'srgb')
                mediaStaging = { source, canvas, context: stagingContext }
            }
            if (mediaStaging?.source === source) {
              const { canvas, context: stagingContext } = mediaStaging
              if (canvas.width !== requestedCrop.width) canvas.width = requestedCrop.width
              if (canvas.height !== requestedCrop.height) canvas.height = requestedCrop.height
              stagingContext.setTransform(1, 0, 0, 1, 0, 0)
              stagingContext.globalCompositeOperation = 'copy'
              stagingContext.drawImage(
                source,
                requestedCrop.x,
                requestedCrop.y,
                requestedCrop.width,
                requestedCrop.height,
                0,
                0,
                requestedCrop.width,
                requestedCrop.height
              )
              uploadSource = canvas
              crop = requestedCrop
            }
          }
        } catch {
          releaseMediaStaging()
        }
      }
      const uploadWidth = uploadSource === source ? width : uploadSource.width
      const uploadHeight = uploadSource === source ? height : uploadSource.height
      const resized = entry.textureWidth !== uploadWidth || entry.textureHeight !== uploadHeight
      const sourceResized = entry.width !== width || entry.height !== height
      const url = video?.currentSrc ?? ''
      const time = video?.currentTime ?? 0
      const changed =
        !video ||
        resized ||
        url !== entry.url ||
        (video.paused && entry.time !== time) ||
        (entry.tracksVideoFrames ? entry.uploadedRevision !== entry.revision : entry.time !== time)
      if (changed) {
        context.activeTexture(context.TEXTURE0)
        context.bindTexture(context.TEXTURE_2D, entry.texture)
        context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, 1)
        context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
        // Use the browser's video upload path for decoded frames. Video sub-image
        // uploads can be rejected even when dimensions stay unchanged; stable
        // canvas storage supports a sub-image update.
        if (resized || video) {
          context.texImage2D(
            context.TEXTURE_2D,
            0,
            context.RGBA,
            context.RGBA,
            context.UNSIGNED_BYTE,
            uploadSource
          )
        } else {
          context.texSubImage2D(
            context.TEXTURE_2D,
            0,
            0,
            0,
            context.RGBA,
            context.UNSIGNED_BYTE,
            uploadSource
          )
        }
      }
      const now = performance.now()
      // Stable uploads still throw SecurityError for tainted sources. Poll even
      // after playback stops so an unchecked final upload cannot persist forever.
      if (
        (changed && (resized || sourceResized || url !== entry.url)) ||
        now - entry.lastErrorCheck >= 2000
      ) {
        entry.lastErrorCheck = now
        if (context.getError() !== context.NO_ERROR) throw new Error('Cannot upload scene media')
      }
      if (changed) {
        entry.width = width
        entry.height = height
        entry.textureWidth = uploadWidth
        entry.textureHeight = uploadHeight
        entry.crop = crop
        entry.time = time
        entry.url = url
        entry.uploadedRevision = entry.revision
      }
      entry.lastFrame = frameNumber
      return entry
    }

    const setClip = (item: SceneItem, frame: SceneFrame): boolean => {
      context.uniform1f(uniforms.opacity, Math.max(0, Math.min(1, item.opacity)))
      context.uniform1f(uniforms.brightness, item.brightness ?? 1)
      const clips = sceneClips(item)
      if (clips.length > MAX_SCENE_CLIPS) throw new Error('Scene clip stack is too deep')
      context.uniform1i(uniforms.clipCount, clips.length)
      if (!clips.length) {
        context.disable(context.SCISSOR_TEST)
        return true
      }
      const packed = packSceneClips(clips, frame)
      if (!packed) throw new Error('Scene clip stack has invalid geometry')
      const clip = packed.bounds
      const scaleX = targetWidth / frame.width
      const scaleY = targetHeight / frame.height
      const left = Math.max(0, Math.floor(clip.x * scaleX))
      const right = Math.min(targetWidth, Math.ceil((clip.x + clip.width) * scaleX))
      const top = Math.max(0, Math.floor(clip.y * scaleY))
      const bottom = Math.min(targetHeight, Math.ceil((clip.y + clip.height) * scaleY))
      if (right <= left || bottom <= top) return false
      context.enable(context.SCISSOR_TEST)
      context.scissor(left, targetHeight - bottom, right - left, bottom - top)
      context.uniform4fv(uniforms.clips, packed.rects)
      context.uniform2fv(uniforms.clipShapes, packed.shapes)
      return true
    }

    const drawFlat = (
      item: SceneOpacityPaint,
      frame: SceneFrame,
      cropRegions?: readonly SceneRect[],
      cropMargin = 0
    ): boolean => {
      const rect = viewportRect(item.rect, item.space, frame)
      if (
        item.opacity <= 0 ||
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.x >= frame.width ||
        rect.y >= frame.height ||
        rect.x + rect.width <= 0 ||
        rect.y + rect.height <= 0
      )
        return true
      if (!setClip(item, frame)) return true
      if (item.kind === 'sprite') {
        const texture = bitmaps.get(item.bitmap)?.texture
        if (!texture) return false
        drawSprite(texture, rect)
        return true
      }
      context.uniform4f(uniforms.rect, rect.x, rect.y, rect.width, rect.height)
      context.uniform1f(uniforms.radius, item.radius)
      if (item.kind === 'media') {
        const crop =
          cropRegions &&
          item.source instanceof HTMLCanvasElement &&
          cropCanvases.size === 1 &&
          cropCanvases.has(item.source)
            ? canvasCrop(item.source, rect, cropRegions, cropMargin)
            : undefined
        const entry = uploadMedia(item.source, crop)
        if (!entry) return true
        let width = rect.width
        let height = rect.height
        if (item.fit !== 'fill') {
          const scale =
            item.fit === 'cover'
              ? Math.max(rect.width / entry.width, rect.height / entry.height)
              : Math.min(rect.width / entry.width, rect.height / entry.height)
          width = entry.width * scale
          height = entry.height * scale
        }
        context.uniform1i(uniforms.mode, 3)
        if (entry.crop) {
          context.uniform4f(
            uniforms.media,
            entry.crop.x / entry.width,
            entry.crop.y / entry.height,
            entry.crop.width / entry.width,
            entry.crop.height / entry.height
          )
        } else {
          context.uniform4f(
            uniforms.media,
            ((rect.width - width) * item.position[0]) / rect.width,
            ((rect.height - height) * item.position[1]) / rect.height,
            width / rect.width,
            height / rect.height
          )
        }
        context.bindTexture(context.TEXTURE_2D, entry.texture)
      } else {
        context.uniform1i(uniforms.mode, 1)
        context.uniform4f(uniforms.color, ...item.color)
      }
      context.drawArrays(context.TRIANGLE_STRIP, 0, 4)
      return true
    }

    return {
      setScene(nextScene) {
        if (disposed || failed || context.isContextLost()) {
          throw new Error('Scene renderer is unavailable')
        }
        scene = null
        try {
          const nextBitmaps = new Set<HTMLCanvasElement>()
          const nextMedia = new Set<HTMLVideoElement | HTMLCanvasElement>()
          const canvasUses = new Map<HTMLCanvasElement, { count: number; eligible: boolean }>()
          for (const item of nextScene.items) {
            if (item.kind === 'opacity-group' && item.mask) nextBitmaps.add(item.mask.bitmap)
            const paints = item.kind === 'opacity-group' ? item.items : [item]
            for (const paint of paints) {
              if (paint.kind === 'sprite' || paint.kind === 'backdrop')
                nextBitmaps.add(paint.bitmap)
              if (paint.kind === 'media') {
                nextMedia.add(paint.source)
                if (paint.source instanceof HTMLCanvasElement) {
                  const previous = canvasUses.get(paint.source)
                  canvasUses.set(paint.source, {
                    count: (previous?.count ?? 0) + 1,
                    eligible: item.kind !== 'opacity-group' && paint.fit === 'fill',
                  })
                }
              }
              if (paint.kind === 'glass' && paint.map) nextBitmaps.add(paint.map.bitmap)
            }
          }
          if (mediaStaging && !nextMedia.has(mediaStaging.source)) releaseMediaStaging()
          // Application canvases are dynamic. Never retain a snapshot texture
          // for a canvas while that same element is a live media source.
          for (const source of nextMedia) {
            if (source instanceof HTMLCanvasElement) {
              mutableCanvases.add(source)
              deleteBitmap(source)
            }
          }
          for (const bitmap of nextBitmaps) {
            const bytes = retainedBitmaps.get(bitmap)
            if (bytes === undefined) continue
            retainedBytes -= bytes
            retainedBitmaps.delete(bitmap)
          }
          for (const [bitmap, entry] of bitmaps) {
            if (nextBitmaps.has(bitmap)) continue
            if (bitmap.isConnected) mutableCanvases.add(bitmap)
            if (
              mutableCanvases.has(bitmap) ||
              bitmap.width !== entry.width ||
              bitmap.height !== entry.height
            ) {
              deleteBitmap(bitmap)
              continue
            }
            if (retainedBitmaps.has(bitmap)) continue
            const bytes = entry.width * entry.height * 4
            retainedBitmaps.set(bitmap, bytes)
            retainedBytes += bytes
          }
          while (retainedBytes > maxRetainedBytes || retainedBitmaps.size > maxRetainedCount) {
            const oldest = retainedBitmaps.keys().next().value
            if (!oldest) break
            deleteBitmap(oldest)
          }
          let uploadedBitmaps = false
          for (const bitmap of nextBitmaps) {
            if (upload(bitmap)) uploadedBitmaps = true
          }
          if (uploadedBitmaps && context.getError() !== context.NO_ERROR)
            throw new Error('Cannot upload scene bitmaps')
          for (const source of nextMedia) {
            if (!media.has(source)) createMedia(source)
          }
          for (const [source, entry] of media) {
            if (nextMedia.has(source)) continue
            entry.stop()
            context.deleteTexture(entry.texture)
            textures.delete(entry.texture)
            media.delete(source)
          }
          cropCanvases = new Set(
            Array.from(canvasUses, ([source, use]) =>
              use.count === 1 && use.eligible ? source : null
            ).filter((source): source is HTMLCanvasElement => source !== null)
          )
          scene = nextScene
        } catch (error) {
          failed = true
          throw error
        }
      },
      render(frame) {
        if (
          disposed ||
          failed ||
          !scene ||
          context.isContextLost() ||
          frame.width <= 0 ||
          frame.height <= 0 ||
          frame.pixelRatio <= 0
        )
          return false
        try {
          if (!resize(frame)) {
            failed = true
            return false
          }
          frameNumber += 1
          context.useProgram(activeProgram)
          context.bindBuffer(context.ARRAY_BUFFER, quadBuffer)
          context.enableVertexAttribArray(position)
          context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0)
          context.activeTexture(context.TEXTURE0)
          context.uniform1i(uniforms.source, 0)
          context.uniform1i(uniforms.map, 1)
          context.uniform1i(uniforms.hasGroupMask, 0)
          context.uniform2f(uniforms.viewport, frame.width, frame.height)
          context.uniform2f(uniforms.texel, 1 / targetWidth, 1 / targetHeight)
          context.uniform1f(
            uniforms.pixelRatio,
            Math.min(targetWidth / frame.width, targetHeight / frame.height)
          )
          context.viewport(0, 0, targetWidth, targetHeight)
          context.bindFramebuffer(context.FRAMEBUFFER, sceneFramebuffer)
          context.disable(context.SCISSOR_TEST)
          context.disable(context.BLEND)
          context.clearColor(...scene.background)
          context.clear(context.COLOR_BUFFER_BIT)
          // The previous presentation sampled sceneTexture. Rebind a safe source
          // before drawing into that texture, including when the first item is solid.
          context.activeTexture(context.TEXTURE1)
          context.bindTexture(context.TEXTURE_2D, snapshotTexture)
          context.activeTexture(context.TEXTURE0)
          context.bindTexture(context.TEXTURE_2D, snapshotTexture)
          const viewport = { x: 0, y: 0, width: frame.width, height: frame.height }
          context.enable(context.BLEND)
          const backdropProof = scene.samplingRegion
            ? proveBackdropSampling({
                items: scene.items,
                frame,
                samplingRegion: scene.samplingRegion,
                ...(scene.samplingRegions ? { samplingRegions: scene.samplingRegions } : {}),
                targetWidth,
                targetHeight,
              })
            : null

          // Prefer this frame's proven dependencies over the compiler's wider
          // capture window. Invalid regions or shadowed Studio panes keep the
          // existing conservative path because their paint can extend farther.
          const renderRegions = backdropProof?.sourceRegions ?? scene.renderRegions
          const cullOutsideRegions = Boolean(
            validSamplingRegion(scene.samplingRegion) &&
            renderRegions?.length &&
            renderRegions.every(validSamplingRegion) &&
            Number.isFinite(frame.height) &&
            Number.isFinite(frame.pixelRatio) &&
            !scene.items.some((item) => {
              const paints = item.kind === 'opacity-group' ? item.items : [item]
              return paints.some(
                (paint) => paint.kind === 'glass' && paint.studio && paint.studio.shadowFactor !== 0
              )
            })
          )
          // A Studio pane's antialiased boundary can extend slightly beyond
          // its rectangle. The extra margin also covers backing-buffer rounding.
          const regionMargin = Math.max(1, frame.height * 0.001 + 1 / frame.pixelRatio)

          for (const item of scene.items) {
            const rect = viewportRect(item.rect, item.space, frame)
            const groupBoundsSafe =
              item.kind !== 'opacity-group' ||
              item.items.every((child) => {
                const outer = item.rect
                const inner = child.rect
                return (
                  child.space === item.space &&
                  [
                    outer.x,
                    outer.y,
                    outer.width,
                    outer.height,
                    inner.x,
                    inner.y,
                    inner.width,
                    inner.height,
                  ].every(Number.isFinite) &&
                  outer.width > 0 &&
                  outer.height > 0 &&
                  inner.width > 0 &&
                  inner.height > 0 &&
                  inner.x >= outer.x &&
                  inner.y >= outer.y &&
                  inner.x + inner.width <= outer.x + outer.width &&
                  inner.y + inner.height <= outer.y + outer.height
                )
              })
            if (
              cullOutsideRegions &&
              groupBoundsSafe &&
              samplingRelationToRegions(
                {
                  x: rect.x - regionMargin,
                  y: rect.y - regionMargin,
                  width: rect.width + regionMargin * 2,
                  height: rect.height + regionMargin * 2,
                },
                renderRegions
              ) === 'outside'
            )
              continue
            if (
              item.kind === 'glass' &&
              item.studio &&
              item.opacity > 0 &&
              rect.width > 0 &&
              rect.height > 0
            ) {
              const shadow =
                item.studio.shadowFactor > 0
                  ? item.studio.shadowExpand * 6 +
                    Math.max(
                      Math.abs(item.studio.shadowPosition.x),
                      Math.abs(item.studio.shadowPosition.y)
                    )
                  : 0
              const padding = shadow + frame.height * 0.001 + 2
              if (
                rect.x - padding >= frame.width ||
                rect.y - padding >= frame.height ||
                rect.x + rect.width + padding <= 0 ||
                rect.y + rect.height + padding <= 0
              )
                continue
              studioPass ??= createStudioPass(context, snapshotTexture)
              if (
                !studioPass.render(
                  { ...item, studio: item.studio },
                  rect,
                  frame,
                  sceneFramebuffer,
                  targetWidth,
                  targetHeight
                )
              )
                return false
              // Studio uses separate surface/blur programs. Restore the shared
              // quad state before ordinary content or the final presentation.
              context.useProgram(activeProgram)
              context.bindBuffer(context.ARRAY_BUFFER, quadBuffer)
              context.enableVertexAttribArray(position)
              context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0)
              context.viewport(0, 0, targetWidth, targetHeight)
              context.bindFramebuffer(context.FRAMEBUFFER, sceneFramebuffer)
              context.blendEquation(context.FUNC_ADD)
              context.blendFunc(context.ONE, context.ONE_MINUS_SRC_ALPHA)
              context.enable(context.BLEND)
              continue
            }
            if (
              item.opacity <= 0 ||
              rect.width <= 0 ||
              rect.height <= 0 ||
              rect.x >= frame.width ||
              rect.y >= frame.height ||
              rect.x + rect.width <= 0 ||
              rect.y + rect.height <= 0
            )
              continue
            if (item.kind === 'backdrop') {
              if (backdropProof && !backdropProof.needed.has(item)) continue
              const mask = bitmaps.get(item.bitmap)?.texture
              if (!mask) return false
              backdropPass ??= createBackdropPass(context, snapshotTexture)
              if (
                !backdropPass.render({
                  rect,
                  frame,
                  framebuffer: sceneFramebuffer,
                  targetWidth,
                  targetHeight,
                  maxTextureSize,
                  sigma: item.sigma,
                  saturation: item.filterSaturation ?? 1,
                  brightness: item.filterBrightness ?? 1,
                  mask,
                  clips: sceneClips(item),
                  radius: item.radius,
                  opacity: item.opacity,
                  allowPartial: Boolean(backdropProof),
                  outputRegion: backdropProof?.outputRegions.get(item),
                })
              )
                return false
              context.useProgram(activeProgram)
              context.bindBuffer(context.ARRAY_BUFFER, quadBuffer)
              context.enableVertexAttribArray(position)
              context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0)
              context.viewport(0, 0, targetWidth, targetHeight)
              context.bindFramebuffer(context.FRAMEBUFFER, sceneFramebuffer)
              context.blendEquation(context.FUNC_ADD)
              context.blendFunc(context.ONE, context.ONE_MINUS_SRC_ALPHA)
              context.enable(context.BLEND)
              context.activeTexture(context.TEXTURE0)
              continue
            }
            if (item.kind === 'opacity-group') {
              // A Studio lens reads the already painted scene outside this
              // group. Its composited result is faded exactly once with the
              // controls drawn into the same transparent target.
              const first = item.items[0]
              if (
                (first?.kind === 'glass' || first?.kind === 'backdrop') &&
                scene.background[3] !== 1
              )
                return false
              if (!ensureGroupTarget() || !groupFramebuffer || !groupTexture) return false
              // Group bounds include every child paint. Clear a small padded
              // rectangle when that invariant is known, otherwise retain the
              // conservative full-frame clear. Padding covers the Studio SDF
              // fringe and bilinear samples at the cleared texture boundary.
              const scaleX = targetWidth / frame.width
              const scaleY = targetHeight / frame.height
              const ratio = Math.min(scaleX, scaleY)
              const padding = frame.height * 0.001 + 3 / ratio
              const bounded =
                groupBoundsSafe &&
                [rect.x, rect.y, rect.width, rect.height, scaleX, scaleY, padding].every(
                  Number.isFinite
                ) &&
                scaleX > 0 &&
                scaleY > 0 &&
                rect.width > 0 &&
                rect.height > 0
              const groupBounds = bounded
                ? {
                    left: Math.max(0, Math.floor((rect.x - padding) * scaleX)),
                    right: Math.min(
                      targetWidth,
                      Math.ceil((rect.x + rect.width + padding) * scaleX)
                    ),
                    top: Math.max(0, Math.floor((rect.y - padding) * scaleY)),
                    bottom: Math.min(
                      targetHeight,
                      Math.ceil((rect.y + rect.height + padding) * scaleY)
                    ),
                  }
                : undefined
              context.bindFramebuffer(context.FRAMEBUFFER, groupFramebuffer)
              if (
                groupBounds &&
                groupBounds.right > groupBounds.left &&
                groupBounds.bottom > groupBounds.top
              ) {
                context.enable(context.SCISSOR_TEST)
                context.scissor(
                  groupBounds.left,
                  targetHeight - groupBounds.bottom,
                  groupBounds.right - groupBounds.left,
                  groupBounds.bottom - groupBounds.top
                )
              } else context.disable(context.SCISSOR_TEST)
              context.clearColor(0, 0, 0, 0)
              context.clear(context.COLOR_BUFFER_BIT)
              // The group texture is attached to the active framebuffer. It
              // must not remain bound as a source while painting its children.
              context.activeTexture(context.TEXTURE0)
              context.bindTexture(context.TEXTURE_2D, snapshotTexture)
              for (const [index, child] of item.items.entries()) {
                if (child.kind === 'glass') {
                  if (index !== 0 || !child.studio || child.studio.shadowFactor !== 0) return false
                  const childRect = viewportRect(child.rect, child.space, frame)
                  studioPass ??= createStudioPass(context, snapshotTexture)
                  if (
                    !studioPass.render(
                      { ...child, studio: child.studio },
                      childRect,
                      frame,
                      groupFramebuffer,
                      targetWidth,
                      targetHeight,
                      sceneFramebuffer
                    )
                  )
                    return false
                  context.useProgram(activeProgram)
                  context.bindBuffer(context.ARRAY_BUFFER, quadBuffer)
                  context.enableVertexAttribArray(position)
                  context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0)
                  context.viewport(0, 0, targetWidth, targetHeight)
                  context.bindFramebuffer(context.FRAMEBUFFER, groupFramebuffer)
                  context.blendEquation(context.FUNC_ADD)
                  context.blendFunc(context.ONE, context.ONE_MINUS_SRC_ALPHA)
                  context.enable(context.BLEND)
                  context.activeTexture(context.TEXTURE0)
                } else if (child.kind === 'backdrop') {
                  if (index !== 0) return false
                  if (backdropProof && !backdropProof.needed.has(child)) continue
                  const mask = bitmaps.get(child.bitmap)?.texture
                  if (!mask) return false
                  backdropPass ??= createBackdropPass(context, snapshotTexture)
                  if (
                    !backdropPass.render({
                      rect: viewportRect(child.rect, child.space, frame),
                      frame,
                      framebuffer: groupFramebuffer,
                      sourceFramebuffer: sceneFramebuffer,
                      foregroundOnly: true,
                      targetWidth,
                      targetHeight,
                      maxTextureSize,
                      sigma: child.sigma,
                      saturation: child.filterSaturation ?? 1,
                      brightness: child.filterBrightness ?? 1,
                      mask,
                      clips: sceneClips(child),
                      radius: child.radius,
                      opacity: child.opacity,
                      allowPartial: Boolean(backdropProof),
                      outputRegion: backdropProof?.outputRegions.get(child),
                    })
                  )
                    return false
                  context.useProgram(activeProgram)
                  context.bindBuffer(context.ARRAY_BUFFER, quadBuffer)
                  context.enableVertexAttribArray(position)
                  context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0)
                  context.viewport(0, 0, targetWidth, targetHeight)
                  context.bindFramebuffer(context.FRAMEBUFFER, groupFramebuffer)
                  context.blendEquation(context.FUNC_ADD)
                  context.blendFunc(context.ONE, context.ONE_MINUS_SRC_ALPHA)
                  context.enable(context.BLEND)
                  context.activeTexture(context.TEXTURE0)
                } else if (!drawFlat(child, frame)) return false
              }
              context.bindFramebuffer(context.FRAMEBUFFER, sceneFramebuffer)
              if (setClip(item, frame)) {
                if (item.mask) {
                  const mask = bitmaps.get(item.mask.bitmap)?.texture
                  if (!mask) return false
                  const maskRect = viewportRect(item.mask.rect, item.mask.space, frame)
                  if (maskRect.width <= 0 || maskRect.height <= 0) return false
                  context.activeTexture(context.TEXTURE1)
                  context.bindTexture(context.TEXTURE_2D, mask)
                  context.uniform4f(
                    uniforms.groupMaskRect,
                    maskRect.x,
                    maskRect.y,
                    maskRect.width,
                    maskRect.height
                  )
                  context.uniform1i(uniforms.hasGroupMask, 1)
                }
                if (groupBounds) {
                  const clips = sceneClips(item)
                  const packed = clips.length ? packSceneClips(clips, frame) : undefined
                  if (clips.length && !packed)
                    throw new Error('Scene clip stack has invalid geometry')
                  const bounds = packed?.bounds
                  const left = Math.max(
                    groupBounds.left,
                    bounds ? Math.floor(bounds.x * scaleX) : 0
                  )
                  const right = Math.min(
                    groupBounds.right,
                    bounds ? Math.ceil((bounds.x + bounds.width) * scaleX) : targetWidth
                  )
                  const top = Math.max(groupBounds.top, bounds ? Math.floor(bounds.y * scaleY) : 0)
                  const bottom = Math.min(
                    groupBounds.bottom,
                    bounds ? Math.ceil((bounds.y + bounds.height) * scaleY) : targetHeight
                  )
                  if (right > left && bottom > top) {
                    context.enable(context.SCISSOR_TEST)
                    context.scissor(left, targetHeight - bottom, right - left, bottom - top)
                    drawSprite(groupTexture, viewport)
                  }
                } else drawSprite(groupTexture, viewport)
                if (item.mask) context.uniform1i(uniforms.hasGroupMask, 0)
              }
              continue
            }
            if (item.kind === 'sprite' || item.kind === 'media' || item.kind === 'solid') {
              if (
                !drawFlat(
                  item,
                  frame,
                  backdropProof && cullOutsideRegions ? backdropProof.sourceRegions : undefined,
                  regionMargin + 3
                )
              )
                return false
              continue
            }
            if (!setClip(item, frame)) continue
            context.uniform4f(uniforms.rect, rect.x, rect.y, rect.width, rect.height)
            context.uniform1f(uniforms.radius, item.radius)
            {
              // Copy only the glass sampling area on the GPU. The attached scene
              // texture is never sampled while that framebuffer is being drawn.
              // The shader keeps refraction samples within the rounded pane.
              // Only blur taps and bilinear filtering need pixels beyond it.
              const apron = Math.max(0, item.blur) + 2
              const scaleX = targetWidth / frame.width
              const scaleY = targetHeight / frame.height
              const left = Math.max(0, Math.floor((rect.x - apron) * scaleX))
              const right = Math.min(targetWidth, Math.ceil((rect.x + rect.width + apron) * scaleX))
              const top = Math.max(0, Math.floor((rect.y - apron) * scaleY))
              const bottom = Math.min(
                targetHeight,
                Math.ceil((rect.y + rect.height + apron) * scaleY)
              )
              const copyY = targetHeight - bottom
              context.activeTexture(context.TEXTURE0)
              context.bindTexture(context.TEXTURE_2D, snapshotTexture)
              context.copyTexSubImage2D(
                context.TEXTURE_2D,
                0,
                left,
                copyY,
                left,
                copyY,
                right - left,
                bottom - top
              )
              context.uniform1i(uniforms.mode, 2)
              context.uniform1i(uniforms.hasMap, item.map ? 1 : 0)
              if (item.map) {
                const mapTexture = bitmaps.get(item.map.bitmap)?.texture
                if (!mapTexture) return false
                context.activeTexture(context.TEXTURE1)
                context.bindTexture(context.TEXTURE_2D, mapTexture)
                context.activeTexture(context.TEXTURE0)
                context.uniform1i(uniforms.xChannel, item.map.xChannel)
                context.uniform1i(uniforms.yChannel, item.map.yChannel)
              }
              context.uniform3f(uniforms.displacement, ...item.displacement)
              context.uniform1f(uniforms.blur, Math.max(0, item.blur))
              context.uniform1f(uniforms.saturation, Math.max(0, item.saturation))
              const magnification = item.magnification ?? 1
              context.uniform1f(
                uniforms.magnification,
                Number.isFinite(magnification) ? Math.max(1, Math.min(2, magnification)) : 1
              )
              const thickness = item.thickness
              context.uniform1f(
                uniforms.thickness,
                thickness === undefined
                  ? -1
                  : Math.min(
                      80,
                      rect.width * 0.5,
                      rect.height * 0.5,
                      Math.max(0, Number.isFinite(thickness) ? thickness : 20)
                    )
              )
              context.uniform4f(uniforms.color, ...item.tint)
            }
            context.drawArrays(context.TRIANGLE_STRIP, 0, 4)
          }

          context.bindFramebuffer(context.FRAMEBUFFER, null)
          context.disable(context.BLEND)
          context.disable(context.SCISSOR_TEST)
          context.uniform1i(uniforms.clipCount, 0)
          context.uniform1f(uniforms.opacity, 1)
          context.uniform1f(uniforms.brightness, 1)
          drawSprite(sceneTexture, viewport)
          return !context.isContextLost()
        } catch {
          failed = true
          return false
        }
      },
      dispose,
    }
  } catch {
    dispose()
    return null
  }
}
