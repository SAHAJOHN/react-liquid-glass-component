interface RefractionOptions {
  /** Position of the glass in CSS pixels relative to the visible viewport. */
  left: number
  top: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  borderRadius: number
  distortionScale: number
  redOffset: number
  greenOffset: number
  blueOffset: number
  /** Increment when the pixels in a reused source canvas change. */
  frameId?: number
}

export interface WebGLRefraction {
  /** Source is a snapshot of the visible viewport, including its background. */
  render(source: HTMLCanvasElement, options: RefractionOptions): boolean
  dispose(): void
}

const vertexShader = `
attribute vec2 a_position;
varying vec2 v_position;
void main() {
  v_position = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const fragmentShader = `
precision mediump float;
uniform sampler2D u_source;
uniform vec2 u_viewport;
uniform vec4 u_lens;
uniform float u_radius;
uniform vec3 u_scales;
varying vec2 v_position;

bool inViewport(vec2 position) {
  return all(greaterThanEqual(position, vec2(0.0))) &&
         all(lessThanEqual(position, vec2(1.0)));
}

void main() {
  vec2 size = u_lens.zw;
  vec2 local = vec2(v_position.x, 1.0 - v_position.y) * size;
  vec2 p = local - size * 0.5;
  float radius = clamp(u_radius, 0.0, min(size.x, size.y) * 0.5);
  vec2 q = abs(p) - size * 0.5 + radius;
  float distance = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;

  // Estimate the outward normal of the rounded rectangle and bend the
  // sampled background most strongly near its edge.
  vec2 normal;
  if (q.x > 0.0 || q.y > 0.0) {
    vec2 corner = max(q, 0.0);
    normal = length(corner) > 0.0 ? normalize(corner) * sign(p) : vec2(0.0);
  } else {
    normal = q.x > q.y ? vec2(sign(p.x), 0.0) : vec2(0.0, sign(p.y));
  }
  float edgeDepth = max(8.0, min(size.x, size.y) * 0.15);
  float edge = 1.0 - smoothstep(0.0, edgeDepth, max(-distance, 0.0));
  vec2 uv = vec2((u_lens.x + local.x) / u_viewport.x,
                 1.0 - (u_lens.y + local.y) / u_viewport.y);
  if (!inViewport(uv)) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec2 offset = vec2(normal.x, -normal.y) * edge * 0.12 / u_viewport;
  vec4 center = texture2D(u_source, uv);
  vec2 redUv = uv + offset * u_scales.r;
  vec2 greenUv = uv + offset * u_scales.g;
  vec2 blueUv = uv + offset * u_scales.b;
  float red = inViewport(redUv) ? texture2D(u_source, redUv).r : center.r;
  float green = inViewport(greenUv) ? texture2D(u_source, greenUv).g : center.g;
  float blue = inViewport(blueUv) ? texture2D(u_source, blueUv).b : center.b;
  gl_FragColor = vec4(red, green, blue, center.a);
}
`

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function createGpuRenderer(canvas: HTMLCanvasElement): WebGLRefraction | null {
  let gl: WebGLRenderingContext | null
  try {
    gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    })
  } catch {
    return null
  }
  if (!gl) return null

  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShader)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShader)
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
    return null
  }

  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    return null
  }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }

  const buffer = gl.createBuffer()
  const texture = gl.createTexture()
  const position = gl.getAttribLocation(program, 'a_position')
  const viewport = gl.getUniformLocation(program, 'u_viewport')
  const lens = gl.getUniformLocation(program, 'u_lens')
  const radius = gl.getUniformLocation(program, 'u_radius')
  const scales = gl.getUniformLocation(program, 'u_scales')
  const sourceUniform = gl.getUniformLocation(program, 'u_source')
  if (!buffer || !texture || position < 0 || !viewport || !lens || !radius || !scales || !sourceUniform) {
    if (buffer) gl.deleteBuffer(buffer)
    if (texture) gl.deleteTexture(texture)
    gl.deleteProgram(program)
    return null
  }

  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
  gl.uniform1i(sourceUniform, 0)

  const context = gl
  const maxTextureSize = context.getParameter(context.MAX_TEXTURE_SIZE) as number
  let disposed = false
  let uploadedSource: HTMLCanvasElement | undefined
  let uploadedFrameId: number | undefined

  return {
    render(source, options) {
      const { width, height, viewportWidth, viewportHeight } = options
      if (
        disposed ||
        context.isContextLost() ||
        width <= 0 ||
        height <= 0 ||
        viewportWidth <= 0 ||
        viewportHeight <= 0 ||
        source.width <= 0 ||
        source.height <= 0 ||
        source.width > maxTextureSize ||
        source.height > maxTextureSize
      ) {
        return false
      }

      // The backdrop capture is one pixel per CSS pixel. Rendering a larger
      // pane cannot recover detail and greatly increases mobile GPU work.
      const outputWidth = Math.max(1, Math.min(maxTextureSize, Math.round(width)))
      const outputHeight = Math.max(1, Math.min(maxTextureSize, Math.round(height)))
      if (canvas.width !== outputWidth) canvas.width = outputWidth
      if (canvas.height !== outputHeight) canvas.height = outputHeight

      if (
        options.frameId === undefined ||
        uploadedSource !== source ||
        uploadedFrameId !== options.frameId
      ) {
        uploadedSource = undefined
        uploadedFrameId = undefined
        try {
          context.bindTexture(context.TEXTURE_2D, texture)
          context.texImage2D(
            context.TEXTURE_2D,
            0,
            context.RGBA,
            context.RGBA,
            context.UNSIGNED_BYTE,
            source,
          )
        } catch {
          // The source can be unavailable or tainted by cross-origin media.
          return false
        }
        if (context.getError() !== context.NO_ERROR) return false
        if (options.frameId !== undefined) {
          uploadedSource = source
          uploadedFrameId = options.frameId
        }
      }
      context.viewport(0, 0, canvas.width, canvas.height)
      context.useProgram(program)
      context.uniform2f(viewport, viewportWidth, viewportHeight)
      context.uniform4f(lens, options.left, options.top, width, height)
      context.uniform1f(radius, options.borderRadius)
      context.uniform3f(
        scales,
        options.distortionScale + options.redOffset,
        options.distortionScale + options.greenOffset,
        options.distortionScale + options.blueOffset,
      )
      context.drawArrays(context.TRIANGLE_STRIP, 0, 4)
      return context.getError() === context.NO_ERROR
    },
    dispose() {
      if (disposed) return
      disposed = true
      context.deleteTexture(texture)
      context.deleteBuffer(buffer)
      context.deleteProgram(program)
    },
  }
}

interface SharedRenderer {
  canvas: HTMLCanvasElement
  gpu: WebGLRefraction | null
  references: number
  lost: boolean
  onLost: (event: Event) => void
  onRestored: () => void
}

let sharedRenderer: SharedRenderer | null = null

function createSharedRenderer(): SharedRenderer | null {
  const canvas = document.createElement('canvas')
  const gpu = createGpuRenderer(canvas)
  if (!gpu) return null

  const shared: SharedRenderer = {
    canvas,
    gpu,
    references: 0,
    lost: false,
    onLost(event) {
      // Allow the browser to restore the context; no pane can render while lost.
      event.preventDefault()
      shared.lost = true
    },
    onRestored() {
      // Restored WebGL objects are invalid. Rebuild lazily on the next frame.
      shared.gpu?.dispose()
      shared.gpu = null
      shared.lost = false
    },
  }
  canvas.addEventListener('webglcontextlost', shared.onLost)
  canvas.addEventListener('webglcontextrestored', shared.onRestored)
  return shared
}

/** All panes share one WebGL context and present immediately to 2D canvases. */
export function createWebGLRefraction(canvas: HTMLCanvasElement): WebGLRefraction | null {
  const output = canvas.getContext('2d')
  if (!output) return null

  const shared = sharedRenderer ?? createSharedRenderer()
  if (!shared) return null
  sharedRenderer = shared
  shared.references += 1
  let disposed = false

  return {
    render(source, options) {
      if (disposed || shared.lost) return false
      if (!shared.gpu) shared.gpu = createGpuRenderer(shared.canvas)
      if (!shared.gpu?.render(source, options)) return false

      if (canvas.width !== shared.canvas.width) canvas.width = shared.canvas.width
      if (canvas.height !== shared.canvas.height) canvas.height = shared.canvas.height
      try {
        output.clearRect(0, 0, canvas.width, canvas.height)
        output.drawImage(shared.canvas, 0, 0)
        return true
      } catch {
        return false
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      shared.references -= 1
      if (shared.references !== 0) return
      shared.canvas.removeEventListener('webglcontextlost', shared.onLost)
      shared.canvas.removeEventListener('webglcontextrestored', shared.onRestored)
      shared.gpu?.dispose()
      // Release the GPU context immediately instead of relying on garbage collection.
      shared.canvas.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext()
      if (sharedRenderer === shared) sharedRenderer = null
    },
  }
}
