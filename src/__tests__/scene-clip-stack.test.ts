import { describe, expect, it } from 'vitest'
import { MAX_SCENE_CLIPS, packSceneClips, sceneClips } from '../scene/clip-stack'
import type { SceneClip, SceneItem } from '../scene/types'

const frame = { width: 200, height: 150, scrollX: 20, scrollY: 30, pixelRatio: 2 }
const documentClip: SceneClip = {
  rect: { x: 30, y: 50, width: 90, height: 60 },
  space: 'document',
  radius: 12,
}
const viewportClip: SceneClip = {
  rect: { x: 40, y: 10, width: 60, height: 80 },
  space: 'viewport',
  radius: 8,
  roundness: 4,
}

describe('scene clip stacks', () => {
  it('packs each coordinate space and intersects their scissor bounds', () => {
    const packed = packSceneClips([documentClip, viewportClip], frame)
    expect(packed?.bounds).toEqual({ x: 40, y: 20, width: 60, height: 60 })
    expect(Array.from(packed?.rects ?? []).slice(0, 8)).toEqual([10, 20, 90, 60, 40, 10, 60, 80])
    expect(Array.from(packed?.shapes ?? []).slice(0, 4)).toEqual([12, 2, 8, 4])
  })

  it('retains the legacy single clip and gives a full stack precedence', () => {
    const item: SceneItem = {
      kind: 'solid',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      space: 'viewport',
      opacity: 1,
      radius: 0,
      color: [1, 0, 0, 1],
      clip: documentClip,
    }
    expect(sceneClips(item)).toEqual([documentClip])
    expect(sceneClips({ ...item, clips: [viewportClip, documentClip] })).toEqual([
      viewportClip,
      documentClip,
    ])
  })

  it('rejects invalid geometry and stacks deeper than the shader supports', () => {
    expect(packSceneClips(Array(MAX_SCENE_CLIPS + 1).fill(documentClip), frame)).toBeNull()
    expect(packSceneClips([{ ...documentClip, radius: Number.NaN }], frame)).toBeNull()
  })
})
