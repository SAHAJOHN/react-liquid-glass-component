import '@testing-library/jest-dom/vitest'

// ResizeObserver is not available in jsdom; provide a mock.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

window.ResizeObserver =
  window.ResizeObserver ?? (MockResizeObserver as unknown as typeof ResizeObserver)
