import { createContext } from 'react'
import type { GlassOptions } from './types'

export interface SceneController {
  /** Whether opt-in layered panes can render native content over a per-pane image. */
  layered: boolean
  register(element: HTMLElement, options: GlassOptions): () => void
  update(element: HTMLElement, options: GlassOptions): void
  repaint(): void
}

export const LiquidGlassSceneContext = createContext<SceneController | null>(null)
