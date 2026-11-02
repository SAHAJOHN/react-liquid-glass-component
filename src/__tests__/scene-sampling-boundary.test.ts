import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  samplingBoundaryChanged,
  samplingRelation,
  validSamplingRegion,
} from '../scene/sampling-boundary'
import type { SamplingWatch, SceneRect } from '../scene/types'

const region: SceneRect = { x: 40, y: 100, width: 200, height: 100 }

function fixture() {
  const host = document.createElement('div')
  const image = document.createElement('img')
  host.append(image)
  document.body.append(host)
  const rect = vi.spyOn(image, 'getBoundingClientRect')
  rect.mockReturnValue(new DOMRect(10, 10, 20, 20))
  const watches: SamplingWatch[] = [{ element: image, relation: 'outside' }]
  return { host, image, rect, watches }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('sampling region boundary checks', () => {
  it('keeps boundary pixels and rejects invalid geometry', () => {
    expect(samplingRelation({ x: 50, y: 79, width: 20, height: 20 }, region)).toBe('inside')
    expect(samplingRelation({ x: 50, y: 78.9, width: 20, height: 20 }, region)).toBe('outside')
    expect(samplingRelation({ x: Infinity, y: 0, width: 1, height: 1 }, region)).toBe('invalid')
    expect(samplingRelation({ x: 0, y: 0, width: 1, height: 1 }, undefined)).toBe('invalid')
    expect(validSamplingRegion({ ...region, width: NaN })).toBe(false)
    expect(validSamplingRegion(region)).toBe(true)
  })

  it('does not request a recompile for repeated movement wholly outside the same region', () => {
    const { host, rect, watches } = fixture()
    for (let y = 0; y < 40; y++) {
      rect.mockReturnValue(new DOMRect(50, y, 20, 20))
      expect(samplingBoundaryChanged(host, watches, region)).toBe(false)
    }
    expect(rect).toHaveBeenCalledTimes(40)
  })

  it('detects both entry and exit for a moving asset or a moving pane region', () => {
    const { host, image, rect, watches } = fixture()
    rect.mockReturnValue(new DOMRect(80, 120, 20, 20))
    expect(samplingBoundaryChanged(host, watches, region)).toBe(true)
    watches[0] = { element: image, relation: 'inside' }
    expect(samplingBoundaryChanged(host, watches, region)).toBe(false)
    expect(samplingBoundaryChanged(host, watches, { ...region, y: 400 })).toBe(true)
  })

  it('fails closed on detached, moved-outside-host and invalid elements or regions', () => {
    const { host, image, rect, watches } = fixture()
    expect(samplingBoundaryChanged(host, watches, undefined)).toBe(true)
    expect(samplingBoundaryChanged(host, watches, { ...region, height: 0 })).toBe(true)
    rect.mockReturnValue(new DOMRect(0, 0, 0, 0))
    expect(samplingBoundaryChanged(host, watches, region)).toBe(true)
    rect.mockReturnValue(new DOMRect(0, 0, 20, 20))
    document.body.append(image)
    expect(image.isConnected).toBe(true)
    expect(samplingBoundaryChanged(host, watches, region)).toBe(true)
    image.remove()
    expect(samplingBoundaryChanged(host, watches, region)).toBe(true)
  })
})
