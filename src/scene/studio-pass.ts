import type { SceneFrame, SceneItem, SceneRect } from './types'
import { studioBlurFragmentSource, studioFragmentSource, studioVertexSource } from './studio-shader'

type StudioItem = Extract<SceneItem, { kind: 'glass' }> & {
  studio: NonNullable<Extract<SceneItem, { kind: 'glass' }>['studio']>
}
interface Program {
  value: WebGLProgram
  position: number
  uniform(name: string): WebGLUniformLocation
}
interface PixelRegion {
  left: number
  top: number
  right: number
  bottom: number
}

function program(gl: WebGLRenderingContext, fragmentSource: string): Program {
  const shaders: WebGLShader[] = []
  const value = gl.createProgram()
  if (!value) throw new Error('Cannot allocate Studio program')
  try {
    for (const [type, source] of [
      [gl.VERTEX_SHADER, studioVertexSource],
      [gl.FRAGMENT_SHADER, fragmentSource],
    ] as const) {
      const shader = gl.createShader(type)
      if (!shader) throw new Error('Cannot allocate Studio shader')
      shaders.push(shader)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader) ?? 'Studio shader compilation failed')
      gl.attachShader(value, shader)
    }
    gl.linkProgram(value)
    if (!gl.getProgramParameter(value, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(value) ?? 'Studio program link failed')
    const position = gl.getAttribLocation(value, 'a_position')
    if (position < 0) throw new Error('Missing Studio position attribute')
    return {
      value,
      position,
      uniform(name) {
        const location = gl.getUniformLocation(value, name)
        if (!location) throw new Error(`Missing Studio uniform ${name}`)
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

function kernel(radius: number) {
  const weights: number[] = []
  const sigma = radius / 3
  let sum = 0
  for (let index = 0; index <= radius; index += 1) {
    const weight = radius === 0 ? 1 : Math.exp((-0.5 * index * index) / (sigma * sigma))
    weights.push(weight)
    sum += index === 0 ? weight : 2 * weight
  }
  const pairs = new Float32Array(200)
  let count = 0
  for (let index = 1; index <= radius; index += 2) {
    const a = weights[index] ?? 0
    const b = weights[index + 1] ?? 0
    pairs[count * 2] = index + b / (a + b)
    pairs[count * 2 + 1] = (a + b) / sum
    count += 1
  }
  return { center: (weights[0] ?? 1) / sum, pairs, count }
}

/** One reusable Studio pipeline per scene, independent of the number of panes. */
export function createStudioPass(gl: WebGLRenderingContext, snapshot: WebGLTexture) {
  const programs: WebGLProgram[] = []
  const textures: WebGLTexture[] = []
  const framebuffers: WebGLFramebuffer[] = []
  let buffer: WebGLBuffer | null = null
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    programs.forEach((value) => gl.deleteProgram(value))
    textures.forEach((value) => gl.deleteTexture(value))
    framebuffers.forEach((value) => gl.deleteFramebuffer(value))
    if (buffer) gl.deleteBuffer(buffer)
  }
  try {
    const uniformLimit: unknown = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)
    if (typeof uniformLimit !== 'number' || uniformLimit < 16) {
      throw new Error('Studio rendering needs the WebGL minimum fragment uniform budget')
    }
    const surface = program(gl, studioFragmentSource)
    programs.push(surface.value)
    const blur = program(gl, studioBlurFragmentSource)
    programs.push(blur.value)
    const surfaceUniform = {
      viewport: surface.uniform('u_viewport'),
      rect: surface.uniform('u_rect'),
      lens: surface.uniform('u_lens'),
      source: surface.uniform('u_source'),
      blurred: surface.uniform('u_blurred'),
      shape: surface.uniform('u_shape'),
      refraction: surface.uniform('u_refraction'),
      fresnel: surface.uniform('u_fresnel'),
      glare: surface.uniform('u_glare'),
      glareDirection: surface.uniform('u_glareDirection'),
      tint: surface.uniform('u_tint'),
      shadow: surface.uniform('u_shadow'),
      info: surface.uniform('u_surfaceInfo'),
      flags: surface.uniform('u_flags'),
      clip: surface.uniform('u_clip'),
      clipShape: surface.uniform('u_clipShape'),
    }
    const blurUniform = {
      viewport: blur.uniform('u_viewport'),
      rect: blur.uniform('u_rect'),
      source: blur.uniform('u_source'),
      kernelTexture: blur.uniform('u_kernelTexture'),
      kernelPacked: blur.uniform('u_kernelPacked'),
      direction: blur.uniform('u_direction'),
      bounds: blur.uniform('u_bounds'),
      center: blur.uniform('u_center'),
      normalization: blur.uniform('u_normalization'),
      count: blur.uniform('u_count'),
    }
    buffer = gl.createBuffer()
    if (!buffer) throw new Error('Cannot allocate Studio quad')
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    const target = () => {
      const texture = gl.createTexture()
      const framebuffer = gl.createFramebuffer()
      if (texture) textures.push(texture)
      if (framebuffer) framebuffers.push(framebuffer)
      if (!texture || !framebuffer) throw new Error('Cannot allocate Studio blur target')
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      return { texture, framebuffer }
    }
    const horizontal = target(),
      vertical = target()
    const floatKernels = Boolean(gl.getExtension('OES_texture_float'))
    const kernels = new Map<
      number,
      { texture: WebGLTexture; center: number; normalization: number; count: number }
    >()
    const getKernel = (radius: number) => {
      const cached = kernels.get(radius)
      if (cached) return cached
      const weights = kernel(radius)
      const texture = gl.createTexture()
      if (!texture) throw new Error('Cannot allocate Studio kernel texture')
      textures.push(texture)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      // The kernel is indexed, not interpolated; floating-point linear filtering
      // is not required even when the device supports float texture storage.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      let normalization = 1
      // These texels encode numbers, not premultiplied/color-managed image data.
      const previousPremultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) ? 1 : 0
      const previousFlip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) ? 1 : 0
      const colorConversion: unknown = gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
      try {
        if (floatKernels) {
          const data = new Float32Array(400)
          for (let i = 0; i < weights.count; i += 1) {
            data[i * 4] = weights.pairs[i * 2] ?? 0
            data[i * 4 + 1] = weights.pairs[i * 2 + 1] ?? 0
            data[i * 4 + 3] = 1
          }
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 100, 1, 0, gl.RGBA, gl.FLOAT, data)
        } else {
          const data = new Uint8Array(400)
          let sum = weights.center
          for (let i = 0; i < weights.count; i += 1) {
            const offset = Math.round(((weights.pairs[i * 2] ?? 0) / 200) * 65535)
            const weight = Math.round((weights.pairs[i * 2 + 1] ?? 0) * 65535)
            data[i * 4] = offset >> 8
            data[i * 4 + 1] = offset & 255
            data[i * 4 + 2] = weight >> 8
            data[i * 4 + 3] = weight & 255
            sum += (2 * weight) / 65535
          }
          normalization = 1 / sum
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 100, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
        }
        if (gl.getError() !== gl.NO_ERROR) throw new Error('Cannot upload Studio kernel texture')
      } finally {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, previousPremultiply)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, previousFlip)
        gl.pixelStorei(
          gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
          typeof colorConversion === 'number' ? colorConversion : gl.BROWSER_DEFAULT_WEBGL
        )
        gl.activeTexture(gl.TEXTURE0)
      }
      const entry = { texture, center: weights.center, normalization, count: weights.count }
      kernels.set(radius, entry)
      return entry
    }
    let width = 0,
      height = 0,
      lastRadius = -1
    const resize = (nextWidth: number, nextHeight: number) => {
      if (width === nextWidth && height === nextHeight) return
      for (const item of [horizontal, vertical]) {
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, item.texture)
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          nextWidth,
          nextHeight,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          null
        )
        gl.bindFramebuffer(gl.FRAMEBUFFER, item.framebuffer)
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          item.texture,
          0
        )
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
          throw new Error('Studio blur framebuffer is incomplete')
      }
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Cannot allocate Studio blur storage')
      width = nextWidth
      height = nextHeight
    }
    const bind = (value: Program) => {
      gl.useProgram(value.value)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.enableVertexAttribArray(value.position)
      gl.vertexAttribPointer(value.position, 2, gl.FLOAT, false, 0, 0)
    }
    const scissor = (region: PixelRegion) => {
      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(
        region.left,
        height - region.bottom,
        region.right - region.left,
        region.bottom - region.top
      )
    }
    const pixels = (rect: SceneRect, frame: SceneFrame): PixelRegion => ({
      left: Math.max(0, Math.floor((rect.x * width) / frame.width)),
      top: Math.max(0, Math.floor((rect.y * height) / frame.height)),
      right: Math.min(width, Math.ceil(((rect.x + rect.width) * width) / frame.width)),
      bottom: Math.min(height, Math.ceil(((rect.y + rect.height) * height) / frame.height)),
    })
    const cssRect = (region: PixelRegion, frame: SceneFrame): SceneRect => ({
      x: (region.left * frame.width) / width,
      y: (region.top * frame.height) / height,
      width: ((region.right - region.left) * frame.width) / width,
      height: ((region.bottom - region.top) * frame.height) / height,
    })
    const draw = (location: WebGLUniformLocation, rect: SceneRect) => {
      gl.uniform4f(location, rect.x, rect.y, rect.width, rect.height)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    return {
      dispose,
      render(
        item: StudioItem,
        rect: SceneRect,
        frame: SceneFrame,
        sceneFramebuffer: WebGLFramebuffer,
        targetWidth: number,
        targetHeight: number
      ) {
        if (disposed || gl.isContextLost()) return false
        resize(targetWidth, targetHeight)
        const settings = item.studio
        const ratio = Math.min(width / frame.width, height / frame.height)
        const referenceDpr = frame.devicePixelRatio ?? frame.pixelRatio
        const shadowExtent =
          settings.shadowFactor > 0
            ? settings.shadowExpand * 6 +
              Math.max(Math.abs(settings.shadowPosition.x), Math.abs(settings.shadowPosition.y))
            : 0
        const aa = frame.height * 0.001 + 1 / ratio
        const outer = pixels(
          {
            x: rect.x - shadowExtent - aa,
            y: rect.y - shadowExtent - aa,
            width: rect.width + 2 * (shadowExtent + aa),
            height: rect.height + 2 * (shadowExtent + aa),
          },
          frame
        )
        if (outer.right <= outer.left || outer.bottom <= outer.top) return true
        bind(surface)
        gl.viewport(0, 0, width, height)
        gl.uniform2f(surfaceUniform.viewport, frame.width, frame.height)
        gl.uniform4f(surfaceUniform.lens, rect.x, rect.y, rect.width, rect.height)
        gl.uniform2f(
          surfaceUniform.shape,
          (Math.min(rect.width, rect.height) * 0.5 * settings.shapeRadius) / 100,
          settings.shapeRoundness
        )
        gl.uniform4f(
          surfaceUniform.refraction,
          settings.refThickness,
          settings.refDistance,
          settings.refFactor,
          settings.refDispersion
        )
        gl.uniform3f(
          surfaceUniform.fresnel,
          settings.refFresnelRange,
          settings.refFresnelHardness / 100,
          settings.refFresnelFactor / 100
        )
        gl.uniform4f(
          surfaceUniform.glare,
          settings.glareRange,
          settings.glareHardness / 100,
          settings.glareFactor / 100,
          settings.glareConvergence / 100
        )
        gl.uniform2f(
          surfaceUniform.glareDirection,
          settings.glareOppositeFactor / 100,
          (settings.glareAngle * Math.PI) / 180
        )
        gl.uniform4f(
          surfaceUniform.tint,
          settings.tint.r / 255,
          settings.tint.g / 255,
          settings.tint.b / 255,
          settings.tint.a
        )
        gl.uniform4f(
          surfaceUniform.shadow,
          settings.shadowExpand,
          settings.shadowFactor / 100,
          settings.shadowPosition.x,
          settings.shadowPosition.y
        )
        gl.uniform4f(
          surfaceUniform.info,
          referenceDpr,
          Math.max(0, Math.min(1, item.opacity)),
          Math.max(1, Math.min(2, item.magnification ?? 1)),
          ratio
        )
        gl.uniform3f(surfaceUniform.flags, settings.blurEdge ? 1 : 0, 0, item.clip ? 1 : 0)
        gl.uniform1i(surfaceUniform.source, 0)
        gl.uniform1i(surfaceUniform.blurred, 1)
        if (item.clip) {
          const clip = item.clip
          gl.uniform4f(
            surfaceUniform.clip,
            clip.rect.x - (clip.space === 'document' ? frame.scrollX : 0),
            clip.rect.y - (clip.space === 'document' ? frame.scrollY : 0),
            clip.rect.width,
            clip.rect.height
          )
          gl.uniform2f(surfaceUniform.clipShape, clip.radius, clip.roundness ?? 2)
        }
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, snapshot)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, vertical.texture)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFramebuffer)
        if (settings.shadowFactor > 0) {
          scissor(outer)
          gl.uniform3f(surfaceUniform.flags, settings.blurEdge ? 1 : 0, 1, item.clip ? 1 : 0)
          gl.enable(gl.BLEND)
          gl.blendEquationSeparate(gl.FUNC_REVERSE_SUBTRACT, gl.FUNC_ADD)
          gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE)
          draw(surfaceUniform.rect, cssRect(outer, frame))
        }
        gl.blendEquation(gl.FUNC_ADD)
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
        gl.disable(gl.BLEND)

        const radius = Number.isFinite(settings.blurRadius)
          ? Math.max(0, Math.min(200, Math.round(settings.blurRadius)))
          : 1
        // The SDF's component gradients are bounded by one. This covers the
        // reference's largest grazing-angle offset, dispersion and Gaussian taps.
        const shift =
          1.414213562 *
          1000 *
          settings.refDistance *
          Math.sqrt(Math.max(0, settings.refFactor * settings.refFactor - 1)) *
          (1 + 0.02 * settings.refDispersion)
        const apron = shift + radius / ratio + aa + 2
        const region = pixels(
          {
            x: rect.x - apron,
            y: rect.y - apron,
            width: rect.width + 2 * apron,
            height: rect.height + 2 * apron,
          },
          frame
        )
        if (region.right <= region.left || region.bottom <= region.top) return true
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, snapshot)
        gl.copyTexSubImage2D(
          gl.TEXTURE_2D,
          0,
          region.left,
          height - region.bottom,
          region.left,
          height - region.bottom,
          region.right - region.left,
          region.bottom - region.top
        )
        bind(blur)
        gl.uniform1i(blurUniform.source, 0)
        gl.uniform1i(blurUniform.kernelTexture, 1)
        gl.uniform1i(blurUniform.kernelPacked, floatKernels ? 0 : 1)
        gl.uniform2f(blurUniform.viewport, frame.width, frame.height)
        gl.uniform4f(
          blurUniform.bounds,
          (region.left + 0.5) / width,
          (height - region.bottom + 0.5) / height,
          (region.right - 0.5) / width,
          (height - region.top - 0.5) / height
        )
        const weights = getKernel(radius)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, weights.texture)
        gl.activeTexture(gl.TEXTURE0)
        if (lastRadius !== radius) {
          gl.uniform1f(blurUniform.center, weights.center)
          gl.uniform1i(blurUniform.count, weights.count)
          gl.uniform1f(blurUniform.normalization, weights.normalization)
          lastRadius = radius
        }
        scissor(region)
        const bounds = cssRect(region, frame)
        gl.bindFramebuffer(gl.FRAMEBUFFER, horizontal.framebuffer)
        gl.bindTexture(gl.TEXTURE_2D, snapshot)
        gl.uniform2f(blurUniform.direction, 1 / width, 0)
        draw(blurUniform.rect, bounds)
        gl.bindFramebuffer(gl.FRAMEBUFFER, vertical.framebuffer)
        gl.bindTexture(gl.TEXTURE_2D, horizontal.texture)
        gl.uniform2f(blurUniform.direction, 0, 1 / height)
        draw(blurUniform.rect, bounds)

        bind(surface)
        gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFramebuffer)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, snapshot)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, vertical.texture)
        gl.activeTexture(gl.TEXTURE0)
        gl.uniform3f(surfaceUniform.flags, settings.blurEdge ? 1 : 0, 0, item.clip ? 1 : 0)
        gl.enable(gl.BLEND)
        gl.blendEquation(gl.FUNC_ADD)
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
        const surfaceRegion = pixels(
          {
            x: rect.x - aa,
            y: rect.y - aa,
            width: rect.width + 2 * aa,
            height: rect.height + 2 * aa,
          },
          frame
        )
        if (surfaceRegion.right > surfaceRegion.left && surfaceRegion.bottom > surfaceRegion.top) {
          scissor(surfaceRegion)
          draw(surfaceUniform.rect, cssRect(surfaceRegion, frame))
        }
        return !gl.isContextLost()
      },
    }
  } catch (error) {
    dispose()
    throw error
  }
}
