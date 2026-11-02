// Run from web/: node scripts/verify-glass-thickness.mjs
// Bundles current source and checks independent rim thickness and body curvature.
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
  globalName: 'ThicknessFixture',
  target: 'es2020',
}).outputFiles[0].text
const session = `liquid-thickness-check-${process.pid}`

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

async function verifyThickness(api) {
  let checks = 0
  const check = (value, message) => {
    if (!value) throw new Error(message)
    checks++
  }
  const size = 320
  const pane = { x: 60, y: 60, width: 200, height: 200 }
  const ramp = document.createElement('canvas')
  ramp.width = ramp.height = size
  const rampContext = ramp.getContext('2d')
  const gradient = rampContext.createImageData(size, size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4
      gradient.data.set([Math.round((x * 255) / 319), Math.round((y * 255) / 319), 64, 255], offset)
    }
  rampContext.putImageData(gradient, 0, 0)

  const grid = document.createElement('canvas')
  grid.width = grid.height = size
  const gridContext = grid.getContext('2d')
  gridContext.fillStyle = '#101010'
  gridContext.fillRect(0, 0, size, size)
  gridContext.fillStyle = '#fff'
  for (const x of [140, 180]) gridContext.fillRect(x - 1, 100, 2, 120)
  gridContext.font = 'bold 17px sans-serif'
  gridContext.fillText('PLATE', 132, 200)

  const map = document.createElement('canvas')
  map.width = map.height = pane.width
  const mapImage = new Image()
  mapImage.src = `data:image/svg+xml,${encodeURIComponent(
    api.createDisplacementMapSvg(pane.width, pane.height, {
      borderRadius: 24,
      borderWidth: 0.07,
      brightness: 50,
      opacity: 0.93,
      blur: 11,
      mixBlendMode: 'difference',
    })
  )}`
  await mapImage.decode()
  map.getContext('2d').drawImage(mapImage, 0, 0)

  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  const renderer = api.createSceneRenderer(canvas)
  check(renderer !== null, 'Renderer initializes')
  const gl = canvas.getContext('webgl')
  const frame = { scrollX: 0, scrollY: 0, width: size, height: size, pixelRatio: 1 }
  const glass = {
    kind: 'glass',
    space: 'document',
    rect: pane,
    opacity: 1,
    radius: 24,
    displacement: [-180, -180, -180],
    blur: 0,
    saturation: 1,
    tint: [0, 0, 0, 0],
    map: { bitmap: map, xChannel: 0, yChannel: 1 },
  }
  let uploads = 0,
    draws = 0,
    copies = 0
  const upload = gl.texImage2D.bind(gl)
  gl.texImage2D = (...args) => {
    uploads++
    return upload(...args)
  }
  const draw = gl.drawArrays.bind(gl)
  gl.drawArrays = (...args) => {
    draws++
    return draw(...args)
  }
  const copy = gl.copyTexSubImage2D.bind(gl)
  gl.copyTexSubImage2D = (...args) => {
    copies++
    return copy(...args)
  }

  const render = (thickness, magnification = 1, bitmap = ramp, scale = -180) => {
    renderer.setScene({
      background: [0, 0, 0, 1],
      items: [
        {
          kind: 'sprite',
          space: 'viewport',
          rect: { x: 0, y: 0, width: size, height: size },
          opacity: 1,
          bitmap,
        },
        {
          ...glass,
          ...(thickness === undefined ? {} : { thickness }),
          magnification,
          displacement: [scale, scale, scale],
        },
      ],
    })
    check(renderer.render(frame), 'Frame renders')
    const pixels = new Uint8Array(canvas.width * canvas.height * 4)
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    check(gl.getError() === gl.NO_ERROR, 'Frame has no GPU error')
    return pixels
  }
  const pixel = (pixels, x, y) => {
    const i =
      ((canvas.height - Math.floor(y * frame.pixelRatio) - 1) * canvas.width +
        Math.floor(x * frame.pixelRatio)) *
      4
    return [pixels[i], pixels[i + 1], pixels[i + 2]]
  }
  const difference = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])))
  const regionDifference = (a, b, from = 120, to = 200) => {
    let maximum = 0,
      changed = 0
    for (let y = from; y < to; y += 1 / frame.pixelRatio)
      for (let x = from; x < to; x += 1 / frame.pixelRatio) {
        const d = difference(pixel(a, x, y), pixel(b, x, y))
        maximum = Math.max(maximum, d)
        if (d > 8) changed++
      }
    return { maximum, changed }
  }
  const rulerCenter = (pixels, from, to) => {
    let weight = 0,
      weighted = 0
    for (let x = from; x < to; x += 1 / frame.pixelRatio) {
      const w = Math.max(0, Math.min(...pixel(pixels, x, 160)) - 30)
      weight += w
      weighted += w * x
    }
    check(weight > 0, 'Ruler remains visible')
    return weighted / weight
  }
  const spacing = (pixels) => rulerCenter(pixels, 172, 197) - rulerCenter(pixels, 123, 149)
  const evidence = []
  try {
    for (const ratio of [1, 2]) {
      frame.pixelRatio = ratio
      const identity = render(0)
      const zeroScale = render(50, 1.25, ramp, 0)
      check(
        regionDifference(identity, zeroScale, 60, 260).maximum <= 1,
        'Zero displacement is identity for both rim and body'
      )
      const legacy = render(undefined)
      check(
        regionDifference(identity, legacy).maximum > 1,
        'Undefined thickness retains the legacy map profile'
      )
      const rows = []
      let previousExtent = -1
      for (const thickness of [5, 20, 50]) {
        const pixels = render(thickness)
        const body = regionDifference(identity, pixels)
        check(body.maximum === 0, `Thickness ${thickness} leaves the center exactly flat`)
        let extent = 0,
          peak = 0
        for (let depth = 0; depth < 100; depth += 1 / ratio) {
          const d = difference(pixel(identity, 60 + depth, 160), pixel(pixels, 60 + depth, 160))
          if (d > 0) extent = depth
          peak = Math.max(peak, d)
        }
        check(peak > 0, `Thickness ${thickness} still refracts its rim`)
        check(extent <= thickness, `Thickness ${thickness} limits the refracting band`)
        check(extent > previousExtent, 'Increasing thickness expands the refracting band')
        previousExtent = extent
        let edgeError = 0
        for (let step = 100; step <= 220; step += 10)
          for (const [x, y] of [
            [60, step],
            [259, step],
            [step, 60],
            [step, 259],
          ]) {
            edgeError = Math.max(edgeError, difference(pixel(identity, x, y), pixel(pixels, x, y)))
          }
        check(edgeError <= 1, 'Finite rim preserves continuous outer edges')
        rows.push({ thickness, extent, peak, centralError: body.maximum, edgeError })
      }
      check(
        regionDifference(identity, render(-10), 60, 260).maximum <= 1,
        'Negative thickness clamps to no rim'
      )
      check(
        regionDifference(render(20), render(Number.NaN), 60, 260).maximum === 0,
        'Invalid thickness uses the safe twenty-pixel default'
      )
      check(
        regionDifference(render(80), render(500), 60, 260).maximum === 0,
        'Thickness is capped at eighty pixels'
      )

      const flat = render(20, 1, grid)
      const flatSpacing = spacing(flat)
      const bulgedThin = render(5, 1.25, grid)
      const bulgedThick = render(50, 1.25, grid)
      const bulgedNoRim = render(0, 1.25, grid)
      const bulgedSpacing = spacing(bulgedThin)
      check(Math.abs(flatSpacing - 40) < 0.1, 'Default plate does not magnify the center')
      check(bulgedSpacing > flatSpacing + 6, 'Body curvature independently magnifies the center')
      check(
        regionDifference(bulgedThin, bulgedThick).maximum === 0,
        'Thickness leaves body optics unchanged outside its rim band'
      )
      check(
        regionDifference(bulgedThin, bulgedNoRim).maximum === 0,
        'Body curvature can remain active with no rim'
      )
      check(
        regionDifference(flat, bulgedThin).changed > 100 * ratio,
        'Body glyph and ruler pixels move when curvature is enabled'
      )

      // An update changes uniforms only; the same immutable textures stay uploaded.
      const before = { uploads, draws, copies }
      render(20, 1, grid)
      const flatWork = { draws: draws - before.draws, copies: copies - before.copies }
      const priorLens = { draws, copies }
      render(50, 1.25, grid)
      const curvedWork = { draws: draws - priorLens.draws, copies: copies - priorLens.copies }
      check(uploads === before.uploads, 'Thickness and curvature updates upload no new textures')
      check(
        flatWork.draws === curvedWork.draws && flatWork.copies === curvedWork.copies,
        'Curvature adds no render passes'
      )
      const beforeScroll = uploads
      check(renderer.render({ ...frame, scrollY: 20 }), 'Scrolling renders the cached scene')
      check(uploads === beforeScroll, 'Scrolling uploads no textures')
      evidence.push({
        ratio,
        rows,
        flatSpacing,
        bulgedSpacing,
        uniformUploads: uploads - before.uploads,
        flatWork,
        curvedWork,
      })
    }
    return { checks, evidence }
  } finally {
    renderer.dispose()
    canvas.remove()
  }
}

let opened = false
try {
  browser(['open', 'about:blank'])
  opened = true
  const { result } = browser(
    ['eval', '--stdin'],
    `${bundle}\n(${verifyThickness.toString()})(ThicknessFixture)`
  )
  assert.ok(result.checks >= 40)
  console.log(JSON.stringify(result))
  console.log(`PASS independent glass thickness: ${result.checks} assertions`)
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
