import { render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { LiquidGlass } from '../LiquidGlass'
import { LiquidGlassSceneContext, type SceneController } from '../scene/context'

function fixture(initialProps: ComponentProps<typeof LiquidGlass> = {}) {
  const cleanups: ReturnType<typeof vi.fn>[] = []
  const controller: SceneController = {
    register: vi.fn(() => {
      const cleanup = vi.fn()
      cleanups.push(cleanup)
      return cleanup
    }),
    update: vi.fn(),
  }
  const renderGlass = (props: ComponentProps<typeof LiquidGlass>) => (
    <LiquidGlassSceneContext.Provider value={controller}>
      <LiquidGlass {...props} />
    </LiquidGlassSceneContext.Provider>
  )
  const result = render(renderGlass(initialProps))
  return {
    ...result,
    controller,
    cleanups,
    rerenderGlass: (props: ComponentProps<typeof LiquidGlass>) => result.rerender(renderGlass(props)),
  }
}

describe('managed LiquidGlass option stability', () => {
  it('does not register again for an equivalent inline Studio material', () => {
    const { controller, cleanups, rerenderGlass } = fixture({
      tint: { r: 22, g: 35, b: 43, a: 0.75 },
      shadowPosition: { x: 2, y: -4 },
    })

    rerenderGlass({
      tint: { r: 22, g: 35, b: 43, a: 0.75 },
      shadowPosition: { x: 2, y: -4 },
    })

    expect(controller.register).toHaveBeenCalledTimes(1)
    expect(cleanups[0]).not.toHaveBeenCalled()
  })

  it('registers again when a Studio scalar, tint channel, or legacy mode changes', () => {
    const tint = { r: 22, g: 35, b: 43, a: 0.75 }
    const { controller, cleanups, rerenderGlass } = fixture({ tint, glareFactor: 90 })

    rerenderGlass({ tint, glareFactor: 91 })
    tint.g = 36
    rerenderGlass({ tint, glareFactor: 91 })
    rerenderGlass({ glassColor: '#fff', backgroundOpacity: 0 })

    expect(controller.register).toHaveBeenCalledTimes(4)
    expect(cleanups).toHaveLength(4)
    expect(cleanups.slice(0, 3).every((cleanup) => cleanup.mock.calls.length === 1)).toBe(true)
    expect(controller.register).toHaveBeenLastCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ legacyTint: true })
    )
  })

  it('keeps unrelated rerenders stable and unregisters on unmount', () => {
    const { controller, cleanups, rerenderGlass, unmount } = fixture({ className: 'before' })

    rerenderGlass({ className: 'after' })
    expect(controller.register).toHaveBeenCalledTimes(1)

    unmount()
    expect(cleanups[0]).toHaveBeenCalledTimes(1)
  })

  it('preserves legacy aliases and explicit Studio overrides', () => {
    const { controller, rerenderGlass } = fixture({
      thickness: 40,
      displace: 4,
      distortionScale: -90,
    })
    expect(controller.register).toHaveBeenLastCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        studio: expect.objectContaining({ refThickness: 40, blurRadius: 4, refDistance: 0.025 }),
      })
    )

    rerenderGlass({ thickness: 40, displace: 4, distortionScale: -90, refThickness: 12 })
    expect(controller.register).toHaveBeenLastCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ studio: expect.objectContaining({ refThickness: 12 }) })
    )
  })
})
