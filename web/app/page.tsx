import type { Metadata } from 'next'
import CanvasShowcase from '@/components/showcase/canvas-showcase'

export const metadata: Metadata = {
  title: 'React Liquid Glass Component — Showcase',
}

export default function ShowcasePage() {
  return <CanvasShowcase />
}
