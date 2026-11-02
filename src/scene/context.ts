import { createContext } from 'react'
import type { GlassOptions } from './types'

export interface SceneController {
  register(element: HTMLElement, options: GlassOptions): () => void
  update(element: HTMLElement, options: GlassOptions): void
}

export const LiquidGlassSceneContext = createContext<SceneController | null>(null)
