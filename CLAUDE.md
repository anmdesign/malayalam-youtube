# YouTube Finder (for Dad)

Malayalam voice-first YouTube app for an elderly, non-technical user (Maniappan).
Plain HTML/CSS/JS, no build step. Live at https://anmdesign.github.io/malayalam-youtube/
(GitHub Pages from `main`, root). Pushing to `main` updates Dad's phone app automatically.

## Pieces
- `index.html`, `style.css`, `app.js` — the app. Two tabs: യൂട്യൂബ് (mic, then home rows from
  `data/feed.json`) and പാട്ടുകൾ (long list of 70s/80s film songs from `data/songs.json`).
- Search results are remembered on the phone for 3 days; when the API quota is out, the app
  opens the YouTube app's own search instead.
- `scripts/build-feed.mjs` — builds `data/feed.json` (live news, 70s/80s/90s/comedy rows, actors)
- `scripts/build-songs.mjs` + `.github/workflows/songs.yml` — builds the fixed song library
  `data/songs.json` once: reads old-song channels' uploads and keeps only titles naming a
  1960–1989 film (Wikidata years). Resumes daily via `data/songs-build.json` until `done`, then
  stops. No daily song refresh; the app shuffles the list on every open.
  Channel and actor lists are config at the top. Film years come from Wikidata.
- `.github/workflows/feed.yml` — runs the builder every 3h (news) and once a day IST (movies).
  Uses the `YT_API_KEY` repo secret.
- `twa/` — Android wrapper (Bubblewrap). Package `io.github.arunknm.malayalam_youtube`.
- `icons/source/` — icon source; `export.sh` regenerates every icon size (needs Chrome, macOS).
- Asset links for full-screen app: repo `anmdesign/anmdesign.github.io`, `.well-known/assetlinks.json`.

## Rules of thumb
- YouTube quota is ~100 searches/day per key. Dad's voice search uses the key in `app.js`; the feed
  job uses a separate key (`YT_API_KEY` secret, its own Google Cloud project). Keep it to these two.
  Don't run `build-feed.mjs --force` repeatedly; use `MAX_NEW_LOOKUPS=0` to rebuild rows from
  `data/match-cache.json` without new searches.
- After changing `app.js` or `style.css`, bump the `?v=N` on both in `index.html`.
- All UI text is Malayalam, large and simple. No English-only labels.
- Hide split-up films ("Part 1", "(1/3)", "ഭാഗം") and anything under 75 minutes in movie rows.
- The APK signing key (`twa/android.keystore`, `twa/KEYSTORE-PASSWORD.txt`) lives only on
  Arun's Mac, never in git. APK rebuilds happen there; web changes don't need a new APK.
