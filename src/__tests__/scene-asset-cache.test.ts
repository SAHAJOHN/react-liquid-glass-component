import { describe, expect, it, vi } from 'vitest'
import {
  canReuseLoadedImage,
  createAssetCache,
  stableSvgRasterDimension,
} from '../scene/paint-content'

describe('scene asset cache', () => {
  it('reuses only loaded images whose pixels are already readable', () => {
    const image = document.createElement('img')
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 40 },
    })
    expect(canReuseLoadedImage(image, `${location.origin}/avatar.jpg`)).toBe(true)
    expect(canReuseLoadedImage(image, 'data:image/png;base64,AA==')).toBe(true)
    expect(canReuseLoadedImage(image, 'https://cdn.example.test/avatar.jpg')).toBe(false)
    image.crossOrigin = 'anonymous'
    expect(canReuseLoadedImage(image, 'https://cdn.example.test/avatar.jpg')).toBe(true)
  })

  it('normalizes sub-millipixel transform noise before building an SVG data URL', () => {
    expect(stableSvgRasterDimension(23.999_999_4)).toBe(24)
    expect(stableSvgRasterDimension(24.000_000_4)).toBe(24)
    expect(stableSvgRasterDimension(24.001_4)).toBe(24.001)
  })

  it('retains a decoded asset while an opacity animation temporarily stops using it', () => {
    const invalidate = vi.fn()
    const cache = createAssetCache(invalidate)
    cache.begin()
    const first = cache.get('data:image/svg+xml,first')
    first.image.dispatchEvent(new Event('load'))
    expect(first.status).toBe('ready')

    cache.end()
    cache.begin()
    cache.end()
    cache.begin()
    expect(cache.get('data:image/svg+xml,first')).toBe(first)
    expect(invalidate).toHaveBeenCalledOnce()
    cache.dispose()
  })

  it('warms an independent image and reuses it without waiting after a route change', () => {
    const invalidate = vi.fn()
    const cache = createAssetCache(invalidate)
    const image = document.createElement('img')
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 40 },
      naturalHeight: { configurable: true, value: 40 },
    })
    const source = `${location.origin}/avatar.png`
    vi.stubGlobal('Image', function Image() {
      return image
    })
    try {
      cache.begin()
      cache.prime(source, 40, 40)
      image.dispatchEvent(new Event('load'))
      expect(invalidate).not.toHaveBeenCalled()
      cache.end()
      cache.begin()
      const reused = cache.get(source)
      expect(reused.status).toBe('ready')
      expect(reused.image).toBe(image)
    } finally {
      cache.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('retries failed speculative images on demand and ignores late events from evicted entries', () => {
    const invalidate = vi.fn()
    const cache = createAssetCache(invalidate)
    const images: HTMLImageElement[] = []
    const source = `${location.origin}/avatar.png`
    vi.stubGlobal('Image', function Image() {
      const image = document.createElement('img')
      images.push(image)
      return image
    })
    try {
      cache.begin()
      cache.prime(source, 40, 40)
      const failed = images[0]
      if (!failed) throw new Error('Expected a speculative image')
      failed.dispatchEvent(new Event('error'))
      expect(invalidate).not.toHaveBeenCalled()
      cache.prime(source, 40, 40)
      expect(images).toHaveLength(1)
      const retry = cache.get(source)
      expect(retry.status).toBe('loading')
      expect(images).toHaveLength(2)
      failed.dispatchEvent(new Event('error'))
      expect(invalidate).not.toHaveBeenCalled()
      retry.image.dispatchEvent(new Event('load'))
      expect(retry.status).toBe('ready')
      expect(invalidate).toHaveBeenCalledOnce()
    } finally {
      cache.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('limits speculative images and still loads required assets when the budget is full', () => {
    const cache = createAssetCache(() => {})
    const images: HTMLImageElement[] = []
    vi.stubGlobal('Image', function Image() {
      const image = document.createElement('img')
      images.push(image)
      return image
    })
    try {
      cache.begin()
      for (let index = 0; index < 40; index += 1)
        cache.prime(`${location.origin}/${index}.png`, 40, 40)
      cache.prime(`${location.origin}/huge.png`, 4096, 4096)
      expect(images).toHaveLength(32)
      expect(cache.get(`${location.origin}/39.png`).status).toBe('loading')
      expect(images).toHaveLength(33)
      cache.end()
      cache.begin()
      cache.prime(`${location.origin}/new.png`, 40, 40)
      expect(images).toHaveLength(34)
      expect(images[0]?.onload).toBeNull()
      expect(images[0]?.onerror).toBeNull()
    } finally {
      cache.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('caps the total speculative pixels and releases the budget when an idle image is evicted', () => {
    const cache = createAssetCache(() => {})
    const images: HTMLImageElement[] = []
    vi.stubGlobal('Image', function Image() {
      const image = document.createElement('img')
      images.push(image)
      return image
    })
    try {
      cache.begin()
      for (let index = 0; index < 5; index += 1)
        cache.prime(`${location.origin}/large-${index}.png`, 1000, 2000)
      // Four 2 MP speculative images fill the 8 MP aggregate budget.
      expect(images).toHaveLength(4)
      expect(cache.get(`${location.origin}/large-4.png`).status).toBe('loading')
      expect(images).toHaveLength(5)
      cache.end()
      cache.begin()
      cache.prime(`${location.origin}/after-navigation.png`, 1000, 2000)
      expect(images).toHaveLength(6)
      expect(images[0]?.onload).toBeNull()
      expect(images[0]?.onerror).toBeNull()
    } finally {
      cache.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('returns count and pixel budget when speculative images become required', () => {
    const cache = createAssetCache(() => {})
    const images: HTMLImageElement[] = []
    vi.stubGlobal('Image', function Image() {
      const image = document.createElement('img')
      images.push(image)
      return image
    })
    try {
      cache.begin()
      for (let index = 0; index < 32; index += 1)
        cache.prime(`${location.origin}/required-${index}.png`, 40, 40)
      expect(images).toHaveLength(32)
      for (let index = 0; index < 32; index += 1)
        expect(cache.get(`${location.origin}/required-${index}.png`).status).toBe('loading')
      cache.prime(`${location.origin}/new-page.png`, 40, 40)
      expect(images).toHaveLength(33)
      // Promoted images stay attached; freeing the budget must not evict them.
      expect(images[0]?.onload).not.toBeNull()
      expect(images[0]?.onerror).not.toBeNull()

      cache.begin()
      for (let index = 0; index < 4; index += 1)
        cache.prime(`${location.origin}/large-required-${index}.png`, 1000, 2000)
      // The remaining small speculative image is idle, so it may be evicted to
      // fit the fourth large image in the 8 MP warm budget.
      expect(images).toHaveLength(37)
      cache.get(`${location.origin}/large-required-0.png`)
      cache.prime(`${location.origin}/large-next.png`, 1000, 2000)
      expect(images).toHaveLength(38)
      expect(images[33]?.onload).not.toBeNull()
    } finally {
      cache.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('drops a speculative response that exceeds its reserved size and retries it on demand', () => {
    const invalidate = vi.fn()
    const cache = createAssetCache(invalidate)
    const images: HTMLImageElement[] = []
    vi.stubGlobal('Image', function Image() {
      const image = document.createElement('img')
      images.push(image)
      return image
    })
    try {
      const source = `${location.origin}/changed.png`
      cache.begin()
      cache.prime(source, 40, 40)
      const oversized = images[0]
      if (!oversized) throw new Error('Expected a speculative image')
      Object.defineProperties(oversized, {
        naturalWidth: { configurable: true, value: 4096 },
        naturalHeight: { configurable: true, value: 4096 },
      })
      oversized.dispatchEvent(new Event('load'))
      expect(invalidate).not.toHaveBeenCalled()
      expect(oversized.getAttribute('src')).toBeNull()
      cache.prime(source, 40, 40)
      expect(images).toHaveLength(1)
      expect(cache.get(source).status).toBe('loading')
      expect(images).toHaveLength(2)
    } finally {
      cache.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('returns unused reserved pixels when the fetched image is smaller than expected', () => {
    const cache = createAssetCache(() => {})
    const images: HTMLImageElement[] = []
    vi.stubGlobal('Image', function Image() {
      const image = document.createElement('img')
      images.push(image)
      return image
    })
    try {
      cache.begin()
      for (let index = 0; index < 4; index += 1)
        cache.prime(`${location.origin}/reserved-${index}.png`, 1000, 2000)
      const first = images[0]
      if (!first) throw new Error('Expected a speculative image')
      Object.defineProperties(first, {
        naturalWidth: { configurable: true, value: 1000 },
        naturalHeight: { configurable: true, value: 1000 },
      })
      first.dispatchEvent(new Event('load'))
      cache.prime(`${location.origin}/extra.png`, 1000, 1000)
      expect(images).toHaveLength(5)
    } finally {
      cache.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('keeps an oversized response when it became required while loading', () => {
    const invalidate = vi.fn()
    const cache = createAssetCache(invalidate)
    const image = document.createElement('img')
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 4096 },
      naturalHeight: { configurable: true, value: 4096 },
    })
    vi.stubGlobal('Image', function Image() {
      return image
    })
    try {
      const source = `${location.origin}/required.png`
      cache.begin()
      cache.prime(source, 40, 40)
      const required = cache.get(source)
      image.dispatchEvent(new Event('load'))
      expect(required.status).toBe('ready')
      expect(invalidate).toHaveBeenCalledOnce()
      expect(image.getAttribute('src')).not.toBeNull()
    } finally {
      cache.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('bounds retained animation variants and evicts the least recently used source', () => {
    const cache = createAssetCache(() => {})
    cache.begin()
    const oldest = cache.get('data:image/svg+xml,0')
    for (let index = 1; index <= 256; index += 1) cache.get(`data:image/svg+xml,${index}`)
    cache.end()
    cache.begin()
    cache.end()
    cache.begin()
    expect(cache.get('data:image/svg+xml,0')).not.toBe(oldest)
    cache.dispose()
  })
})
