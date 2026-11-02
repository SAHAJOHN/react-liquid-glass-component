import type { SceneClip, SceneFrame, SceneItem, SceneRect } from './types'

/** Bound shader uniforms and reject deeper trees instead of dropping a clip. */
export const MAX_SCENE_CLIPS = 4

export function sceneClips(item: SceneItem): readonly SceneClip[] {
  return item.clips ?? (item.clip ? [item.clip] : [])
}

export function viewportClip(clip: SceneClip, frame: SceneFrame): SceneRect {
  return {
    x: clip.rect.x - (clip.space === 'document' ? frame.scrollX : 0),
    y: clip.rect.y - (clip.space === 'document' ? frame.scrollY : 0),
    width: clip.rect.width,
    height: clip.rect.height,
  }
}

/** Packs stable-size uniform arrays for both rendering pipelines. */
export function packSceneClips(clips: readonly SceneClip[], frame: SceneFrame) {
  if (clips.length > MAX_SCENE_CLIPS) return null
  const rects = new Float32Array(MAX_SCENE_CLIPS * 4)
  const shapes = new Float32Array(MAX_SCENE_CLIPS * 2)
  let left = 0
  let top = 0
  let right = frame.width
  let bottom = frame.height
  for (const [i, clip] of clips.entries()) {
    const rect = viewportClip(clip, frame)
    if (
      ![rect.x, rect.y, rect.width, rect.height, clip.radius, clip.roundness ?? 2].every(
        Number.isFinite
      ) ||
      rect.width < 0 ||
      rect.height < 0 ||
      clip.radius < 0 ||
      (clip.roundness ?? 2) <= 0
    )
      return null
    rects.set([rect.x, rect.y, rect.width, rect.height], i * 4)
    shapes.set([clip.radius, clip.roundness ?? 2], i * 2)
    left = Math.max(left, rect.x)
    top = Math.max(top, rect.y)
    right = Math.min(right, rect.x + rect.width)
    bottom = Math.min(bottom, rect.y + rect.height)
  }
  return { rects, shapes, bounds: { x: left, y: top, width: right - left, height: bottom - top } }
}
