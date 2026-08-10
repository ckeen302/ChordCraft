/**
 * Famous VST preset identifications — the "what preset is that?" library.
 *
 * Curated in the spirit of r/findthepreset (https://www.reddit.com/r/findthepreset/):
 * which synths and patches are behind well-known artist sounds. Direct import
 * from the subreddit isn't possible from this machine (Reddit blocks all
 * unauthenticated programmatic access), so this seed set is curated from
 * widely-documented community knowledge, each entry carrying its status:
 *
 *  - 'confirmed'  — factual/official documentation (e.g. factory-bank authorship)
 *  - 'community'  — the accepted community identification (forum consensus,
 *                   remake tutorials, producer streams) — treat as strong lore,
 *                   not gospel.
 *
 * To grow the library, append entries here — the tab renders whatever's in
 * this array, grouped by artist. Keep `sourceUrl` pointing at something a
 * reader can actually check.
 */

export interface PresetEntry {
  id: string
  artist: string
  /** The song or sound the identification is about. */
  context: string
  /** The synth/VST. */
  vst: string
  /** Preset or patch name — or 'Custom patch' when it isn't a factory sound. */
  preset: string
  notes: string
  status: 'confirmed' | 'community'
  sourceUrl?: string
  sourceLabel?: string
}

export const PRESETS: PresetEntry[] = [
  {
    id: 'avicii-levels',
    artist: 'Avicii',
    context: '"Levels" — main lead',
    vst: 'Sylenth1',
    preset: 'Layered factory-style LD leads',
    notes: 'The most requested preset ID of the 2010s. Community remakes converge on layered Sylenth1 leads; Syntorial published a note-for-note recipe.',
    status: 'community',
    sourceUrl: 'https://www.syntorial.com/preset-recipe/avicii-levels-lead/',
    sourceLabel: 'Syntorial preset recipe',
  },
  {
    id: 'avicii-broken-circuit',
    artist: 'Avicii',
    context: 'Early leads ("Stay With You", "You\'re Gonna Love Again")',
    vst: 'Sylenth1',
    preset: 'LD Broken Circuit',
    notes: 'Identified on KVR\'s sound-design forum as the factory patch behind several early Avicii leads.',
    status: 'community',
    sourceUrl: 'https://www.kvraudio.com/forum/viewtopic.php?t=389170',
    sourceLabel: 'KVR Audio thread',
  },
  {
    id: 'alan-walker-faded',
    artist: 'Alan Walker',
    context: '"Faded" / "Fade" — signature pluck',
    vst: 'Sylenth1 · Serum · Sytrus',
    preset: 'Community-recreated pluck',
    notes: 'One of the most remade sounds ever — free community banks recreate it in Sylenth1, Serum, and even FL\'s stock Sytrus.',
    status: 'community',
    sourceUrl: 'https://stickz.co/faded/',
    sourceLabel: 'Stickz FADED soundbank',
  },
  {
    id: 'skrillex-massive',
    artist: 'Skrillex',
    context: '"Scary Monsters and Nice Sprites"-era growls',
    vst: 'NI Massive',
    preset: 'Custom patches',
    notes: 'The early-dubstep growl vocabulary was built on Massive\'s wavetables with macro-modulated formants — the documented staple of that whole era.',
    status: 'community',
    sourceUrl: 'https://www.native-instruments.com/en/products/komplete/synths/massive/',
    sourceLabel: 'NI Massive',
  },
  {
    id: 'martin-garrix-animals',
    artist: 'Martin Garrix',
    context: '"Animals" — big-room lead',
    vst: 'Sylenth1',
    preset: 'Custom patch',
    notes: 'Not a factory preset — a custom Sylenth1 patch from Garrix\'s documented FL Studio setup, recreated in hundreds of tutorials.',
    status: 'community',
  },
  {
    id: 'virtual-riot-serum',
    artist: 'Virtual Riot',
    context: 'Xfer Serum factory library',
    vst: 'Xfer Serum',
    preset: 'Factory presets (authored)',
    notes: 'Several of Serum\'s stock presets were designed by Virtual Riot — browsing the factory bank is literally playing his patches.',
    status: 'confirmed',
    sourceUrl: 'https://xferrecords.com/products/serum',
    sourceLabel: 'Xfer Serum',
  },
  {
    id: 'hardwell-spire',
    artist: 'Hardwell',
    context: 'Big-room leads (2013–2016)',
    vst: 'Reveal Sound Spire',
    preset: 'Signature supersaw leads',
    notes: 'A documented Spire user — the mid-2010s big-room lead sound tracks Spire\'s supersaw character.',
    status: 'community',
    sourceUrl: 'https://www.reveal-sound.com/',
    sourceLabel: 'Reveal Sound',
  },
  {
    id: 'zaytoven-nexus',
    artist: 'Zaytoven',
    context: 'Gospel-trap keys & guitars (Gucci Mane / Migos era)',
    vst: 'reFX Nexus',
    preset: 'Factory keys & guitar presets',
    notes: 'Zaytoven\'s rapid-fire trap keys famously ride Nexus factory sounds nearly untouched.',
    status: 'community',
    sourceUrl: 'https://refx.com/nexus/',
    sourceLabel: 'reFX Nexus',
  },
  {
    id: 'southside-electrax',
    artist: 'Southside (808 Mafia)',
    context: 'Trap leads, bells & brass',
    vst: 'Tone2 ElectraX',
    preset: 'Custom + shared banks',
    notes: 'ElectraX is the documented core of the 808 Mafia palette — half of 2010s trap lead sounds trace back to it.',
    status: 'community',
    sourceUrl: 'https://www.tone2.com/electrax.html',
    sourceLabel: 'Tone2 ElectraX',
  },
  {
    id: 'hans-zimmer-omnisphere',
    artist: 'Hans Zimmer',
    context: 'Hybrid-score pads & textures',
    vst: 'Spectrasonics Omnisphere',
    preset: 'Factory soundsources + custom',
    notes: 'Omnisphere is a documented staple of modern hybrid film-scoring templates, Zimmer\'s circle included.',
    status: 'community',
    sourceUrl: 'https://www.spectrasonics.net/products/omnisphere/',
    sourceLabel: 'Spectrasonics',
  },
  {
    id: 'nick-mira-omnisphere',
    artist: 'Nick Mira',
    context: 'Juice WRLD-era melodies (Internet Money)',
    vst: 'Omnisphere · Analog Lab',
    preset: 'Factory + kit presets',
    notes: 'Mira\'s live beat-making streams document his go-to Omnisphere and Analog Lab patches behind the melodic-trap era.',
    status: 'community',
    sourceUrl: 'https://www.spectrasonics.net/products/omnisphere/',
    sourceLabel: 'Spectrasonics',
  },
  {
    id: 'pierre-bourne-purity',
    artist: "Pi'erre Bourne",
    context: 'Playboi Carti-era melodies ("Magnolia" period)',
    vst: 'LUXONIX Purity',
    preset: 'Factory rompler banks',
    notes: 'In-studio videos show Purity\'s rompler banks behind the bouncy, video-game-bright Carti-era palette.',
    status: 'community',
  },
]

/** Unique VST names for filter chips, alphabetical. */
export const PRESET_VSTS: string[] = [...new Set(PRESETS.map(p => p.vst))].sort()
