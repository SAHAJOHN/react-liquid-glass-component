import type { SceneClip, SceneFrame, SceneRect } from './types'
import { MAX_SCENE_CLIPS, packSceneClips } from './clip-stack'
import { studioSdfSource, studioVertexSource } from './studio-shader'

interface Program {
  value: WebGLProgram
  position: number
  uniform(name: string): WebGLUniformLocation
}

interface CachedKernel {
  texture: WebGLTexture
  center: number
  normalization: number
  count: number
}

const MAX_KERNEL_TEXTURES = 32

export function backdropStorageHeight(w: number, h: number, maxTextureSize: number): number {
  const padded = Math.ceil((h + 128) / 128) * 128
  return Number.isFinite(maxTextureSize) && padded <= maxTextureSize && w * padded <= 2_000_000
    ? padded
    : h
}

export interface BackdropPassInput {
  /** Element border box in viewport CSS pixels. */
  rect: SceneRect
  frame: SceneFrame
  framebuffer: WebGLFramebuffer
  targetWidth: number
  targetHeight: number
  maxTextureSize?: number
  /** CSS blur standard deviation, in CSS pixels. */
  sigma: number
  /** CSS saturate multiplier following blur. Defaults to one. */
  saturation?: number
  /** CSS brightness multiplier following saturation. Defaults to one. */
  brightness?: number
  /** Alpha texture in the element's local coordinates; uploaded with Y flipped. */
  mask: WebGLTexture
  clips: readonly SceneClip[]
  radius: number
  opacity: number
  /** Only set after the glass-only sampling proof approves this backdrop. */
  allowPartial?: boolean
  /** Proven required backdrop output, in viewport CSS pixels. */
  outputRegion?: SceneRect | undefined
  /** Read from a separate opaque scene, writing only the filtered foreground. */
  sourceFramebuffer?: WebGLFramebuffer
  foregroundOnly?: boolean
}

const blurFragment = (capacity: boolean) => `
precision highp float;
uniform sampler2D u_source;
uniform sampler2D u_kernel;
uniform vec2 u_viewport;
${capacity ? 'uniform vec4 u_sampling;' : 'uniform vec2 u_texel;\nuniform vec2 u_direction;'}
uniform vec4 u_bounds;
uniform float u_center;
uniform float u_normalization;
uniform int u_count;
varying vec2 v_screen;
float mirrorCoord(float value, float low, float high) {
  float size = high - low;
  if (size <= 0.0) return low;
  float local = mod(value - low, size * 2.0);
  return low + (local <= size ? local : size * 2.0 - local);
}
vec4 sampleAt(vec2 uv) {
  vec2 mirrored = vec2(mirrorCoord(uv.x, u_bounds.x, u_bounds.z),
                       mirrorCoord(uv.y, u_bounds.y, u_bounds.w));
  ${capacity ? 'return texture2D(u_source, clamp(mirrored, u_sampling.xy * 0.5, 1.0 - u_sampling.xy * 0.5) * vec2(1.0, u_sampling.w));' : 'return texture2D(u_source, clamp(mirrored, u_texel * 0.5, 1.0 - u_texel * 0.5));'}
}
void main() {
  vec2 uv = vec2(v_screen.x / u_viewport.x, 1.0 - v_screen.y / u_viewport.y);
  ${capacity ? 'vec2 direction = mix(vec2(u_sampling.x, 0.0), vec2(0.0, u_sampling.y), u_sampling.z);' : 'vec2 direction = u_direction;'}
  vec4 color = sampleAt(uv) * u_center;
  for (int i = 0; i < 100; i++) {
    if (i >= u_count) break;
    vec4 encoded = texture2D(u_kernel, vec2((float(i) + 0.5) / 100.0, 0.5));
    vec2 pair = vec2(dot(encoded.rg, vec2(256.0, 1.0)) * 200.0 / 257.0,
                     dot(encoded.ba, vec2(256.0, 1.0)) / 257.0);
    color += (sampleAt(uv + direction * pair.x) + sampleAt(uv - direction * pair.x)) * pair.y;
  }
  gl_FragColor = color * u_normalization;
}
`

const compositeFragment = (capacity: boolean) => `
precision highp float;
uniform sampler2D u_original;
uniform sampler2D u_blurred;
uniform sampler2D u_mask;
uniform vec2 u_viewport;
uniform vec4 ${capacity ? 'u_rect' : 'u_box'};
uniform float u_radius;
${capacity ? 'uniform vec2 u_ratioScale;' : 'uniform float u_ratio;'}
uniform float u_opacity;
uniform float u_saturation;
uniform float u_brightness;
uniform bool u_foregroundOnly;
uniform int u_clipCount;
uniform vec4 u_clips[${MAX_SCENE_CLIPS}];
uniform vec2 u_clipShapes[${MAX_SCENE_CLIPS}];
varying vec2 v_screen;
${studioSdfSource}
float coverage(vec2 point, vec2 size, float radius, float roundness) {
  float distance = studioSdf(point, size, radius, roundness);
  float aa = 0.75 / ${capacity ? 'u_ratioScale.x' : 'u_ratio'};
  return 1.0 - smoothstep(-aa, aa, distance);
}
void main() {
  vec2 local = (v_screen - ${capacity ? 'u_rect' : 'u_box'}.xy) / ${capacity ? 'u_rect' : 'u_box'}.zw;
  if (any(lessThan(local, vec2(0.0))) || any(greaterThan(local, vec2(1.0)))) discard;
  float amount = texture2D(u_mask, vec2(local.x, 1.0 - local.y)).a * u_opacity;
  amount *= coverage(v_screen - ${capacity ? 'u_rect' : 'u_box'}.xy, ${capacity ? 'u_rect' : 'u_box'}.zw, u_radius, 2.0);
  for (int i = 0; i < ${MAX_SCENE_CLIPS}; i++) {
    if (i < u_clipCount) {
      amount *= coverage(v_screen - u_clips[i].xy, u_clips[i].zw,
                         u_clipShapes[i].x, u_clipShapes[i].y);
    }
  }
  vec2 uv = vec2(v_screen.x / u_viewport.x, 1.0 - v_screen.y / u_viewport.y);
  vec4 original = texture2D(u_original, uv);
  vec4 blurred = texture2D(u_blurred, ${capacity ? 'uv * vec2(1.0, u_ratioScale.y)' : 'uv'});
  float luminance = dot(blurred.rgb, vec3(0.213, 0.715, 0.072));
  blurred.rgb = clamp(mix(vec3(luminance), blurred.rgb, u_saturation), 0.0, blurred.a);
  blurred.rgb = clamp(blurred.rgb * u_brightness, 0.0, blurred.a);
  vec4 foreground = blurred * amount;
  gl_FragColor = u_foregroundOnly ? foreground : foreground + original * (1.0 - foreground.a);
}
`

class BackdropShaderError extends Error {}

function program(gl: WebGLRenderingContext, fragment: string): Program {
  const value = gl.createProgram()
  const shaders: WebGLShader[] = []
  if (!value) throw new Error('Cannot allocate backdrop program')
  try {
    for (const [type, source] of [
      [gl.VERTEX_SHADER, studioVertexSource],
      [gl.FRAGMENT_SHADER, fragment],
    ] as const) {
      const shader = gl.createShader(type)
      if (!shader) throw new Error('Cannot allocate backdrop shader')
      shaders.push(shader)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new BackdropShaderError(
          gl.getShaderInfoLog(shader) ?? 'Backdrop shader compilation failed'
        )
      gl.attachShader(value, shader)
    }
    gl.linkProgram(value)
    if (!gl.getProgramParameter(value, gl.LINK_STATUS))
      throw new BackdropShaderError(gl.getProgramInfoLog(value) ?? 'Backdrop program link failed')
    const position = gl.getAttribLocation(value, 'a_position')
    if (position < 0) throw new BackdropShaderError('Missing backdrop position attribute')
    return {
      value,
      position,
      uniform(name) {
        const location = gl.getUniformLocation(value, name)
        if (!location) throw new BackdropShaderError(`Missing backdrop uniform ${name}`)
        return location
      },
    }
  } catch (error) {
    gl.deleteProgram(value)
    throw error
  } finally {
    shaders.forEach((shader) => gl.deleteShader(shader))
  }
}

/** Produces normalized bilinear tap pairs, packed for WebGL 1 devices without float textures. */
function kernel(sigma: number) {
  if (sigma === 0) return { center: 1, data: new Uint8Array(400), count: 0, normalization: 1 }
  const radius = Math.ceil(sigma * 3)
  if (radius > 200) return null
  const weights: number[] = []
  let sum = 0
  for (let i = 0; i <= radius; i += 1) {
    const weight = i === 0 ? 1 : Math.exp((-0.5 * i * i) / (sigma * sigma))
    weights.push(weight)
    sum += i === 0 ? weight : 2 * weight
  }
  const center = 1 / sum
  const data = new Uint8Array(400)
  let packedSum = center
  let count = 0
  for (let i = 1; i <= radius; i += 2) {
    const a = weights[i] ?? 0
    const b = weights[i + 1] ?? 0
    if (a + b === 0) continue
    const offset = Math.round(((i + b / (a + b)) / 200) * 65535)
    const weight = Math.round(((a + b) / sum) * 65535)
    data[count * 4] = offset >> 8
    data[count * 4 + 1] = offset & 255
    data[count * 4 + 2] = weight >> 8
    data[count * 4 + 3] = weight & 255
    packedSum += (2 * weight) / 65535
    count += 1
  }
  return { center, data, count, normalization: 1 / packedSum }
}

/** One pass per scene. Caller must restore its program, buffer, viewport and blend state. */
export function createBackdropPass(gl: WebGLRenderingContext, snapshot: WebGLTexture) {
  const programs: WebGLProgram[] = []
  const textures = new Set<WebGLTexture>()
  const kernels = new Map<number, CachedKernel>()
  const framebuffers: WebGLFramebuffer[] = []
  let quad: WebGLBuffer | null = null
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    programs.forEach((value) => gl.deleteProgram(value))
    textures.forEach((value) => gl.deleteTexture(value))
    textures.clear()
    kernels.clear()
    framebuffers.forEach((value) => gl.deleteFramebuffer(value))
    if (quad) gl.deleteBuffer(quad)
  }
  try {
    const createPipeline = (capacity: boolean) => {
      const created: WebGLProgram[] = []
      try {
        const blur = program(gl, blurFragment(capacity))
        created.push(blur.value)
        const composite = program(gl, compositeFragment(capacity))
        created.push(composite.value)
        const blurCommon = {
          viewport: blur.uniform('u_viewport'),
          rect: blur.uniform('u_rect'),
          source: blur.uniform('u_source'),
          kernel: blur.uniform('u_kernel'),
          bounds: blur.uniform('u_bounds'),
          center: blur.uniform('u_center'),
          normalization: blur.uniform('u_normalization'),
          count: blur.uniform('u_count'),
        }
        const compositeCommon = {
          viewport: composite.uniform('u_viewport'),
          rect: composite.uniform('u_rect'),
          original: composite.uniform('u_original'),
          blurred: composite.uniform('u_blurred'),
          mask: composite.uniform('u_mask'),
          radius: composite.uniform('u_radius'),
          opacity: composite.uniform('u_opacity'),
          saturation: composite.uniform('u_saturation'),
          brightness: composite.uniform('u_brightness'),
          foregroundOnly: composite.uniform('u_foregroundOnly'),
          clipCount: composite.uniform('u_clipCount'),
          clips: composite.uniform('u_clips[0]'),
          clipShapes: composite.uniform('u_clipShapes[0]'),
        }
        const bu = capacity
          ? { ...blurCommon, kind: 'capacity' as const, sampling: blur.uniform('u_sampling') }
          : {
              ...blurCommon,
              kind: 'legacy' as const,
              texel: blur.uniform('u_texel'),
              direction: blur.uniform('u_direction'),
            }
        const cu = capacity
          ? {
              ...compositeCommon,
              kind: 'capacity' as const,
              ratioScale: composite.uniform('u_ratioScale'),
            }
          : {
              ...compositeCommon,
              kind: 'legacy' as const,
              box: composite.uniform('u_box'),
              ratio: composite.uniform('u_ratio'),
            }
        return { blur, composite, bu, cu }
      } catch (error) {
        created.forEach((value) => gl.deleteProgram(value))
        throw error
      }
    }
    const uniformLimit: unknown = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)
    let pipeline
    if (typeof uniformLimit === 'number' && Number.isFinite(uniformLimit) && uniformLimit > 16) {
      try {
        pipeline = createPipeline(true)
      } catch (error) {
        if (!(error instanceof BackdropShaderError) || gl.isContextLost()) throw error
        pipeline = createPipeline(false)
      }
    } else pipeline = createPipeline(false)
    const { blur, composite, bu, cu } = pipeline
    programs.push(blur.value, composite.value)
    quad = gl.createBuffer()
    if (!quad) throw new Error('Cannot allocate backdrop quad')
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    const texture = (linear: boolean) => {
      const value = gl.createTexture()
      if (!value) throw new Error('Cannot allocate backdrop texture')
      textures.add(value)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, value)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST)
      return value
    }
    const target = () => {
      const image = texture(true)
      const framebuffer = gl.createFramebuffer()
      if (!framebuffer) throw new Error('Cannot allocate backdrop framebuffer')
      framebuffers.push(framebuffer)
      return { image, framebuffer }
    }
    const horizontal = target()
    const vertical = target()
    let width = 0
    let height = 0
    let storageWidth = 0
    let storageHeight = 0
    let reserveDisabled = bu.kind === 'legacy'
    let validated = new WeakMap<
      WebGLTexture,
      WeakMap<WebGLFramebuffer, WeakSet<WebGLFramebuffer>>
    >()
    let lastErrorCheck = -Infinity
    const resize = (w: number, h: number, allowReserve: boolean, maxTextureSize: number) => {
      if (width === w && height === h && (allowReserve || storageHeight === h)) return
      if (
        storageWidth !== w ||
        h > storageHeight ||
        storageHeight - h > 256 ||
        (!allowReserve && storageHeight !== h)
      ) {
        let nextHeight =
          allowReserve && !reserveDisabled ? backdropStorageHeight(w, h, maxTextureSize) : h
        const allocate = (height: number) => {
          for (const target of [horizontal, vertical]) {
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, target.image)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
            gl.framebufferTexture2D(
              gl.FRAMEBUFFER,
              gl.COLOR_ATTACHMENT0,
              gl.TEXTURE_2D,
              target.image,
              0
            )
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
              throw new Error('Backdrop framebuffer is incomplete')
          }
        }
        if (nextHeight > h) {
          if (gl.getError() !== gl.NO_ERROR) throw new Error('Backdrop had a prior WebGL error')
          try {
            allocate(nextHeight)
            if (gl.getError() !== gl.NO_ERROR) throw new Error('Backdrop reserve allocation failed')
          } catch (error) {
            if (gl.isContextLost()) throw error
            let cleared = false
            for (let index = 0; index < 16; index += 1) {
              if (gl.getError() === gl.NO_ERROR) {
                cleared = true
                break
              }
            }
            if (!cleared || gl.isContextLost()) throw error
            reserveDisabled = true
            nextHeight = h
            allocate(h)
            if (gl.getError() !== gl.NO_ERROR) throw new Error('Backdrop allocation failed')
          }
        } else {
          allocate(h)
        }
        storageWidth = w
        storageHeight = nextHeight
      }
      width = w
      height = h
      validated = new WeakMap()
    }
    const bind = (value: Program) => {
      gl.useProgram(value.value)
      gl.bindBuffer(gl.ARRAY_BUFFER, quad)
      gl.enableVertexAttribArray(value.position)
      gl.vertexAttribPointer(value.position, 2, gl.FLOAT, false, 0, 0)
    }
    return {
      dispose,
      render(input: BackdropPassInput): boolean {
        const {
          rect,
          frame,
          framebuffer,
          targetWidth,
          targetHeight,
          maxTextureSize = 0,
          sigma,
          saturation = 1,
          brightness = 1,
          mask,
          clips,
          radius,
          opacity,
          allowPartial,
          outputRegion,
          sourceFramebuffer,
          foregroundOnly = false,
        } = input
        if (disposed || gl.isContextLost()) return false
        if (foregroundOnly !== Boolean(sourceFramebuffer && sourceFramebuffer !== framebuffer))
          return false
        if (
          ![
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            frame.width,
            frame.height,
            targetWidth,
            targetHeight,
            sigma,
            saturation,
            brightness,
            radius,
            opacity,
          ].every(Number.isFinite) ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          frame.width <= 0 ||
          frame.height <= 0 ||
          targetWidth <= 0 ||
          targetHeight <= 0 ||
          sigma < 0 ||
          saturation < 0 ||
          saturation > 4 ||
          brightness < 0 ||
          brightness > 4 ||
          radius < 0 ||
          opacity < 0 ||
          opacity > 1
        )
          return false
        if (!opacity) return true
        if (
          rect.x + rect.width <= 0 ||
          rect.y + rect.height <= 0 ||
          rect.x >= frame.width ||
          rect.y >= frame.height
        )
          return true
        // A clipped snapshot cannot faithfully mirror the part of a border
        // box outside the viewport. Preserve HTML instead of mirroring at the
        // viewport edge, which would produce a different filter result.
        if (
          !allowPartial &&
          (rect.x < 0 ||
            rect.y < 0 ||
            rect.x + rect.width > frame.width ||
            rect.y + rect.height > frame.height)
        )
          return false
        const ratioX = targetWidth / frame.width
        const ratioY = targetHeight / frame.height
        const horizontalSigma = sigma * ratioX
        const verticalSigma = sigma * ratioY
        const packed = packSceneClips(clips, frame)
        if (
          !Number.isFinite(horizontalSigma) ||
          !Number.isFinite(verticalSigma) ||
          Math.ceil(3 * horizontalSigma) > 200 ||
          Math.ceil(3 * verticalSigma) > 200 ||
          !packed
        )
          return false
        const left = Math.max(0, Math.floor(rect.x * ratioX))
        const right = Math.min(targetWidth, Math.ceil((rect.x + rect.width) * ratioX))
        const top = Math.max(0, Math.floor(rect.y * ratioY))
        const bottom = Math.min(targetHeight, Math.ceil((rect.y + rect.height) * ratioY))
        if (right <= left || bottom <= top) return true
        // Invalid optional bounds disable the optimization rather than clipping
        // potentially needed pixels. The original element bounds still define
        // the shader's mirror edges and the source snapshot.
        let outputLeft = left
        let outputRight = right
        let outputTop = top
        let outputBottom = bottom
        if (
          outputRegion &&
          [
            outputRegion.x,
            outputRegion.y,
            outputRegion.width,
            outputRegion.height,
            outputRegion.x + outputRegion.width,
            outputRegion.y + outputRegion.height,
          ].every(Number.isFinite) &&
          outputRegion.width > 0 &&
          outputRegion.height > 0
        ) {
          outputLeft = Math.max(left, Math.floor(outputRegion.x * ratioX) - 2)
          outputRight = Math.min(
            right,
            Math.ceil((outputRegion.x + outputRegion.width) * ratioX) + 2
          )
          outputTop = Math.max(top, Math.floor(outputRegion.y * ratioY) - 2)
          outputBottom = Math.min(
            bottom,
            Math.ceil((outputRegion.y + outputRegion.height) * ratioY) + 2
          )
          if (outputRight <= outputLeft || outputBottom <= outputTop) return true
        }
        resize(
          targetWidth,
          targetHeight,
          frame.pixelRatio === 1 &&
            Number.isInteger(frame.width) &&
            Number.isInteger(frame.height) &&
            targetWidth === frame.width &&
            targetHeight === frame.height,
          maxTextureSize
        )
        gl.viewport(0, 0, width, height)
        gl.disable(gl.BLEND)
        gl.enable(gl.SCISSOR_TEST)
        gl.scissor(left, height - bottom, right - left, bottom - top)
        gl.bindFramebuffer(gl.FRAMEBUFFER, sourceFramebuffer ?? framebuffer)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, snapshot)
        gl.copyTexSubImage2D(
          gl.TEXTURE_2D,
          0,
          left,
          height - bottom,
          left,
          height - bottom,
          right - left,
          bottom - top
        )
        bind(blur)
        gl.uniform2f(bu.viewport, frame.width, frame.height)
        gl.uniform4f(bu.rect, rect.x, rect.y, rect.width, rect.height)
        gl.uniform1i(bu.source, 0)
        gl.uniform1i(bu.kernel, 1)
        if (bu.kind === 'capacity') gl.uniform4f(bu.sampling, 1 / width, 1 / height, 0, 1)
        else {
          gl.uniform2f(bu.texel, 1 / width, 1 / height)
          gl.uniform2f(bu.direction, 1 / width, 0)
        }
        gl.uniform4f(
          bu.bounds,
          (left + 0.5) / width,
          (height - bottom + 0.5) / height,
          (right - 0.5) / width,
          (height - top - 0.5) / height
        )
        const createdKernels: Array<[number, CachedKernel]> = []
        const forgetKernel = (key: number, entry: CachedKernel) => {
          kernels.delete(key)
          textures.delete(entry.texture)
          gl.deleteTexture(entry.texture)
        }
        const setKernel = (effectiveSigma: number) => {
          let cached = kernels.get(effectiveSigma)
          if (cached) {
            kernels.delete(effectiveSigma)
            kernels.set(effectiveSigma, cached)
          } else {
            const weights = kernel(effectiveSigma)
            if (!weights) throw new Error('Backdrop kernel exceeds shader capacity')
            const image = texture(false)
            try {
              gl.activeTexture(gl.TEXTURE1)
              gl.bindTexture(gl.TEXTURE_2D, image)
              const previousPremultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) ? 1 : 0
              const previousFlip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) ? 1 : 0
              const colorConversion: unknown = gl.getParameter(
                gl.UNPACK_COLORSPACE_CONVERSION_WEBGL
              )
              gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
              gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
              gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
              try {
                gl.texImage2D(
                  gl.TEXTURE_2D,
                  0,
                  gl.RGBA,
                  100,
                  1,
                  0,
                  gl.RGBA,
                  gl.UNSIGNED_BYTE,
                  weights.data
                )
              } finally {
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, previousPremultiply)
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, previousFlip)
                gl.pixelStorei(
                  gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
                  typeof colorConversion === 'number' ? colorConversion : gl.BROWSER_DEFAULT_WEBGL
                )
              }
            } catch (error) {
              textures.delete(image)
              gl.deleteTexture(image)
              throw error
            }
            cached = {
              texture: image,
              center: weights.center,
              normalization: weights.normalization,
              count: weights.count,
            }
            if (kernels.size >= MAX_KERNEL_TEXTURES) {
              const oldest = kernels.entries().next().value
              if (oldest) forgetKernel(oldest[0], oldest[1])
            }
            kernels.set(effectiveSigma, cached)
            createdKernels.push([effectiveSigma, cached])
          }
          gl.activeTexture(gl.TEXTURE1)
          gl.bindTexture(gl.TEXTURE_2D, cached.texture)
          gl.uniform1f(bu.center, cached.center)
          gl.uniform1f(bu.normalization, cached.normalization)
          gl.uniform1i(bu.count, cached.count)
          gl.activeTexture(gl.TEXTURE0)
        }
        setKernel(horizontalSigma)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, snapshot)
        gl.bindFramebuffer(gl.FRAMEBUFFER, horizontal.framebuffer)
        const horizontalLeft = Math.max(left, outputLeft - 2)
        const horizontalRight = Math.min(right, outputRight + 2)
        const verticalPadding = Math.ceil(3 * sigma * ratioY) + 2
        const horizontalTop = Math.max(top, outputTop - verticalPadding)
        const horizontalBottom = Math.min(bottom, outputBottom + verticalPadding)
        gl.scissor(
          horizontalLeft,
          height - horizontalBottom,
          horizontalRight - horizontalLeft,
          horizontalBottom - horizontalTop
        )
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        setKernel(verticalSigma)
        gl.bindTexture(gl.TEXTURE_2D, horizontal.image)
        gl.bindFramebuffer(gl.FRAMEBUFFER, vertical.framebuffer)
        if (bu.kind === 'capacity')
          gl.uniform4f(bu.sampling, 1 / width, 1 / height, 1, height / storageHeight)
        else gl.uniform2f(bu.direction, 0, 1 / height)
        gl.scissor(
          outputLeft,
          height - outputBottom,
          outputRight - outputLeft,
          outputBottom - outputTop
        )
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        bind(composite)
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
        gl.uniform2f(cu.viewport, frame.width, frame.height)
        gl.uniform4f(cu.rect, rect.x, rect.y, rect.width, rect.height)
        if (cu.kind === 'legacy') gl.uniform4f(cu.box, rect.x, rect.y, rect.width, rect.height)
        gl.uniform1f(cu.radius, radius)
        if (cu.kind === 'capacity')
          gl.uniform2f(cu.ratioScale, Math.min(ratioX, ratioY), height / storageHeight)
        else gl.uniform1f(cu.ratio, Math.min(ratioX, ratioY))
        gl.uniform1f(cu.opacity, opacity)
        gl.uniform1f(cu.saturation, saturation)
        gl.uniform1f(cu.brightness, brightness)
        gl.uniform1i(cu.foregroundOnly, foregroundOnly ? 1 : 0)
        gl.uniform1i(cu.clipCount, clips.length)
        if (clips.length) {
          gl.uniform4fv(cu.clips, packed.rects)
          gl.uniform2fv(cu.clipShapes, packed.shapes)
        }
        gl.uniform1i(cu.original, 0)
        gl.uniform1i(cu.blurred, 1)
        gl.uniform1i(cu.mask, 2)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, snapshot)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, vertical.image)
        gl.activeTexture(gl.TEXTURE2)
        gl.bindTexture(gl.TEXTURE_2D, mask)
        gl.scissor(
          outputLeft,
          height - outputBottom,
          outputRight - outputLeft,
          outputBottom - outputTop
        )
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        gl.activeTexture(gl.TEXTURE0)
        const discardCreatedKernels = () => {
          for (const [key, entry] of createdKernels) {
            if (kernels.get(key) === entry) forgetKernel(key, entry)
          }
        }
        if (gl.isContextLost()) {
          discardCreatedKernels()
          return false
        }
        const source = sourceFramebuffer ?? framebuffer
        const targets = validated.get(mask)
        const sources = targets?.get(framebuffer)
        const now = performance.now()
        if (createdKernels.length || !sources?.has(source) || now - lastErrorCheck >= 2000) {
          // getError synchronizes with the GPU. Check new resources and sample
          // recurring errors periodically instead of stalling every layer.
          lastErrorCheck = now
          if (gl.getError() !== gl.NO_ERROR) {
            discardCreatedKernels()
            sources?.delete(source)
            return false
          }
          const checkedTargets = targets ?? new WeakMap()
          const checkedSources = sources ?? new WeakSet()
          checkedSources.add(source)
          checkedTargets.set(framebuffer, checkedSources)
          validated.set(mask, checkedTargets)
        }
        return true
      },
    }
  } catch (error) {
    dispose()
    throw error
  }
}
