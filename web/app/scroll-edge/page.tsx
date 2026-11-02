import type { Metadata } from 'next'
import { ScrollEdgeDemoPanel } from '@/components/scroll-edge-demo/scroll-edge-demo-panel'

export const metadata: Metadata = {
  title: 'React Liquid Glass Component — ScrollEdge',
}

export default function ScrollEdgePage() {
  return <ScrollEdgeDemoPanel />
}
