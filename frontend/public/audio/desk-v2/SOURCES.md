# SmartLearn interface sounds

These selected, adapted clips are embedded UI assets for SmartLearn, not a redistribution of a complete sound library.

## Sources checked 2026-09-07

- [Octave by Fred Showell](https://github.com/scopegate/octave) — 986 GitHub stars; handcrafted taps and outcome cues. Revision `198251e306a52e7570905e295d18e001899d6bf0`. The author's license permits use in personal, open-source and commercial work; see `OCTAVE-LICENSE.md` for all terms.
- [soundcn](https://github.com/kapishdima/soundcn) — 756 GitHub stars. The navigation recording by Kenney, from revision `7cbfbb3f56e8548b81fb26410bdcea657447d087`, `assets/kenney_casino-audio`. Original pack: [Kenney Casino Audio](https://kenney.nl/assets/casino-audio), dedicated under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
- Resource book: the dedicated `turn.wav` recording from the user's local reference project, `D:\智学云枢\ZXYS\src\assets\TcmBook\turn.wav`, reused at the user's request. Set `SMARTLEARN_BOOK_AUDIO` to that recording's location when regenerating assets on another machine. Its source hash is recorded in `manifest.json`.
- Also compared [Howler.js](https://github.com/goldfire/howler.js) (25,340 stars) and [use-sound](https://github.com/joshwcomeau/use-sound) (3,150 stars). These are playback engines, not replacement sound assets. The existing small Web Audio player is retained, with cached sample playback replacing oscillator synthesis.

## Interaction mapping

| Interaction | Sample | Purpose |
| --- | --- | --- |
| Button press | Octave tap-wooden | Tactile, brief tap |
| Page navigation | Kenney card-slide-1 | Quiet paper movement |
| Filter / tab selection | Octave tap-muted | Minimal feedback for frequent actions |
| Expand / enable | Octave tap-warm | Soft opening tap |
| Collapse / disable | Octave tap-mellow | Short closing tap |
| Open resource book | 智学云枢 TcmBook turn.wav | Dedicated page-turn recording |
| Close resource book | 智学云枢 TcmBook turn.wav | Matching page-turn recording |
| Search | Octave tap-warm | Discreet request acknowledgement |
| Run / generate | Octave beep-timber | Short start cue |
| Task completed | Octave beep-piano | Gentle completion note |
| Validation passed | Octave beep-warmguitar | Warm, distinct success cue |
| Needs correction | Octave beep-rejected | Low-volume alert |

## Processing and playback

`scripts/prepare-desktop-sounds.py` converts only the selected clips to 32 kHz mono PCM WAV, applies a 4 kHz low-pass filter, trims silence, limits peak amplitude to 0.45 and adds short fades. `manifest.json` records source URLs, source/output SHA-256 hashes, durations and output peaks. All sounds are under 750 ms; frequent controls use shorter taps. Runtime gains are defined in `lib/desktop-sounds.ts` and multiply the user's saved volume.

No remote audio is loaded during application use. Hovering, scrolling and typing are silent. Audio requires user interaction, is throttled, stops when muted/backgrounded, and discards stale asset loads. Results play only after existing application operations actually finish.

The resource book prepares its audio on the initiating click, then plays once when the cover actually starts moving. Its click target suppresses the generic interface sound to avoid overlapping cues.
