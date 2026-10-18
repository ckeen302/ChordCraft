'use client'

/** Last-resort screen: anything that throws while rendering lands here instead of a blank page. */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg-deep p-6 text-center text-text">
      <h1 className="text-lg font-extrabold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-text-muted">{error.message || 'An unexpected error stopped the page from rendering.'}</p>
      <div className="flex gap-2">
        <button
          onClick={reset}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg-deep hover:bg-accent-hover cursor-pointer"
        >
          Try again
        </button>
        <button
          onClick={() => {
            // Corrupt saved data is the usual culprit; clear ChordCraft's keys only.
            try {
              Object.keys(localStorage).filter(k => k.startsWith('chordcraft')).forEach(k => localStorage.removeItem(k))
            } catch { /* storage blocked */ }
            location.reload()
          }}
          className="rounded-xl border border-border px-4 py-2 text-sm text-text-muted hover:text-text cursor-pointer"
        >
          Reset saved data
        </button>
      </div>
    </div>
  )
}
