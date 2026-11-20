# Vehicle engine recordings

Reused from the user's Swift Parking game. Copyright remains with the original
recordists; these excerpts are incorporated into this game, not a sample pack.
The source records and processed SHA-256 hashes are in `sources.json`.

- `jeep-hemi.wav`: Pole Position, Dodge Ram 1500 HEMI SUV 2014 recording,
  Sonniss GDC 2020 bundle. A real HEMI V8 sound used as the lifted Jeep's engine;
  it is not represented as an exact recording of this custom vehicle.
- `aster-inline-six.wav`: Pole Position, BMW M4 2014 recording,
  Sonniss GDC 2020 bundle, used for the Aster coupe.

Swift Parking processed stable excerpts into seamless mono loops with DC removal,
level matching and an equal-power loop seam. Tidewater uses the same recordings
with modest RPM-dependent pitch changes and throttle-dependent gain/filtering.

[Sonniss GDC Bundle License 2.0](https://sonniss.com/gdc-bundle-license/)
and [official bundle catalogue](https://gdc.sonniss.com/gdc-game-audio-bundle/).

# Voice

- `yeet.wav`: "Yeet Sound" by sukondi, [Freesound #553805](https://freesound.org/people/sukondi/sounds/553805/),
  Creative Commons 0. Trimmed to the voice, faded and peak-normalised to -1 dBFS.

# Tyre squeal

`tyre-squeal.wav` combines two CC0 outdoor recordings of sliding car tyres by Dorian Clair. The sustained sections are equalised, level-matched and crossfaded into a mono loop. To rebuild, pass the two original MP3s in order to `tools/audio/build-tyre-squeal.mjs`. [Screeching Tires #3](https://bigsoundbank.com/screeching-tires-3-s2370.html) and [Screeching Tires #4](https://bigsoundbank.com/screeching-tires-4-s2371.html)
