import { afterEach, describe, expect, it } from 'vitest'
import { glassSamplingRegions } from '../scene/continuity'
import {
  enclosingRegion,
  projectScrollCapture,
  scrollCaptureRegions,
  type ScrollCapture,
  type ScrollGeometry,
} from '../scene/scroll-reuse'
import { GLASS_STUDIO_DEFAULTS } from '../studio-props'
import type { CompiledScene, SceneFrame, SceneGlass, SceneItem, SceneRect } from '../scene/types'

const frame: SceneFrame = {
  width: 400,
  height: 800,
  pixelRatio: 2,
  devicePixelRatio: 3,
  scrollX: 0,
  scrollY: 100,
}
const nextFrame: SceneFrame = { ...frame, scrollY: 150 }
const studio = {
  ...GLASS_STUDIO_DEFAULTS,
  refDistance: 0,
  blurRadius: 0,
  shadowFactor: 0,
  shapeRoundness: 2,
}

function glass(rect: SceneRect): SceneGlass {
  return {
    kind: 'glass',
    rect,
    space: 'viewport',
    opacity: 1,
    radius: rect.height / 2,
    displacement: [0, 0, 0],
    blur: 0,
    saturation: 1,
    tint: [0, 0, 0, 0],
    studio,
  }
}

function opticalRegions(item: SceneGlass) {
  const regions = glassSamplingRegions([{ rect: item.rect, studio }], frame)
  if (!regions) throw new Error('Fixture needs valid optical bounds')
  return regions
}

function fixture() {
  const pane = document.createElement('div')
  document.body.append(pane)
  const oldGlass = glass({ x: 40, y: 20, width: 320, height: 64 })
  const newGlass = glass({ x: 60, y: 42, width: 280, height: 60 })
  const body: SceneItem = {
    kind: 'solid',
    rect: { x: 0, y: 0, width: 400, height: 6000 },
    space: 'document',
    opacity: 1,
    radius: 0,
    color: [0.2, 0.3, 0.4, 1],
  }
  const oldControl: SceneItem = {
    kind: 'solid',
    rect: { x: 60, y: 38, width: 30, height: 30 },
    space: 'viewport',
    opacity: 1,
    radius: 4,
    color: [1, 0, 0, 1],
  }
  const newControl: SceneItem = {
    ...oldControl,
    rect: { x: 80, y: 58, width: 24, height: 24 },
    color: [0, 0, 1, 1],
  }
  const geometry: ScrollGeometry = {
    host: { x: 0, y: 0, width: 400, height: 6000 },
    container: { x: 0, y: 0, width: 400, height: 800 },
    panes: [{ element: pane, rect: oldGlass.rect }],
    documentWidth: 400,
    documentHeight: 6000,
  }
  const movedGeometry: ScrollGeometry = {
    ...geometry,
    panes: [{ element: pane, rect: newGlass.rect }],
  }
  const regions = opticalRegions(newGlass)
  const padded = scrollCaptureRegions(opticalRegions(oldGlass), frame.height)
  const paddedRegion = enclosingRegion(padded)
  if (!paddedRegion) throw new Error('Fixture needs valid capture bounds')
  const capture: ScrollCapture = {
    frame,
    geometry,
    regions: padded,
    styles: 'css',
    compiled: {
      scrollTranslationSafe: true,
      scene: {
        background: [0.1, 0.2, 0.3, 1],
        items: [body, oldGlass, oldControl],
        samplingRegion: paddedRegion,
        samplingRegions: padded,
        renderRegions: padded,
      },
      targets: [],
      issues: [],
      media: [],
      liveGeometry: true,
    },
  }
  const viewport: CompiledScene = {
    scene: { background: [0, 0, 0, 0], items: [newGlass, newControl] },
    targets: [],
    issues: [],
    media: [],
    liveGeometry: true,
  }
  const project = (fresh: CompiledScene = viewport, currentGeometry = movedGeometry) =>
    projectScrollCapture(capture, nextFrame, currentGeometry, regions, 'css', fresh)
  return {
    capture,
    viewport,
    pane,
    body,
    oldGlass,
    oldControl,
    newGlass,
    newControl,
    geometry,
    movedGeometry,
    regions,
    project,
  }
}

afterEach(() => document.body.replaceChildren())

describe('fresh viewport paint over a retained document capture', () => {
  it('updates moving glass and controls without rebuilding or moving document paint', () => {
    const { capture, project, body, oldGlass, oldControl, newGlass, newControl, regions } =
      fixture()
    const result = project()
    expect(result).not.toBeNull()
    expect(result?.scene.items).toEqual([body, newGlass, newControl])
    expect(result?.scene.items[0]).toBe(body)
    expect(result?.scene.items[1]).toBe(newGlass)
    expect(result?.scene.items[2]).toBe(newControl)
    expect(result?.scene.items).not.toContain(oldGlass)
    expect(result?.scene.items).not.toContain(oldControl)
    expect(body.space).toBe('document')
    expect(result?.scene.background).toBe(capture.compiled.scene.background)
    expect(result?.scene.samplingRegions).toEqual(regions)
    expect(capture.compiled.scene.items).toEqual([body, oldGlass, oldControl])
  })

  it('still rejects changed pane bounds without a fresh viewport compilation', () => {
    const { capture, movedGeometry, regions } = fixture()
    expect(projectScrollCapture(capture, nextFrame, movedGeometry, regions, 'css')).toBeNull()
  })

  it('uses fresh viewport-only opacity groups and their latest child geometry', () => {
    const { viewport, newGlass, newControl, project, body } = fixture()
    const group: SceneItem = {
      kind: 'opacity-group',
      rect: newGlass.rect,
      space: 'viewport',
      opacity: 0.6,
      items: [newGlass, newControl],
      clips: [{ rect: newGlass.rect, space: 'viewport', radius: 30 }],
    }
    viewport.scene.items = [group]
    expect(project()?.scene.items).toEqual([body, group])
  })

  it.each(['host', 'container', 'document size'] as const)(
    'rejects changed %s geometry even with a fresh viewport suffix',
    (kind) => {
      const { project, viewport, movedGeometry } = fixture()
      const changed =
        kind === 'document size'
          ? { ...movedGeometry, documentHeight: movedGeometry.documentHeight + 1 }
          : { ...movedGeometry, [kind]: { ...movedGeometry[kind], width: 399 } }
      expect(project(viewport, changed)).toBeNull()
    }
  )

  it('rejects replaced and detached panes rather than matching only their rectangles', () => {
    const { project, viewport, movedGeometry, pane } = fixture()
    const replacement = document.createElement('div')
    document.body.append(replacement)
    expect(
      project(viewport, {
        ...movedGeometry,
        panes: [{ element: replacement, rect: movedGeometry.panes[0]!.rect }],
      })
    ).toBeNull()
    pane.remove()
    expect(project()).toBeNull()
  })

  it('requires the moved pane optics to remain inside captured document coverage', () => {
    const { capture, viewport, movedGeometry } = fixture()
    const distantGlass = glass({ x: 60, y: 700, width: 280, height: 60 })
    viewport.scene.items = [distantGlass]
    expect(
      projectScrollCapture(
        capture,
        nextFrame,
        { ...movedGeometry, panes: [{ ...movedGeometry.panes[0]!, rect: distantGlass.rect }] },
        opticalRegions(distantGlass),
        'css',
        viewport
      )
    ).toBeNull()
  })

  it('rejects interleaved document and viewport paint rather than reordering it', () => {
    const { capture, oldGlass, body, oldControl, project } = fixture()
    capture.compiled.scene.items = [oldGlass, body, oldControl]
    expect(project()).toBeNull()
  })

  it('rejects a fresh viewport compile with pending or unsupported pixels', () => {
    const { viewport, project } = fixture()
    viewport.issues = ['SVG is loading']
    expect(project()).toBeNull()
    viewport.issues = ['CSS filters outside LiquidGlass require native HTML rendering']
    expect(project()).toBeNull()
  })

  it('rejects document paint in the fresh fixed-branch result', () => {
    const { viewport, body, newGlass, project } = fixture()
    viewport.scene.items = [body, newGlass]
    expect(project()).toBeNull()
  })

  it('rejects viewport paint with a document-space clip', () => {
    const { viewport, newGlass, project } = fixture()
    viewport.scene.items = [
      {
        ...newGlass,
        clips: [{ rect: { x: 0, y: 0, width: 400, height: 800 }, space: 'document', radius: 0 }],
      },
    ]
    expect(project()).toBeNull()
  })

  it('rejects mixed-space children and masks inside a viewport group', () => {
    const { viewport, body, newGlass, project } = fixture()
    const group: SceneItem = {
      kind: 'opacity-group',
      rect: newGlass.rect,
      space: 'viewport',
      opacity: 0.5,
      items: [body, newGlass],
    }
    viewport.scene.items = [group]
    expect(project()).toBeNull()
    const mask = document.createElement('canvas')
    viewport.scene.items = [
      {
        ...group,
        items: [newGlass],
        mask: { bitmap: mask, rect: newGlass.rect, space: 'document' },
      },
    ]
    expect(project()).toBeNull()
  })

  it('rejects a new viewport backdrop that the document capture did not certify', () => {
    const { viewport, newGlass, project } = fixture()
    viewport.scene.items = [
      {
        kind: 'backdrop',
        rect: newGlass.rect,
        space: 'viewport',
        opacity: 1,
        bitmap: document.createElement('canvas'),
        sigma: 5,
        radius: 30,
      },
      newGlass,
    ]
    expect(project()).toBeNull()
  })

  it('rejects viewport glass shadows that can paint outside the certified pane', () => {
    const { viewport, newGlass, project } = fixture()
    viewport.scene.items = [{ ...newGlass, studio: { ...studio, shadowFactor: 1 } }]
    expect(project()).toBeNull()
  })

  it('replaces stale fixed targets and media while retaining document sources', () => {
    const { capture, viewport, project, body, oldGlass, newGlass } = fixture()
    const documentCanvas = document.createElement('canvas')
    const oldViewportCanvas = document.createElement('canvas')
    const documentMedia: SceneItem = {
      kind: 'media',
      source: documentCanvas,
      rect: { x: 0, y: 100, width: 100, height: 100 },
      space: 'document',
      opacity: 1,
      radius: 0,
      fit: 'fill',
      position: [0, 0],
    }
    const oldViewportMedia: SceneItem = {
      ...documentMedia,
      source: oldViewportCanvas,
      space: 'viewport',
    }
    const documentTarget = {
      element: document.createElement('button'),
      rect: body.rect,
      space: 'document' as const,
    }
    const oldTarget = {
      element: document.createElement('button'),
      rect: oldGlass.rect,
      space: 'viewport' as const,
    }
    const newTarget = {
      element: document.createElement('button'),
      rect: newGlass.rect,
      space: 'viewport' as const,
    }
    capture.compiled.scene.items = [body, documentMedia, oldGlass, oldViewportMedia]
    capture.compiled.targets = [documentTarget, oldTarget]
    capture.compiled.media = [documentCanvas, oldViewportCanvas]
    viewport.targets = [newTarget]
    const result = project()
    expect(result?.targets).toEqual([documentTarget, newTarget])
    expect(result?.media).toEqual([documentCanvas])
  })
})
