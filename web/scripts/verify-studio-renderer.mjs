// Run from web/: node scripts/verify-studio-renderer.mjs <reference-checkout>
// The reference must be the clean upstream checkout at the pinned commit below.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pinnedCommit = 'f7b28c36305a862f5cffed3ddd51511cf1204f56'
const referencePath =
  process.argv.find((value, index) => index > 1 && !value.startsWith('--')) ||
  process.env.LIQUID_GLASS_REFERENCE
assert.ok(
  referencePath,
  'Provide the reference checkout path as an argument or LIQUID_GLASS_REFERENCE'
)
const revision = spawnSync('git', ['-C', referencePath, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
assert.equal(revision.status, 0, `Provide a liquid-glass-studio checkout at ${pinnedCommit}`)
assert.equal(
  revision.stdout.trim(),
  pinnedCommit,
  'Reference checkout must use the pinned revision'
)
const clean = spawnSync(
  'git',
  [
    '-C',
    referencePath,
    'diff',
    '--quiet',
    pinnedCommit,
    '--',
    'src/shaders',
    'src/utils/index.ts',
    'src/Controls.tsx',
  ],
  { encoding: 'utf8' }
)
assert.equal(clean.status, 0, 'Reference shader files must be unmodified')
const readShader = (name) =>
  readFileSync(path.join(referencePath, 'src/shaders', name), 'utf8').replace(
    /#include\s+'([^']+)'/g,
    (_, include) => readFileSync(path.join(referencePath, 'src/shaders', include), 'utf8')
  )
const reference = {
  vertex: readShader('vertex.glsl'),
  background: readShader('fragment-bg.glsl'),
  horizontal: readShader('fragment-bg-vblur.glsl'),
  vertical: readShader('fragment-bg-hblur.glsl'),
  surface: readShader('fragment-main.glsl'),
}
const require = createRequire(new URL('../../package.json', import.meta.url))
const { buildSync } = require('esbuild')
const ts = require('typescript')
const controlSource = ts.createSourceFile(
  'Controls.tsx',
  readFileSync(path.join(referencePath, 'src/Controls.tsx'), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
const materialKeys = [
  'refThickness',
  'refDistance',
  'refFactor',
  'refDispersion',
  'refFresnelRange',
  'refFresnelHardness',
  'refFresnelFactor',
  'glareRange',
  'glareHardness',
  'glareFactor',
  'glareConvergence',
  'glareOppositeFactor',
  'glareAngle',
  'blurRadius',
  'blurEdge',
  'tint',
  'shadowExpand',
  'shadowFactor',
  'shadowPosition',
  'shapeRadius',
  'shapeRoundness',
]
const property = (node, name) =>
  ts.isObjectLiteralExpression(node)
    ? node.properties.find(
        (item) => ts.isPropertyAssignment(item) && item.name.getText(controlSource) === name
      )?.initializer
    : undefined
const literal = (node) => {
  if (!node) throw new Error('Missing reference literal')
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken)
    return -literal(node.operand)
  if (ts.isObjectLiteralExpression(node))
    return Object.fromEntries(
      node.properties.map((item) => {
        if (!ts.isPropertyAssignment(item))
          throw new Error('Unsupported reference literal property')
        return [item.name.getText(controlSource), literal(item.initializer)]
      })
    )
  throw new Error(`Expected a static reference default: ${node.getText(controlSource)}`)
}
const referenceDefaults = {}
const inspectControl = (node) => {
  if (ts.isPropertyAssignment(node)) {
    const key = node.name.getText(controlSource)
    if (materialKeys.includes(key)) {
      if (key === 'shadowPosition') {
        const options = ts.isCallExpression(node.initializer)
          ? node.initializer.arguments[0]
          : undefined
        if (!options) throw new Error('Missing reference shadow vector')
        referenceDefaults[key] = {
          x: literal(property(options, 'x')),
          y: literal(property(options, 'y')),
        }
      } else referenceDefaults[key] = literal(property(node.initializer, 'value'))
    }
  }
  ts.forEachChild(node, inspectControl)
}
inspectControl(controlSource)
assert.equal(
  Object.keys(referenceDefaults).length,
  materialKeys.length,
  'Every canonical default is read from the pinned source'
)
const bundle = buildSync({
  stdin: {
    contents:
      "export { createSceneRenderer } from './src/scene/renderer'; export { GLASS_STUDIO_DEFAULTS } from './src/studio-props';",
    resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'StudioUnderTest',
  target: 'es2020',
}).outputFiles[0].text
const session = `liquid-studio-proof-${process.pid}`
function browser(args, input) {
  const result = spawnSync('agent-browser', ['--session', session, '--json', ...args], {
    encoding: 'utf8',
    input,
    timeout: 60_000,
    maxBuffer: 6 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  const response = JSON.parse(result.stdout)
  if (!response.success) throw new Error(JSON.stringify(response.error))
  return response.data
}

function verifyStudio(api, upstream, referenceDefaults) {
  let checks = 0
  const check = (condition, message) => {
    if (!condition) throw new Error(message)
    checks++
  }
  check(
    Object.keys(api.GLASS_STUDIO_DEFAULTS).length === Object.keys(referenceDefaults).length,
    'Canonical property names match the reference material controls'
  )
  for (const [key, expected] of Object.entries(referenceDefaults)) {
    const actual = api.GLASS_STUDIO_DEFAULTS[key]
    check(
      typeof expected === 'object'
        ? actual &&
            Object.keys(actual).length === Object.keys(expected).length &&
            Object.entries(expected).every(([part, value]) => actual[part] === value)
        : actual === expected,
      `Default ${key} matches Controls.tsx`
    )
  }
  const cssSize = 320
  const background = document.createElement('canvas')
  background.width = background.height = cssSize
  const paint = background.getContext('2d')
  const image = paint.createImageData(cssSize, cssSize)
  for (let y = 0; y < cssSize; y++)
    for (let x = 0; x < cssSize; x++) {
      const i = (y * cssSize + x) * 4
      const cell = (Math.floor(x / 20) + Math.floor(y / 20)) % 2
      image.data.set(
        [
          40 + Math.round((x * 160) / 319) + cell * 25,
          45 + Math.round((y * 150) / 319),
          150 + cell * 65,
          255,
        ],
        i
      )
    }
  paint.putImageData(image, 0, 0)
  paint.fillStyle = '#fff'
  paint.font = 'bold 28px sans-serif'
  paint.fillText('GLASS', 110, 170)
  paint.strokeStyle = '#081020'
  paint.lineWidth = 2
  paint.beginPath()
  paint.moveTo(0, 250)
  paint.lineTo(320, 70)
  paint.stroke()

  const createReference = (ratio) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = cssSize * ratio
    document.body.appendChild(canvas)
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    })
    check(!!gl, 'Reference WebGL2 initializes')
    const programs = [],
      textures = [],
      framebuffers = []
    const compile = (type, source) => {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader))
      return shader
    }
    const program = (source) => {
      const vertex = compile(gl.VERTEX_SHADER, upstream.vertex),
        fragment = compile(gl.FRAGMENT_SHADER, source)
      const p = gl.createProgram()
      gl.attachShader(p, vertex)
      gl.attachShader(p, fragment)
      gl.linkProgram(p)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
      programs.push(p)
      return p
    }
    const bgProgram = program(upstream.background),
      xProgram = program(upstream.horizontal),
      yProgram = program(upstream.vertical),
      mainProgram = program(upstream.surface)
    const quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const texture = (source) => {
      const t = gl.createTexture()
      textures.push(t)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      if (source) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
      } else
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          canvas.width,
          canvas.height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          null
        )
      return t
    }
    const bgTexture = texture(background)
    const target = () => {
      const t = texture(),
        f = gl.createFramebuffer()
      framebuffers.push(f)
      gl.bindFramebuffer(gl.FRAMEBUFFER, f)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
      check(
        gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE,
        'Reference framebuffer complete'
      )
      return { t, f }
    }
    const scene = target(),
      horizontal = target(),
      vertical = target()
    const bindProgram = (p) => {
      gl.useProgram(p)
      gl.bindBuffer(gl.ARRAY_BUFFER, quad)
      const a = gl.getAttribLocation(p, 'a_position')
      gl.enableVertexAttribArray(a)
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0)
    }
    const f = (p, name, value) => {
      const l = gl.getUniformLocation(p, name)
      if (l !== null) gl.uniform1f(l, value)
    }
    const i = (p, name, value) => {
      const l = gl.getUniformLocation(p, name)
      if (l !== null) gl.uniform1i(l, value)
    }
    const v2 = (p, name, x, y) => {
      const l = gl.getUniformLocation(p, name)
      if (l !== null) gl.uniform2f(l, x, y)
    }
    const draw = (p, target) => {
      bindProgram(p)
      gl.bindFramebuffer(gl.FRAMEBUFFER, target)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    return {
      canvas,
      render(settings, rect) {
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.disable(gl.BLEND)
        gl.disable(gl.SCISSOR_TEST)
        const common = (p) => {
          bindProgram(p)
          v2(p, 'u_resolution', canvas.width, canvas.height)
          f(p, 'u_dpr', ratio)
          v2(
            p,
            'u_mouseSpring',
            (rect.x + rect.width / 2) * ratio,
            (cssSize - rect.y - rect.height / 2) * ratio
          )
          f(p, 'u_shapeWidth', rect.width)
          f(p, 'u_shapeHeight', rect.height)
          f(
            p,
            'u_shapeRadius',
            ((Math.min(rect.width, rect.height) / 2) * settings.shapeRadius) / 100
          )
          f(p, 'u_shapeRoundness', settings.shapeRoundness)
          f(p, 'u_mergeRate', 0.05)
          i(p, 'u_showShape1', 0)
        }
        common(bgProgram)
        i(bgProgram, 'u_bgType', 3)
        i(bgProgram, 'u_bgTextureReady', 1)
        f(bgProgram, 'u_bgTextureRatio', 1)
        i(bgProgram, 'u_bgTexture', 0)
        f(bgProgram, 'u_shadowExpand', settings.shadowExpand)
        f(bgProgram, 'u_shadowFactor', settings.shadowFactor / 100)
        v2(bgProgram, 'u_shadowPosition', -settings.shadowPosition.x, -settings.shadowPosition.y)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, bgTexture)
        draw(bgProgram, scene.f)
        const radius = settings.blurRadius,
          sigma = radius / 3,
          weights = []
        let sum = 0
        for (let n = 0; n <= radius; n++) {
          const w = Math.exp((-0.5 * n * n) / (sigma * sigma))
          weights.push(w)
          sum += n === 0 ? w : 2 * w
        }
        const normalized = new Float32Array(201)
        weights.forEach((w, n) => (normalized[n] = w / sum))
        for (const [p, source, target] of [
          [xProgram, scene.t, horizontal.f],
          [yProgram, horizontal.t, vertical.f],
        ]) {
          bindProgram(p)
          v2(p, 'u_resolution', canvas.width, canvas.height)
          i(p, 'u_blurRadius', radius)
          gl.uniform1fv(gl.getUniformLocation(p, 'u_blurWeights[0]'), normalized)
          i(p, 'u_prevPassTexture', 0)
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, source)
          draw(p, target)
        }
        common(mainProgram)
        i(mainProgram, 'STEP', 9)
        i(mainProgram, 'u_bg', 0)
        i(mainProgram, 'u_blurredBg', 1)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, scene.t)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, vertical.t)
        const t = settings.tint
        gl.uniform4f(
          gl.getUniformLocation(mainProgram, 'u_tint'),
          t.r / 255,
          t.g / 255,
          t.b / 255,
          t.a
        )
        for (const [name, value] of Object.entries({
          u_refThickness: settings.refThickness,
          u_refDistance: settings.refDistance,
          u_refFactor: settings.refFactor,
          u_refDispersion: settings.refDispersion,
          u_refFresnelRange: settings.refFresnelRange,
          u_refFresnelHardness: settings.refFresnelHardness / 100,
          u_refFresnelFactor: settings.refFresnelFactor / 100,
          u_glareRange: settings.glareRange,
          u_glareHardness: settings.glareHardness / 100,
          u_glareFactor: settings.glareFactor / 100,
          u_glareConvergence: settings.glareConvergence / 100,
          u_glareOppositeFactor: settings.glareOppositeFactor / 100,
          u_glareAngle: (settings.glareAngle * Math.PI) / 180,
        }))
          f(mainProgram, name, value)
        i(mainProgram, 'u_blurEdge', settings.blurEdge ? 1 : 0)
        draw(mainProgram, null)
        const pixels = new Uint8Array(canvas.width * canvas.height * 4)
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        check(gl.getError() === gl.NO_ERROR, 'Reference frame has no GL error')
        return pixels
      },
      dispose() {
        programs.forEach((p) => gl.deleteProgram(p))
        textures.forEach((t) => gl.deleteTexture(t))
        framebuffers.forEach((f) => gl.deleteFramebuffer(f))
        gl.deleteBuffer(quad)
        canvas.remove()
      },
    }
  }
  const shapeDistance = (x, y, rect, settings) => {
    const px = Math.abs(x - rect.x - rect.width / 2),
      py = Math.abs(y - rect.y - rect.height / 2)
    const radius = ((Math.min(rect.width, rect.height) / 2) * settings.shapeRadius) / 100
    const dx = px - rect.width / 2,
      dy = py - rect.height / 2
    return dx > -radius && dy > -radius
      ? Math.pow(
          Math.pow(Math.abs(dx + radius), settings.shapeRoundness) +
            Math.pow(Math.abs(dy + radius), settings.shapeRoundness),
          1 / settings.shapeRoundness
        ) - radius
      : Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  }
  const compare = (a, b, ratio, rect, settings) => {
    const regions = { full: [], rim: [], corner: [], body: [] }
    let changedPixels = 0
    const physical = cssSize * ratio
    for (let y = 0; y < physical; y++)
      for (let x = 0; x < physical; x++) {
        const index = ((physical - y - 1) * physical + x) * 4
        const max = Math.max(
          Math.abs(a[index] - b[index]),
          Math.abs(a[index + 1] - b[index + 1]),
          Math.abs(a[index + 2] - b[index + 2])
        )
        const mean =
          (Math.abs(a[index] - b[index]) +
            Math.abs(a[index + 1] - b[index + 1]) +
            Math.abs(a[index + 2] - b[index + 2])) /
          3
        const pointX = (x + 0.5) / ratio,
          pointY = (y + 0.5) / ratio,
          d = shapeDistance(pointX, pointY, rect, settings)
        regions.full.push([mean, max])
        if (max > 3) changedPixels++
        if (d >= -settings.refThickness - 1 && d <= 2) regions.rim.push([mean, max])
        if (d < -settings.refThickness - 5) regions.body.push([mean, max])
        const radius = ((Math.min(rect.width, rect.height) / 2) * settings.shapeRadius) / 100
        if (
          Math.abs(pointX - rect.x - rect.width / 2) > rect.width / 2 - radius &&
          Math.abs(pointY - rect.y - rect.height / 2) > rect.height / 2 - radius &&
          d > -30 &&
          d < 5
        )
          regions.corner.push([mean, max])
      }
    const result = { changedPixels }
    for (const [name, values] of Object.entries(regions)) {
      const errors = values.map((v) => v[1]).sort((x, y) => x - y)
      result[name] = {
        mean: values.reduce((sum, v) => sum + v[0], 0) / Math.max(1, values.length),
        max: errors[errors.length - 1] ?? 0,
        p99: errors[Math.floor(errors.length * 0.99)] ?? 0,
        pixels: values.length,
      }
    }
    return result
  }
  const changes = (a, b) => {
    let n = 0
    for (let k = 0; k < a.length; k += 4)
      if (
        Math.max(
          Math.abs(a[k] - b[k]),
          Math.abs(a[k + 1] - b[k + 1]),
          Math.abs(a[k + 2] - b[k + 2])
        ) > 3
      )
        n++
    return n
  }
  const results = [],
    parameterChanges = {},
    kernelPaths = []
  const defaults = api.GLASS_STUDIO_DEFAULTS
  for (const { ratio, packed } of [
    { ratio: 1, packed: false },
    { ratio: 2, packed: false },
    { ratio: 1, packed: true },
  ]) {
    const reference = createReference(ratio)
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    const renderer = api.createSceneRenderer(canvas)
    check(!!renderer, 'Studio renderer initializes')
    const gl = canvas.getContext('webgl'),
      shaderErrors = []
    const extension = gl.getExtension.bind(gl)
    const parameter = gl.getParameter.bind(gl)
    let packedUploads = 0,
      floatUploads = 0,
      studioUniformVectors = 0
    if (packed) {
      gl.getExtension = (name) => (name === 'OES_texture_float' ? null : extension(name))
      gl.getParameter = (name) => (name === gl.MAX_FRAGMENT_UNIFORM_VECTORS ? 16 : parameter(name))
    }
    const link = gl.linkProgram.bind(gl)
    gl.linkProgram = (program) => {
      link(program)
      let vectors = 0
      for (let index = 0; index < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); index++) {
        const uniform = gl.getActiveUniform(program, index)
        const columns =
          uniform.type === gl.FLOAT_MAT4
            ? 4
            : uniform.type === gl.FLOAT_MAT3
              ? 3
              : uniform.type === gl.FLOAT_MAT2
                ? 2
                : 1
        vectors += uniform.size * columns
      }
      studioUniformVectors = Math.max(studioUniformVectors, vectors)
    }
    const compileShader = gl.compileShader.bind(gl)
    gl.compileShader = (shader) => {
      compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        shaderErrors.push(gl.getShaderInfoLog(shader))
    }
    let uploads = 0
    const upload = gl.texImage2D.bind(gl)
    gl.texImage2D = (...args) => {
      uploads++
      if (args.length === 9 && args[3] === 100 && args[4] === 1) {
        if (args[7] === gl.FLOAT) floatUploads++
        if (args[7] === gl.UNSIGNED_BYTE) packedUploads++
      }
      return upload(...args)
    }
    const frame = {
      width: cssSize,
      height: cssSize,
      pixelRatio: ratio,
      devicePixelRatio: ratio,
      scrollX: 0,
      scrollY: 0,
    }
    const rect = { x: 60, y: 80, width: 200, height: 160 }
    const sprite = {
      kind: 'sprite',
      space: 'viewport',
      rect: { x: 0, y: 0, width: cssSize, height: cssSize },
      opacity: 1,
      bitmap: background,
    }
    const item = (settings, bounds = rect) => ({
      kind: 'glass',
      space: 'document',
      rect: bounds,
      opacity: 1,
      radius: 20,
      displacement: [-180, -180, -180],
      blur: 0,
      saturation: 1,
      tint: [0, 0, 0, 0],
      magnification: 1,
      studio: settings,
    })
    const render = (settings, bounds = rect, clip) => {
      const pane = item(settings, bounds)
      if (clip) pane.clip = clip
      renderer.setScene({ background: [0, 0, 0, 1], items: [sprite, pane] })
      check(renderer.render(frame), `Studio frame renders: ${shaderErrors.join('; ')}`)
      const pixels = new Uint8Array(canvas.width * canvas.height * 4)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      check(gl.getError() === gl.NO_ERROR, 'Studio frame has no GL error')
      return pixels
    }
    try {
      const baseline = render(defaults),
        expected = reference.render(defaults, rect)
      results.push({
        name: 'defaults',
        ratio,
        packed,
        difference: compare(baseline, expected, ratio, rect, defaults),
      })
      const beforeScroll = uploads
      renderer.render({ ...frame, scrollY: 18 })
      check(uploads === beforeScroll, 'Scrolling unchanged Studio uploads no textures')
      const clippedRect = { x: -35, y: 40, width: 200, height: 180 }
      const clipped = render(defaults, clippedRect),
        expectedClipped = reference.render(defaults, clippedRect)
      results.push({
        name: 'partially-offscreen',
        ratio,
        packed,
        difference: compare(clipped, expectedClipped, ratio, clippedRect, defaults),
      })
      const clip = {
        rect: { x: 110, y: 100, width: 80, height: 90 },
        space: 'viewport',
        radius: 18,
        roundness: 5,
      }
      renderer.setScene({ background: [0, 0, 0, 1], items: [sprite] })
      check(renderer.render(frame), 'Plain backdrop renders for clip comparison')
      const plainBackdrop = new Uint8Array(canvas.width * canvas.height * 4)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, plainBackdrop)
      const clippedAncestor = render(defaults, rect, clip)
      const outsideIndex = ((canvas.height - 60 * ratio - 1) * canvas.width + 160 * ratio) * 4
      check(
        [0, 1, 2].every(
          (n) => clippedAncestor[outsideIndex + n] === plainBackdrop[outsideIndex + n]
        ),
        'Ancestor clip excludes Studio material and shadow outside its bounds'
      )
      if (ratio === 1 && !packed) {
        for (const [key, value] of Object.entries({
          refThickness: 40,
          refDistance: 0.1,
          refFactor: 2.1,
          refDispersion: 25,
          refFresnelRange: 65,
          refFresnelHardness: 55,
          refFresnelFactor: 0,
          glareRange: 60,
          glareHardness: 55,
          glareFactor: 0,
          glareConvergence: 0,
          glareOppositeFactor: 0,
          glareAngle: 45,
          blurRadius: 12,
          blurEdge: false,
          tint: { r: 90, g: 180, b: 255, a: 0.4 },
          shadowExpand: 8,
          shadowFactor: 0,
          shadowPosition: { x: 14, y: 12 },
          shapeRadius: 35,
          shapeRoundness: 2,
        })) {
          // Radius 1 is intentionally almost sharp. Test the edge-blur toggle
          // against a visible blur at the same radius rather than numerical noise.
          const controlBaseline = key === 'blurEdge' ? { ...defaults, blurRadius: 12 } : defaults
          const before = key === 'blurEdge' ? render(controlBaseline) : baseline
          const settings = { ...controlBaseline, [key]: value }
          const actual = render(settings),
            expected = reference.render(settings, rect)
          const count = changes(before, actual)
          parameterChanges[key] = count
          check(count > 0, `${key} affects rendered pixels`)
          results.push({
            name: key,
            ratio,
            packed,
            difference: compare(actual, expected, ratio, rect, settings),
          })
        }
        const disabled = {
          ...defaults,
          refFresnelRange: 0,
          refFresnelFactor: 0,
          glareRange: 0,
          glareFactor: 0,
          refFactor: 1,
          shadowFactor: 0,
        }
        const actualDisabled = render(disabled)
        results.push({
          name: 'zero-effects',
          ratio,
          packed,
          difference: compare(
            actualDisabled,
            reference.render(disabled, rect),
            ratio,
            rect,
            disabled
          ),
        })
        check(
          shaderErrors.length === 0,
          'Disabled effects remain finite and render without shader errors'
        )
        const maximumBlur = { ...defaults, blurRadius: 200 }
        const actualMaximum = render(maximumBlur)
        results.push({
          name: 'maximum-blur',
          ratio,
          packed,
          difference: compare(
            actualMaximum,
            reference.render(maximumBlur, rect),
            ratio,
            rect,
            maximumBlur
          ),
        })
        check(shaderErrors.length === 0, 'Maximum blur radius renders without shader errors')
      }
      if (packed) {
        for (const radius of [12, 200]) {
          const settings = { ...defaults, blurRadius: radius }
          const actual = render(settings)
          results.push({
            name: `packed-blur-${radius}`,
            ratio,
            packed,
            difference: compare(actual, reference.render(settings, rect), ratio, rect, settings),
          })
        }
        check(
          packedUploads > 0 && floatUploads === 0,
          'No-float devices use packed kernel textures'
        )
        check(
          studioUniformVectors <= 16,
          'Studio programs fit a conservative 16-vector uniform budget'
        )
        render(defaults)
        const beforeMixed = uploads
        render({ ...defaults, blurRadius: 12 })
        render({ ...defaults, blurRadius: 200 })
        render(defaults)
        check(uploads === beforeMixed, 'Previously used kernel radii remain cached')
      }
      const beforeUpdate = uploads
      render(defaults)
      render({ ...defaults, refDistance: 0.08 })
      check(uploads === beforeUpdate, 'Material updates reuse immutable uploaded textures')
      kernelPaths.push({
        ratio,
        forcedPacked: packed,
        packedUploads,
        floatUploads,
        studioUniformVectors,
      })
    } finally {
      renderer.dispose()
      check(renderer.render(frame) === false, 'Disposed renderer cannot draw')
      canvas.remove()
      reference.dispose()
    }
  }
  return {
    checks,
    results,
    parameterChanges,
    kernelPaths,
    referenceShape: { showShape1: false, mergeRate: 0.05 },
  }
}

let opened = false
try {
  browser(['open', 'about:blank'])
  opened = true
  const { result } = browser(
    ['eval', '--stdin'],
    `${bundle}\n(${verifyStudio.toString()})(StudioUnderTest,${JSON.stringify(reference)},${JSON.stringify(referenceDefaults)})`
  )
  const reportOnly = process.argv.includes('--report')
  console.log(
    JSON.stringify(
      reportOnly
        ? result
        : {
            checks: result.checks,
            reference: pinnedCommit,
            referenceShape: result.referenceShape,
            defaults: result.results.filter((sample) => sample.name === 'defaults'),
            kernelPaths: result.kernelPaths,
            largestVariantError: result.results.reduce(
              (largest, sample) =>
                sample.difference.full.max > largest.max
                  ? {
                      name: sample.name,
                      ratio: sample.ratio,
                      max: sample.difference.full.max,
                      mean: sample.difference.full.mean,
                    }
                  : largest,
              { name: '', ratio: 0, max: 0, mean: 0 }
            ),
          }
    )
  )
  if (!reportOnly) {
    for (const sample of result.results) {
      if (sample.name === 'defaults') {
        assert.ok(
          sample.difference.full.max <= 4,
          `Default maximum RGB error ${sample.difference.full.max}`
        )
        assert.ok(
          sample.difference.full.mean <= 0.25,
          `Default mean RGB error ${sample.difference.full.mean}`
        )
        assert.ok(
          sample.difference.corner.p99 <= 2,
          `Default corner p99 RGB error ${sample.difference.corner.p99}`
        )
      }
      assert.ok(
        sample.difference.full.mean <= 0.75,
        `${sample.name} DPR${sample.ratio}: full mean ${sample.difference.full.mean}`
      )
      assert.ok(
        sample.difference.rim.mean <= 1.5,
        `${sample.name} DPR${sample.ratio}: rim mean ${sample.difference.rim.mean}`
      )
      assert.ok(
        sample.difference.full.p99 <= 5,
        `${sample.name} DPR${sample.ratio}: p99 ${sample.difference.full.p99}`
      )
    }
  }
  console.log(
    `PASS Studio renderer: ${result.checks} assertions against upstream ${pinnedCommit.slice(0, 7)}.`
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  if (opened) {
    try {
      browser(['close'])
    } catch (error) {
      console.error(error)
      process.exitCode = 1
    }
  }
}
