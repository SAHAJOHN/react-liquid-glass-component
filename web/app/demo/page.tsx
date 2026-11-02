import type { Metadata } from 'next'
import { DemoPanel } from '@/components/demo/demo-panel'

export const metadata: Metadata = {
  title: 'React Liquid Glass Component — Demo',
}

export default function DemoPage() {
  return <DemoPanel />
}
