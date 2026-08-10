'use client'

import dynamic from 'next/dynamic'

const ChordCraftApp = dynamic(() => import('@/components/ChordCraftApp'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center bg-[#0c0e14]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-[#00e5a0] border-t-transparent animate-spin" />
        <p className="text-[#7b8494] text-sm font-mono">Loading ChordCraft…</p>
      </div>
    </div>
  ),
})

export default function Home() {
  return <ChordCraftApp />
}