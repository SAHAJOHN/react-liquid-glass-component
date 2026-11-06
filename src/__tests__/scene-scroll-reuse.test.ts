import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  enclosingRegion,
  hasPlayingSceneMedia,
  projectScrollCapture,
  readScrollStyleEpoch,
  scrollCaptureMargin,
  scrollCaptureRegions,
  type ScrollCapture,
} from '../scene/scroll-reuse'
import type { SceneFrame } from '../scene/types'

const frame: SceneFrame = {
  width: 400,
  height: 800,
  pixelRatio: 2,
  devicePixelRatio: 3,
  scrollX: 0,
  scrollY: 100,
}
const regions = [{ x: 0, y: 10, width: 400, height: 100 }]
function fixture() {
  const pane = document.createElement('div')
  document.body.append(pane)
  const geometry = {
    host: { x: 0, y: 0, width: 400, height: 6000 },
    container: { x: 0, y: 0, width: 400, height: 800 },
    panes: [{ element: pane, rect: regions[0]! }],
    documentWidth: 400,
    documentHeight: 6000,
  }
  const padded = scrollCaptureRegions(regions, frame.height)
  const capture: ScrollCapture = {
    frame,
    geometry,
    styles: 'css',
    regions: padded,
    compiled: {
      scrollTranslationSafe: true,
      scene: {
        items: [],
        background: [1, 1, 1, 1],
        samplingRegion: enclosingRegion(padded)!,
        samplingRegions: padded,
        renderRegions: padded,
      },
      targets: [],
      issues: [],
      media: [],
      liveGeometry: true,
    },
  }
  return { pane, geometry, capture }
}
afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('scroll capture projection', () => {
  it('reuses document items while updating actual optics and captured source coordinates', () => {
    const { capture, geometry } = fixture()
    const next = projectScrollCapture(capture, { ...frame, scrollY: 200 }, geometry, regions, 'css')
    expect(next?.scene.items).toBe(capture.compiled.scene.items)
    expect(next?.scene.samplingRegions).toEqual(regions)
    expect(next?.scene.samplingRegion).toEqual(regions[0])
    expect(next?.scene.renderRegions?.[0]?.y).toBe(capture.regions[0]!.y - 100)
    expect(capture.compiled.scene.samplingRegions).toEqual(capture.regions)
  })
  it('accepts both scroll directions inside the capture and refuses either boundary crossing', () => {
    const { capture, geometry } = fixture()
    const margin = scrollCaptureMargin(frame.height)
    for (const delta of [-margin, margin])
      expect(
        projectScrollCapture(
          capture,
          { ...frame, scrollY: frame.scrollY + delta },
          geometry,
          regions,
          'css'
        )
      ).not.toBeNull()
    for (const delta of [-margin - 1, margin + 1])
      expect(
        projectScrollCapture(
          capture,
          { ...frame, scrollY: frame.scrollY + delta },
          geometry,
          regions,
          'css'
        )
      ).toBeNull()
  })
  it.each(['width', 'height', 'pixelRatio', 'devicePixelRatio', 'scrollX'] as const)(
    'rejects changed %s',
    (key) => {
      const { capture, geometry } = fixture()
      expect(
        projectScrollCapture(
          capture,
          { ...frame, [key]: (frame[key] ?? 0) + 1 },
          geometry,
          regions,
          'css'
        )
      ).toBeNull()
    }
  )
  it('rejects mutated host, fixed pane and document extent even without a mutation event', () => {
    const { capture, geometry } = fixture()
    expect(
      projectScrollCapture(
        capture,
        frame,
        { ...geometry, host: { ...geometry.host, height: 6001 } },
        regions,
        'css'
      )
    ).toBeNull()
    expect(
      projectScrollCapture(
        capture,
        frame,
        { ...geometry, panes: geometry.panes.map((p) => ({ ...p, rect: { ...p.rect, y: 11 } })) },
        regions,
        'css'
      )
    ).toBeNull()
    expect(
      projectScrollCapture(capture, frame, { ...geometry, documentHeight: 6001 }, regions, 'css')
    ).toBeNull()
  })
  it('rejects replacement/detached panes and unproven CSS', () => {
    const { capture, geometry, pane } = fixture()
    expect(projectScrollCapture(capture, frame, geometry, regions, null)).toBeNull()
    expect(projectScrollCapture(capture, frame, geometry, regions, 'new css')).toBeNull()
    pane.remove()
    expect(projectScrollCapture(capture, frame, geometry, regions, 'css')).toBeNull()
  })
  it('requires every disjoint pane source and retains the gap', () => {
    const { capture, geometry } = fixture()
    const separate = [
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 300, y: 0, width: 20, height: 20 },
    ]
    capture.regions = scrollCaptureRegions(separate, frame.height)
    expect(
      projectScrollCapture(capture, frame, geometry, separate, 'css')?.scene.samplingRegions
    ).toEqual(separate)
    expect(
      projectScrollCapture(
        capture,
        frame,
        geometry,
        [...separate, { x: 150, y: 0, width: 20, height: 20 }],
        'css'
      )
    ).toBeNull()
  })
  it('never reuses unsupported or nonfinite captures', () => {
    const { capture, geometry } = fixture()
    capture.compiled.issues = ['Image is loading']
    expect(projectScrollCapture(capture, frame, geometry, regions, 'css')).toBeNull()
    capture.compiled.issues = []
    expect(
      projectScrollCapture(capture, { ...frame, scrollY: NaN }, geometry, regions, 'css')
    ).toBeNull()
    capture.compiled.scrollTranslationSafe = false
    expect(projectScrollCapture(capture, frame, geometry, regions, 'css')).toBeNull()
  })
  it('does not keep scheduling a captured canvas outside current source pixels', () => {
    const { capture } = fixture()
    const source = document.createElement('canvas')
    const scene = {
      ...capture.compiled.scene,
      renderRegions: regions,
      items: [
        {
          kind: 'media' as const,
          source,
          rect: { x: 0, y: 500, width: 100, height: 100 },
          space: 'document' as const,
          opacity: 1,
          radius: 0,
          fit: 'fill' as const,
          position: [0, 0] as const,
        },
      ],
    }
    expect(hasPlayingSceneMedia(scene, frame)).toBe(false)
    expect(hasPlayingSceneMedia(scene, { ...frame, scrollY: 450 })).toBe(true)
  })
})

describe('scroll style epoch', () => {
  it('observes imperative form state that changes CSS without an attribute mutation', () => {
    const input = document.createElement('input')
    input.type = 'checkbox'
    document.body.append(input)
    const before = readScrollStyleEpoch()
    input.checked = true
    expect(input.hasAttribute('checked')).toBe(false)
    expect(readScrollStyleEpoch()).not.toBe(before)
  })
  it('observes direct CSSOM replacement even when rule count and DOM text stay unchanged', () => {
    const style = document.createElement('style')
    style.textContent = '.sample{color:red}'
    document.head.append(style)
    try {
      const before = readScrollStyleEpoch()
      expect(before).not.toBeNull()
      style.sheet!.deleteRule(0)
      style.sheet!.insertRule('.sample{color:blue}')
      expect(style.textContent).toBe('.sample{color:red}')
      expect(readScrollStyleEpoch()).not.toBe(before)
    } finally {
      style.remove()
    }
  })
  it('disables reuse when CSSOM is unreadable', () => {
    vi.spyOn(document, 'styleSheets', 'get').mockImplementation(() => {
      throw new DOMException('Cross origin', 'SecurityError')
    })
    expect(readScrollStyleEpoch()).toBeNull()
  })
})
