import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ChordCraft — Progression Studio',
  description:
    'A professional chord progression studio. Generate, play, and export ' +
    'chord progressions in any key with real-time audio synthesis.',
  keywords: ['chord progression', 'music theory', 'MIDI', 'DAW', 'Tone.js'],
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  )
}
