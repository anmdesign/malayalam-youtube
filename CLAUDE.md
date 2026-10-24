# YouTube Finder (for Dad)

Malayalam voice-first YouTube app for an elderly, non-technical user (Maniappan).
Plain HTML/CSS/JS, no build step. Live at https://anmdesign.github.io/malayalam-youtube/
(GitHub Pages from `main`, root). Pushing to `main` updates Dad's phone app automatically.

## Pieces
- `index.html`, `style.css`, `app.js` — the app. Mic first, then home rows from `data/feed.json`.
- `scripts/build-feed.mjs` — builds `data/feed.json` (live news, 70s/80s/90s/comedy rows, actors).
  Channel and actor lists are config at the top. Film years come from Wikidata.
- `.github/workflows/feed.yml` — runs the builder every 3h (news) and once a day IST (movies).
  Uses the `YT_API_KEY` repo secret.
- `twa/` — Android wrapper (Bubblewrap). Package `io.github.arunknm.malayalam_youtube`.
- `icons/source/` — icon source; `export.sh` regenerates every icon size (needs Chrome, macOS).
- Asset links for full-screen app: repo `anmdesign/anmdesign.github.io`, `.well-known/assetlinks.json`.

## Rules of thumb
- YouTube quota is ~100 searches/day per key, shared by Dad's voice search and the feed job.
  Don't run `build-feed.mjs --force` repeatedly; use `MAX_NEW_LOOKUPS=0` to rebuild rows from
  `data/match-cache.json` without new searches.
- After changing `app.js` or `style.css`, bump the `?v=N` on both in `index.html`.
- All UI text is Malayalam, large and simple. No English-only labels.
- Hide split-up films ("Part 1", "(1/3)", "ഭാഗം") and anything under 75 minutes in movie rows.
- The APK signing key (`twa/android.keystore`, `twa/KEYSTORE-PASSWORD.txt`) lives only on
  Arun's Mac, never in git. APK rebuilds happen there; web changes don't need a new APK.
