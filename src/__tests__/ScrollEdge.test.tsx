import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { ScrollEdge } from '../ScrollEdge'

function viewport(container: HTMLElement) {
  const scrollable = container.querySelector('.scroll-edge__scrollable')
  const vertical = container.querySelector('.scroll-edge__mask-vertical')
  const horizontal = container.querySelector('.scroll-edge__mask-horizontal')
  if (
    !(scrollable instanceof HTMLElement) ||
    !(vertical instanceof HTMLElement) ||
    !(horizontal instanceof HTMLElement)
  ) {
    throw new Error('Missing ScrollEdge viewport')
  }
  Object.defineProperties(scrollable, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 300 },
    clientWidth: { configurable: true, value: 100 },
    scrollWidth: { configurable: true, value: 300 },
  })
  return { scrollable, vertical, horizontal }
}

describe('ScrollEdge', () => {
  it('renders children and forwards the root ref', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <ScrollEdge ref={ref}>
        <div data-testid="child">hello</div>
      </ScrollEdge>
    )
    expect(screen.getByTestId('child')).toBeInTheDocument()
    expect(ref.current).toBeInstanceOf(HTMLDivElement)
  })

  it('fades the correct vertical edges as the viewport scrolls', () => {
    const { container } = render(
      <ScrollEdge>
        <div>content</div>
      </ScrollEdge>
    )
    const { scrollable, vertical, horizontal } = viewport(container)
    fireEvent.scroll(scrollable)
    expect(vertical.style.maskImage).toContain('black 0px')
    expect(vertical.style.maskImage).toContain('transparent 100%')
    expect(horizontal.style.maskImage).toBe('')
    expect(container.querySelector('.scroll-edge__overlay--shadow')).not.toBeInTheDocument()

    scrollable.scrollTop = 100
    fireEvent.scroll(scrollable)
    expect(vertical.style.maskImage).toContain('transparent 0px')
    expect(vertical.style.maskImage).toContain('transparent 100%')
    expect(vertical.style.maskImage).toContain('24px')

    scrollable.scrollTop = 200
    fireEvent.scroll(scrollable)
    expect(vertical.style.maskImage).toContain('transparent 0px')
    expect(vertical.style.maskImage).toContain('black 100%')
  })

  it('combines vertical and horizontal fades using independent viewport masks', () => {
    const { container } = render(
      <ScrollEdge edges={['top', 'bottom', 'left', 'right']} shadowSize="2rem">
        <div>content</div>
      </ScrollEdge>
    )
    const { scrollable, vertical, horizontal } = viewport(container)
    scrollable.scrollTop = 100
    scrollable.scrollLeft = 100
    fireEvent.scroll(scrollable)
    expect(vertical.style.maskImage).toContain('to bottom')
    expect(horizontal.style.maskImage).toContain('to right')
    expect(vertical.style.maskImage).toContain('2rem')
    expect(horizontal.style.maskImage).toContain('transparent 0px')
    expect(horizontal.style.maskImage).toContain('transparent 100%')
    expect(vertical.contains(horizontal)).toBe(true)
    expect(horizontal.contains(scrollable)).toBe(true)

    scrollable.scrollLeft = 200
    fireEvent.scroll(scrollable)
    expect(horizontal.style.maskImage).toContain('black 100%')
  })

  it('only fades requested edges and clears masks when disabled or shadow is off', () => {
    const { container, rerender } = render(
      <ScrollEdge edges={['left']}>
        <div>content</div>
      </ScrollEdge>
    )
    const { scrollable, vertical, horizontal } = viewport(container)
    scrollable.scrollLeft = 100
    fireEvent.scroll(scrollable)
    expect(vertical.style.maskImage).toBe('')
    expect(horizontal.style.maskImage).toContain('transparent 0px')
    expect(horizontal.style.maskImage).toContain('black 100%')

    rerender(
      <ScrollEdge edges={['left']} disabled>
        <div>content</div>
      </ScrollEdge>
    )
    expect(horizontal.style.maskImage).toBe('')
    rerender(
      <ScrollEdge edges={['left']} shadow={false}>
        <div>content</div>
      </ScrollEdge>
    )
    expect(horizontal.style.maskImage).toBe('')
  })

  it('keeps gradual blur independent of the fade mask', () => {
    const { container } = render(
      <ScrollEdge shadow blur edges={['top', 'bottom']}>
        <div>content</div>
      </ScrollEdge>
    )
    const { scrollable, vertical } = viewport(container)
    fireEvent.scroll(scrollable)
    expect(vertical.style.maskImage).toContain('transparent 100%')
    expect(container.querySelectorAll('.scroll-edge__blur-layer').length).toBeGreaterThan(0)
    expect(container.querySelector('.scroll-edge__shadow')).not.toBeInTheDocument()
  })

  it('retains the existing page-target shadow overlay and custom color', () => {
    const { container } = render(
      <ScrollEdge target="page" edges={['top']} shadowColor="red">
        <div>content</div>
      </ScrollEdge>
    )
    const shadow = container.querySelector<HTMLElement>('.scroll-edge__shadow')
    expect(shadow?.style.background).toContain('red')
    expect(container.querySelectorAll('.scroll-edge__overlay--shadow')).toHaveLength(1)
    const { vertical, horizontal } = viewport(container)
    expect(vertical.style.maskImage).toBe('')
    expect(horizontal.style.maskImage).toBe('')
  })

  it('calls onScroll when scrolling', () => {
    const handleScroll = vi.fn()
    const { container } = render(
      <ScrollEdge onScroll={handleScroll}>
        <div>content</div>
      </ScrollEdge>
    )
    const { scrollable } = viewport(container)
    fireEvent.scroll(scrollable, { target: { scrollTop: 100 } })
    expect(handleScroll).toHaveBeenCalled()
  })

  it('uses preset edges for blur overlays', () => {
    const { container } = render(
      <ScrollEdge preset="footer" blur>
        <div>content</div>
      </ScrollEdge>
    )
    const overlay = container.querySelector<HTMLElement>('.scroll-edge__overlay--blur')
    expect(container.querySelectorAll('.scroll-edge__overlay--blur')).toHaveLength(1)
    expect(overlay?.style.bottom).toBe('0px')
    expect(overlay?.style.height).toBe('8rem')
  })

  it('applies preset values before component defaults', () => {
    const { container } = render(
      <ScrollEdge preset="subtle" blur>
        <div>content</div>
      </ScrollEdge>
    )
    const overlays = container.querySelectorAll<HTMLElement>('.scroll-edge__overlay--blur')
    const layers = container.querySelectorAll<HTMLElement>('.scroll-edge__blur-layer')
    expect(overlays).toHaveLength(2)
    expect(overlays[0]?.style.height).toBe('4rem')
    expect(layers).toHaveLength(6)
    expect(layers[0]?.style.opacity).toBe('0.8')
  })

  it('applies intense preset sizing and blur strength', () => {
    const { container } = render(
      <ScrollEdge preset="intense" blur>
        <div>content</div>
      </ScrollEdge>
    )
    const overlays = container.querySelectorAll<HTMLElement>('.scroll-edge__overlay--blur')
    const layers = overlays[0]?.querySelectorAll<HTMLElement>('.scroll-edge__blur-layer')
    expect(overlays[0]?.style.height).toBe('10rem')
    expect(layers).toHaveLength(8)
    expect(layers?.[7]?.style.backdropFilter).toBe('blur(4.000rem)')
  })

  it('applies page presets when target is omitted', () => {
    const { container } = render(
      <ScrollEdge preset="page-header">
        <div>content</div>
      </ScrollEdge>
    )
    const overlay = container.querySelector<HTMLElement>('.scroll-edge__overlay--shadow')
    expect(overlay).toBeInTheDocument()
    expect(overlay?.style.position).toBe('fixed')
    expect(overlay?.style.top).toBe('0px')
    expect(overlay?.style.height).toBe('24px')
  })

  it('lets explicit values override preset values, including false and zero', () => {
    const { container } = render(
      <ScrollEdge
        preset="subtle"
        blur
        edgeSize="2rem"
        divCount={2}
        blurStrength={0}
        opacity={0}
        target="parent"
      >
        <div>content</div>
      </ScrollEdge>
    )
    const overlays = container.querySelectorAll<HTMLElement>('.scroll-edge__overlay--blur')
    const layers = container.querySelectorAll<HTMLElement>('.scroll-edge__blur-layer')
    expect(overlays[0]?.style.height).toBe('2rem')
    expect(layers).toHaveLength(4)
    expect(layers[0]?.style.backdropFilter).toBe('blur(0.000rem)')
    expect(layers[0]?.style.opacity).toBe('0')
    expect(container.querySelector('.scroll-edge__overlay--shadow')).not.toBeInTheDocument()
  })

  it('keeps default behavior when no preset is provided', () => {
    const { container } = render(
      <ScrollEdge blur>
        <div>content</div>
      </ScrollEdge>
    )
    const overlays = container.querySelectorAll<HTMLElement>('.scroll-edge__overlay--blur')
    expect(overlays).toHaveLength(2)
    expect(overlays[0]?.style.height).toBe('24px')
    expect(container.querySelectorAll('.scroll-edge__blur-layer')).toHaveLength(16)
  })
})
