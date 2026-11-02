// Run from web/: node scripts/verify-managed-scene.mjs
// Requires the installed agent-browser CLI and Chromium.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../../package.json', import.meta.url))
const { buildSync } = require('esbuild')
const bundle = buildSync({
  stdin: {
    contents: `export { createSceneCompiler } from './src/scene/dom-scene'; export { createSceneRenderer } from './src/scene/renderer';`,
    resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'ManagedScene',
  target: 'es2020',
}).outputFiles[0].text
const session = `liquid-managed-check-${process.pid}`

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

async function verifyScene(api) {
  const checks = []
  const check = (condition, message) => {
    if (!condition) throw new Error(message)
    checks.push(message)
  }
  const near = (a, b, tolerance = 3) => a.every((value, i) => Math.abs(value - b[i]) <= tolerance)
  const next = () => new Promise((resolve) => requestAnimationFrame(resolve))
  document.body.style.cssText = 'margin:0;background:#001021'
  const root = document.createElement('main')
  root.style.cssText =
    'position:relative;width:400px;height:1200px;color:white;font:24px/30px sans-serif'
  const yellowImage =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#ffff00"/></svg>'
    )
  root.innerHTML = `
    <div id="gradient" style="position:absolute;left:0;top:0;width:200px;height:80px;background:linear-gradient(to right,#ff0000,#0000ff)"></div>
    <p id="text" style="position:absolute;left:20px;top:110px;width:240px;margin:0">Real <strong style="color:#ffdd00">HTML</strong> text</p>
    <div id="glass" style="position:absolute;left:10px;top:100px;width:240px;height:70px;border-radius:12px"></div>
    <svg style="position:absolute;left:280px;top:20px;width:40px;height:40px" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#00ff00"/></svg>
    <img alt="Fixture" src="${yellowImage}" style="position:absolute;left:280px;top:80px;width:40px;height:40px;object-fit:contain"/>
    <div id="clip" style="position:absolute;left:20px;top:230px;width:80px;height:40px;overflow:hidden;border-radius:8px"><div style="position:absolute;left:40px;top:0;width:140px;height:40px;background:#00ff00"></div></div>
    <input id="input" value="Editable" style="position:absolute;left:200px;top:230px;width:160px;height:40px;box-sizing:border-box;appearance:none;border:1px solid white;background:#001021;color:white;font:16px sans-serif;padding:4px"/>
    <button id="button" style="position:absolute;left:20px;top:300px;border:0;background:#25384b;color:white;font:16px sans-serif;padding:10px">Copy</button>
    <div id="fixed" style="position:fixed;left:340px;top:340px;width:30px;height:30px;background:#ff0000"></div>
  `
  document.body.appendChild(root)
  const output = document.createElement('canvas')
  document.body.appendChild(output)
  const renderer = api.createSceneRenderer(output)
  check(renderer !== null, 'Managed renderer initializes')
  const gl = output.getContext('webgl')
  let invalidations = 0
  const compiler = api.createSceneCompiler(() => {
    invalidations += 1
  })
  const glass = root.querySelector('#glass')
  const options = {
    radius: 12,
    displacement: [-180, -180, -180],
    blur: 0,
    saturation: 1,
    color: '#000',
    opacity: 0,
  }
  const glasses = new Map([[glass, options]])
  const frame = { scrollX: 0, scrollY: 0, width: 400, height: 400, pixelRatio: 1 }
  const compile = () => compiler.compile(root, glasses, frame, '#001021')
  const settled = async () => {
    let compiled = compile()
    for (
      let attempt = 0;
      compiled.issues.some((issue) => /loading/i.test(issue)) && attempt < 90;
      attempt++
    ) {
      await next()
      compiled = compile()
    }
    return compiled
  }
  const pixel = (x, y) => {
    const rgba = new Uint8Array(4)
    gl.readPixels(x, output.height - y - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
    return Array.from(rgba)
  }
  const capture = () => {
    const data = new Uint8Array(output.width * output.height * 4)
    gl.readPixels(0, 0, output.width, output.height, gl.RGBA, gl.UNSIGNED_BYTE, data)
    return data
  }
  const draw = (compiled) => {
    renderer.setScene(compiled.scene)
    check(renderer.render(frame), 'Compiled DOM renders')
    check(gl.getError() === gl.NO_ERROR, 'DOM render has no GL errors')
  }

  try {
    const compiled = await settled()
    check(
      compiled.issues.length === 0,
      `Ordinary DOM compiles without issues: ${compiled.issues.join('; ')}`
    )
    check(invalidations >= 2, 'SVG and image loading invalidate the scene')
    check(
      !root.querySelector('[data-scene-text],[data-scene-glass]'),
      'Fixture requires no scene annotations'
    )
    check(
      compiled.targets.some((target) => target.element.id === 'button'),
      'Native button is an interaction target'
    )
    check(
      compiled.targets.some((target) => target.element.id === 'input'),
      'Native input is an interaction target'
    )
    draw(compiled)
    const left = pixel(10, 40),
      right = pixel(190, 40)
    check(
      left[0] > 220 && left[2] < 35 && right[2] > 220 && right[0] < 35,
      'CSS gradient paints in the correct direction'
    )
    const svgSprite = compiled.scene.items.find(
      (item) => item.kind === 'sprite' && item.rect.x === 280 && item.rect.y === 20
    )
    check(
      near(pixel(300, 40), [0, 255, 0, 255]),
      `Inline SVG paints without markers: ${pixel(300, 40)}; source=${svgSprite ? Array.from(svgSprite.bitmap.getContext('2d').getImageData(20, 20, 1, 1).data) : 'missing'}`
    )
    check(
      near(pixel(300, 100), [255, 255, 0, 255]),
      `Image paints without markers: ${pixel(300, 100)}`
    )
    check(
      near(pixel(70, 250), [0, 255, 0, 255]),
      'Overflow content remains visible inside its clip'
    )
    check(
      near(pixel(110, 250), [0, 16, 33, 255]),
      'Overflow content is clipped outside its container'
    )
    check(near(pixel(350, 350), [255, 0, 0, 255]), 'Fixed element appears at viewport coordinates')
    const refracted = capture()
    glasses.set(glass, { ...options, displacement: [0, 0, 0] })
    draw(compile())
    const plain = capture()
    let changedTextPixels = 0
    for (let y = 100; y < 170; y++)
      for (let x = 10; x < 250; x++) {
        const index = ((399 - y) * 400 + x) * 4
        if (
          Math.abs(refracted[index] - plain[index]) > 30 ||
          Math.abs(refracted[index + 1] - plain[index + 1]) > 30
        )
          changedTextPixels++
      }
    check(changedTextPixels > 10, 'Glass refracts automatically compiled text pixels')
    glasses.set(glass, options)

    let uploads = 0
    const upload = gl.texImage2D.bind(gl)
    gl.texImage2D = (...args) => {
      uploads++
      return upload(...args)
    }
    const cached = compile()
    draw(cached)
    check(uploads === 0, 'Unchanged DOM reuses uploaded textures')
    frame.scrollY = 30
    check(renderer.render(frame), 'Scroll-only frame renders')
    check(uploads === 0, 'Scroll-only frame uploads no textures')
    check(
      near(pixel(350, 350), [255, 0, 0, 255]),
      'Fixed element stays fixed while the scene scrolls'
    )
    frame.scrollY = 0

    const textElement = root.querySelector('#text')
    const cachedSprites = new Set(
      cached.scene.items.filter((item) => item.kind === 'sprite').map((item) => item.bitmap)
    )
    textElement.style.transform = 'translate(7px, 13px)'
    textElement.style.opacity = '0.5'
    const translated = compile()
    check(translated.issues.length === 0, 'Translation and opacity are supported')
    const newSprites = translated.scene.items.filter(
      (item) => item.kind === 'sprite' && !cachedSprites.has(item.bitmap)
    )
    check(newSprites.length === 0, 'Translation and opacity reuse cached text bitmaps')
    check(
      translated.scene.items.some((item) => item.kind === 'sprite' && item.opacity === 0.5),
      'Inherited opacity reaches text primitives'
    )
    textElement.style.transform = 'none'
    textElement.style.opacity = '1'
    textElement.firstChild.textContent = 'Changed '
    draw(compile())
    check(uploads > 0, 'Text content changes upload a new bitmap')
    gl.texImage2D = upload

    const input = root.querySelector('#input')
    input.focus()
    check(
      compile().issues.some((issue) => /editing/.test(issue)),
      'Focused input requests native editing'
    )
    input.blur()
    check(compile().issues.length === 0, 'Unfocused input returns to canvas rendering')
    const sticky = document.createElement('div')
    sticky.style.cssText = 'position:sticky;top:0'
    sticky.textContent = 'Sticky'
    root.appendChild(sticky)
    check(compile().liveGeometry, 'Sticky content requests live geometry')
    sticky.remove()
    textElement.style.transform = 'rotate(10deg)'
    check(
      compile().issues.some((issue) => /Rotated/.test(issue)),
      'Unsupported rotation is reported'
    )
    textElement.style.transform = 'none'
    const iframe = document.createElement('iframe')
    root.appendChild(iframe)
    check(
      compile().issues.some((issue) => /Embedded/.test(issue)),
      'Embedded document is reported instead of omitted silently'
    )
    iframe.remove()
    check(compile().issues.length === 0, 'Removing unsupported content recovers the scene')

    const conflict = document.createElement('div')
    conflict.innerHTML =
      '<div style="position:relative"><div style="position:absolute;z-index:100;left:40px;top:200px;width:80px;height:40px;background:red"></div></div><div style="position:absolute;z-index:1;left:40px;top:200px;width:80px;height:40px;background:blue"></div>'
    root.appendChild(conflict)
    check(
      compile().issues.some((issue) => /stacking/i.test(issue)),
      'Escaping descendant stacking order requests native rendering'
    )
    conflict.remove()
    check(compile().issues.length === 0, 'Removing the stacking conflict recovers the scene')

    const map = {
      borderRadius: 12,
      borderWidth: 0.07,
      brightness: 50,
      opacity: 0.93,
      blur: 11,
      mixBlendMode: 'difference',
      xChannel: 'R',
      yChannel: 'B',
    }
    const mappedPixels = async (changes) => {
      glasses.set(glass, { ...options, map: { ...map, ...changes } })
      const nextScene = await settled()
      check(
        nextScene.issues.length === 0,
        `Legacy optics map loads: ${nextScene.issues.join('; ')}`
      )
      draw(nextScene)
      return capture()
    }
    const baseline = await mappedPixels({})
    const legacyPropChanges = {}
    for (const [name, changes] of [
      ['borderWidth', { borderWidth: 0.5 }],
      ['brightness', { brightness: 85 }],
      ['opacity', { opacity: 0.15 }],
      ['blur', { blur: 0 }],
      ['mixBlendMode', { mixBlendMode: 'screen' }],
      ['xChannel', { xChannel: 'G' }],
      ['yChannel', { yChannel: 'G' }],
      ['reversedChannels', { xChannel: 'B', yChannel: 'R' }],
    ]) {
      const changed = await mappedPixels(changes)
      let pixels = 0
      for (let y = 100; y < 170; y++)
        for (let x = 10; x < 250; x++) {
          const index = ((399 - y) * 400 + x) * 4
          if (
            Math.abs(changed[index] - baseline[index]) > 8 ||
            Math.abs(changed[index + 1] - baseline[index + 1]) > 8 ||
            Math.abs(changed[index + 2] - baseline[index + 2]) > 8
          )
            pixels++
        }
      legacyPropChanges[name] = pixels
      check(pixels > 10, `Legacy ${name} changes rendered pixels: ${pixels}`)
    }
    const bodyPixels = async (magnification) => {
      glasses.set(glass, { ...options, map, magnification })
      const bodyScene = await settled()
      check(
        bodyScene.scene.items.some(
          (item) => item.kind === 'glass' && item.magnification === magnification
        ),
        'Compiler preserves managed body magnification'
      )
      draw(bodyScene)
      return capture()
    }
    const flatBody = await bodyPixels(1)
    const lensBody = await bodyPixels(1.2)
    let bodyChanges = 0
    // Only the middle 60% of the pane; an edge-only effect cannot pass this check.
    for (let y = 114; y < 156; y++)
      for (let x = 58; x < 202; x++) {
        const index = ((399 - y) * 400 + x) * 4
        if (
          Math.abs(flatBody[index] - lensBody[index]) > 20 ||
          Math.abs(flatBody[index + 1] - lensBody[index + 1]) > 20
        )
          bodyChanges++
      }
    check(bodyChanges > 10, 'Automatically compiled DOM text is refracted inside the central body')
    return {
      checks: checks.length,
      changedTextPixels,
      invalidations,
      legacyPropChanges,
      bodyChanges,
    }
  } finally {
    compiler.dispose()
    renderer.dispose()
    root.remove()
    output.remove()
  }
}

let opened = false
try {
  browser(['open', 'about:blank'])
  opened = true
  browser(['set', 'viewport', '400', '400'])
  const data = browser(['eval', '--stdin'], `${bundle}\n(${verifyScene.toString()})(ManagedScene)`)
  assert.ok(data.result.checks >= 25)
  assert.ok(data.result.changedTextPixels > 10)
  console.log(
    `PASS managed scene: ${data.result.checks} assertions; ${data.result.changedTextPixels} refracted DOM text pixels; ${data.result.invalidations} asset invalidations.`
  )
  console.log(`Legacy optics changed pixels: ${JSON.stringify(data.result.legacyPropChanges)}`)
  console.log(`Central DOM text pixels changed by body lens: ${data.result.bodyChanges}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  if (opened) {
    try {
      browser(['close'])
    } catch (error) {
      console.error(`Could not close owned session ${session}: ${error}`)
      process.exitCode = 1
    }
  }
}
