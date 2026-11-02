// Run from web/: node scripts/verify-glass-edges.mjs
// --report prints the baseline without enforcing corrected edge tolerances.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../../package.json', import.meta.url))
const { buildSync } = require('esbuild')
const bundle = buildSync({
  stdin: {
    contents: `export { createSceneRenderer } from './src/scene/renderer'; export { createDisplacementMapSvg } from './src/displacement-map';`,
    resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'GlassEdgeFixture',
  target: 'es2020',
}).outputFiles[0].text
const session = `liquid-glass-edge-check-${process.pid}`

function browser(args, input) {
  const result = spawnSync('agent-browser', ['--session', session, '--json', ...args], {
    encoding: 'utf8',
    input,
    timeout: 45_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  const response = JSON.parse(result.stdout)
  if (!response.success) throw new Error(JSON.stringify(response.error))
  return response.data
}

async function measureEdges(api) {
  const width = 320,
    height = 320
  const background = document.createElement('canvas')
  background.width = width
  background.height = height
  const paint = background.getContext('2d')
  const pixels = paint.createImageData(width, height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4
      pixels.data[index] = Math.round((x * 255) / (width - 1))
      pixels.data[index + 1] = Math.round((y * 255) / (height - 1))
      pixels.data[index + 2] = 80
      pixels.data[index + 3] = 255
    }
  paint.putImageData(pixels, 0, 0)
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  const renderer = api.createSceneRenderer(canvas)
  if (!renderer) throw new Error('WebGL unavailable')
  const gl = canvas.getContext('webgl')
  let copiedPixels = 0
  const originalCopy = gl.copyTexSubImage2D.bind(gl)
  gl.copyTexSubImage2D = (...args) => {
    copiedPixels = args[6] * args[7]
    return originalCopy(...args)
  }
  const rect = { x: 60, y: 60, width: 200, height: 200 }
  const frame = { width, height, scrollX: 0, scrollY: 0, pixelRatio: 1 }
  const backdrop = {
    kind: 'sprite',
    bitmap: background,
    rect: { x: 0, y: 0, width, height },
    space: 'viewport',
    opacity: 1,
  }
  const glass = {
    kind: 'glass',
    rect,
    space: 'viewport',
    opacity: 1,
    radius: 24,
    displacement: [-180, -180, -180],
    blur: 0,
    tint: [0, 0, 0, 0],
    saturation: 1,
  }
  const makeMap = async (opts) => {
    const map = document.createElement('canvas')
    map.width = rect.width
    map.height = rect.height
    const image = new Image()
    image.src = `data:image/svg+xml,${encodeURIComponent(api.createDisplacementMapSvg(rect.width, rect.height, opts))}`
    await image.decode()
    map.getContext('2d').drawImage(image, 0, 0)
    return map
  }
  const read = () => {
    const values = new Uint8Array(canvas.width * canvas.height * 4)
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, values)
    if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL edge fixture error')
    return values
  }
  const pixel = (values, x, y, ratio) => {
    const index =
      ((canvas.height - Math.floor(y * ratio) - 1) * canvas.width + Math.floor(x * ratio)) * 4
    return [values[index], values[index + 1], values[index + 2]]
  }
  const difference = (left, right) =>
    Math.max(...left.map((value, channel) => Math.abs(value - right[channel])))
  const defaults = {
    borderRadius: 24,
    borderWidth: 0.07,
    brightness: 50,
    opacity: 0.93,
    blur: 11,
    mixBlendMode: 'difference',
  }
  const cases = [
    { name: 'default', options: defaults, scale: -180 },
    {
      name: 'deep',
      options: { ...defaults, brightness: 42, opacity: 0.88, blur: 24 },
      scale: -220,
    },
  ]
  const measurements = []
  try {
    for (const scenario of cases) {
      const map = await makeMap(scenario.options)
      for (const ratio of [1, 2]) {
        frame.pixelRatio = ratio
        renderer.setScene({ background: [0, 0, 0, 1], items: [backdrop] })
        if (!renderer.render(frame)) throw new Error('Baseline frame failed')
        const base = read()
        renderer.setScene({
          background: [0, 0, 0, 1],
          items: [
            backdrop,
            {
              ...glass,
              displacement: [scenario.scale, scenario.scale, scenario.scale],
              map: { bitmap: map, xChannel: 0, yChannel: 1 },
            },
          ],
        })
        if (!renderer.render(frame)) throw new Error('Refracted frame failed')
        const refracted = read()
        const edgeErrors = []
        const interiorErrors = []
        for (let p = 100; p <= 220; p += 10) {
          for (const [x, y] of [
            [60, p],
            [259, p],
            [p, 60],
            [p, 259],
          ]) {
            edgeErrors.push(difference(pixel(base, x, y, ratio), pixel(refracted, x, y, ratio)))
          }
          for (const [x, y] of [
            [80, p],
            [239, p],
            [p, 80],
            [p, 239],
          ]) {
            interiorErrors.push(difference(pixel(base, x, y, ratio), pixel(refracted, x, y, ratio)))
          }
        }
        for (const [cx, cy, start] of [
          [84, 84, Math.PI],
          [236, 84, Math.PI * 1.5],
          [236, 236, 0],
          [84, 236, Math.PI * 0.5],
        ]) {
          for (let step = 0; step <= 8; step++) {
            const angle = start + (step * Math.PI) / 16
            const x = cx + Math.cos(angle) * 23.75
            const y = cy + Math.sin(angle) * 23.75
            edgeErrors.push(difference(pixel(base, x, y, ratio), pixel(refracted, x, y, ratio)))
          }
        }
        measurements.push({
          name: scenario.name,
          ratio,
          edgeMax: Math.max(...edgeErrors),
          edgeMean: edgeErrors.reduce((a, b) => a + b, 0) / edgeErrors.length,
          interiorMax: Math.max(...interiorErrors),
          copiedPixels,
        })
      }
    }
    // A high-contrast diagonal line must meet the same source line at both
    // straight boundaries. Its center inside the pane is still free to bend.
    paint.fillStyle = '#142334'
    paint.fillRect(0, 0, width, height)
    paint.strokeStyle = '#fff'
    paint.lineWidth = 4
    paint.beginPath()
    paint.moveTo(0, 240)
    paint.lineTo(width, 80)
    paint.stroke()
    const lineBackground = document.createElement('canvas')
    lineBackground.width = width
    lineBackground.height = height
    lineBackground.getContext('2d').drawImage(background, 0, 0)
    const lineBackdrop = { ...backdrop, bitmap: lineBackground }
    const centroid = (values, x, ratio) => {
      let sum = 0,
        weighted = 0
      for (let y = 65; y < 255; y += 1 / ratio) {
        const rgb = pixel(values, x, y, ratio)
        const weight = Math.max(0, Math.min(...rgb) - 100)
        sum += weight
        weighted += weight * y
      }
      if (!sum) throw new Error(`Missing diagonal line at x=${x}`)
      return weighted / sum
    }
    const lineCases = []
    for (const ratio of [1, 2]) {
      frame.pixelRatio = ratio
      const map = await makeMap(defaults)
      renderer.setScene({ background: [0, 0, 0, 1], items: [lineBackdrop] })
      renderer.render(frame)
      const base = read()
      renderer.setScene({
        background: [0, 0, 0, 1],
        items: [lineBackdrop, { ...glass, map: { bitmap: map, xChannel: 0, yChannel: 1 } }],
      })
      renderer.render(frame)
      const refracted = read()
      const error = (x) => Math.abs(centroid(refracted, x, ratio) - centroid(base, x, ratio))
      lineCases.push({
        ratio,
        edgeMax: Math.max(error(60), error(259)),
        interiorMax: Math.max(error(80), error(239)),
      })
    }
    return { gradients: measurements, lines: lineCases }
  } finally {
    renderer.dispose()
    canvas.remove()
  }
}

let opened = false
try {
  browser(['open', 'about:blank'])
  opened = true
  const evidence = browser(
    ['eval', '--stdin'],
    `${bundle}\n(${measureEdges.toString()})(GlassEdgeFixture)`
  ).result
  console.log(JSON.stringify(evidence))
  for (const measurement of evidence.gradients) {
    assert.ok(measurement.interiorMax > 4, 'Glass must retain visible interior refraction')
    if (!process.argv.includes('--report'))
      assert.ok(
        measurement.edgeMax <= 2,
        `Edge must converge to the undistorted source: ${JSON.stringify(measurement)}`
      )
    if (!process.argv.includes('--report'))
      assert.ok(
        measurement.copiedPixels < 320 * 320 * measurement.ratio ** 2 * 0.6,
        'A small pane should not copy most of the viewport'
      )
  }
  for (const line of evidence.lines) {
    assert.ok(line.interiorMax > 1, 'Diagonal line must still refract inside the pane')
    if (!process.argv.includes('--report'))
      assert.ok(
        line.edgeMax < 1,
        `Diagonal line must join continuously at the edge: ${JSON.stringify(line)}`
      )
  }
  console.log(
    process.argv.includes('--report')
      ? 'REPORT glass edges (continuity assertions skipped)'
      : 'PASS glass edge continuity'
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
