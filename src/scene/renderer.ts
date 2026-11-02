import type { GlassScene, SceneFrame, SceneItem, SceneRect, SceneRenderer } from './types'
import { createStudioPass } from './studio-pass'
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
    gl_FragColor = texture2D(u_source, vec2(v_local.x, 1.0 - v_local.y)) * clipCoverage;
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
    gl_FragColor = texture2D(u_source, vec2(uv.x, 1.0 - uv.y)) * coverage;
    return;
  }

  if (u_mode == 1) {
    float alpha = u_color.a * coverage;
    gl_FragColor = vec4(u_color.rgb * alpha, alpha);
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
  revision: number
  uploadedRevision: number
  time: number
  url: string
  lastFrame: number
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
  const bitmaps = new Map<HTMLCanvasElement, WebGLTexture>()
  const media = new Map<HTMLVideoElement | HTMLCanvasElement, MediaTexture>()
  let program: WebGLProgram | undefined
  let buffer: WebGLBuffer | null = null
  let framebuffer: WebGLFramebuffer | null = null
  let scene: GlassScene | null = null
  let disposed = false
  let failed = false
  let studioPass: ReturnType<typeof createStudioPass> | undefined

  const dispose = () => {
    if (disposed) return
    disposed = true
    studioPass?.dispose()
    for (const texture of textures) context.deleteTexture(texture)
    textures.clear()
    bitmaps.clear()
    for (const entry of media.values()) entry.stop()
    media.clear()
    if (framebuffer) context.deleteFramebuffer(framebuffer)
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

    const resize = (frame: SceneFrame) => {
      // The hook caps DPR at 2 and the backing buffer at two million pixels.
      // Keep the device's texture-size limit as the final allocation boundary.
      const width = Math.max(1, Math.round(frame.width * frame.pixelRatio))
      const height = Math.max(1, Math.round(frame.height * frame.pixelRatio))
      if (width > maxTextureSize || height > maxTextureSize) return false
      if (targetWidth === width && targetHeight === height) return true
      canvas.width = width
      canvas.height = height
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

    const upload = (bitmap: HTMLCanvasElement) => {
      // Scene bitmaps are immutable; layout/focus changes can reuse their GPU copy.
      if (bitmaps.has(bitmap)) return
      if (
        bitmap.width <= 0 ||
        bitmap.height <= 0 ||
        bitmap.width > maxTextureSize ||
        bitmap.height > maxTextureSize
      ) {
        throw new Error('Scene bitmap exceeds texture limits')
      }
      const texture = createTexture()
      bitmaps.set(bitmap, texture)
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
        revision: 0,
        uploadedRevision: -1,
        time: -1,
        url: '',
        lastFrame: -1,
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
        source.addEventListener('resize', changed)
        watch()
        entry.stop = () => {
          active = false
          if (callback !== undefined) source.cancelVideoFrameCallback(callback)
          source.removeEventListener('loadeddata', changed)
          source.removeEventListener('seeked', changed)
          source.removeEventListener('resize', changed)
        }
      }
      media.set(source, entry)
      return entry
    }

    const uploadMedia = (source: HTMLVideoElement | HTMLCanvasElement): MediaTexture | null => {
      const entry = media.get(source) ?? createMedia(source)
      const video = source instanceof HTMLVideoElement ? source : null
      const width = video ? video.videoWidth : source.width
      const height = video ? video.videoHeight : source.height
      if ((video && video.readyState < 2) || !width || !height) return null
      if (width > maxTextureSize || height > maxTextureSize) {
        throw new Error('Scene media exceeds texture limits')
      }
      if (entry.lastFrame === frameNumber) return entry
      const resized = entry.width !== width || entry.height !== height
      const url = video?.currentSrc ?? ''
      const time = video?.currentTime ?? 0
      const changed =
        !video ||
        resized ||
        url !== entry.url ||
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
            source
          )
        } else {
          context.texSubImage2D(
            context.TEXTURE_2D,
            0,
            0,
            0,
            context.RGBA,
            context.UNSIGNED_BYTE,
            source
          )
        }
        if (context.getError() !== context.NO_ERROR) throw new Error('Cannot upload scene media')
        entry.width = width
        entry.height = height
        entry.time = time
        entry.url = url
        entry.uploadedRevision = entry.revision
      }
      entry.lastFrame = frameNumber
      return entry
    }

    const setClip = (item: SceneItem, frame: SceneFrame): boolean => {
      context.uniform1f(uniforms.opacity, Math.max(0, Math.min(1, item.opacity)))
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

    return {
      setScene(nextScene) {
        if (disposed || failed || context.isContextLost()) {
          throw new Error('Scene renderer is unavailable')
        }
        scene = null
        try {
          const nextBitmaps = new Set<HTMLCanvasElement>()
          const nextMedia = new Set<HTMLVideoElement | HTMLCanvasElement>()
          for (const item of nextScene.items) {
            if (item.kind === 'sprite') nextBitmaps.add(item.bitmap)
            if (item.kind === 'media') nextMedia.add(item.source)
            if (item.kind === 'glass' && item.map) nextBitmaps.add(item.map.bitmap)
          }
          for (const bitmap of nextBitmaps) upload(bitmap)
          if (context.getError() !== context.NO_ERROR)
            throw new Error('Cannot upload scene bitmaps')
          for (const [bitmap, texture] of bitmaps) {
            if (nextBitmaps.has(bitmap)) continue
            context.deleteTexture(texture)
            textures.delete(texture)
            bitmaps.delete(bitmap)
          }
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

          for (const item of scene.items) {
            const rect = viewportRect(item.rect, item.space, frame)
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
            if (!setClip(item, frame)) continue
            if (item.kind === 'sprite') {
              const texture = bitmaps.get(item.bitmap)
              if (!texture) return false
              drawSprite(texture, rect)
              continue
            }

            context.uniform4f(uniforms.rect, rect.x, rect.y, rect.width, rect.height)
            context.uniform1f(uniforms.radius, item.radius)
            if (item.kind === 'media') {
              const entry = uploadMedia(item.source)
              if (!entry) continue
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
              context.uniform4f(
                uniforms.media,
                ((rect.width - width) * item.position[0]) / rect.width,
                ((rect.height - height) * item.position[1]) / rect.height,
                width / rect.width,
                height / rect.height
              )
              context.bindTexture(context.TEXTURE_2D, entry.texture)
            } else if (item.kind === 'solid') {
              context.uniform1i(uniforms.mode, 1)
              context.uniform4f(uniforms.color, ...item.color)
            } else {
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
                const mapTexture = bitmaps.get(item.map.bitmap)
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
