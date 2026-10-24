# Dad's YouTube Finder

A simple Malayalam-voice-first YouTube search PWA designed for an elderly user.
Tap the mic, speak in Malayalam, get large tappable video cards that open in the
YouTube app.

## Files

- `index.html` — app markup, PWA meta tags, service-worker registration
- `style.css` — Uber-inspired dark theme, large tap targets, elderly-friendly
- `app.js` — voice search (Web Speech API, `ml-IN`) + YouTube Data API v3 fetch
- `manifest.json` — PWA manifest (required for APK conversion)
- `sw.js` — minimal service worker (installable-only, no caching)
- `icons/` — 192 and 512 PWA icons
- `data/feed.json` — home screen rows (live news, old movies, comedy, actors)
- `scripts/build-feed.mjs` — builds `data/feed.json` (edit the channel/actor lists at the top)
- `.github/workflows/feed.yml` — runs the builder every 3 hours (movies once a day)

## Setup (one-time)

### 1. Get a free YouTube API key

1. Go to https://console.cloud.google.com/
2. Create a new project
3. Enable **YouTube Data API v3**
4. Credentials → **Create credentials** → **API key**
5. Copy the key
6. Open `app.js` and replace `YOUR_API_KEY_HERE` on the line:
   ```js
   const YOUTUBE_API_KEY = "YOUR_API_KEY_HERE";
   ```

### 2. Let GitHub refresh the home screen

1. GitHub repo → Settings → Secrets and variables → Actions → **New repository secret**
2. Name `YT_API_KEY`, value: a YouTube API key (ideally from a second Google
   Cloud project, so the daily refresh doesn't use up the app's search quota)
3. Actions tab → **Refresh home feed** → Run workflow (tick "Rebuild movie rows")

To build it on your machine instead: `YT_API_KEY=... node scripts/build-feed.mjs --force`

### 3. Test locally

```bash
python3 -m http.server 8000
```
Open http://localhost:8000 in Chrome.

### 4. Host free on GitHub Pages

1. Create a GitHub account at https://github.com
2. Create a new repository and upload all files
3. Settings → Pages → Deploy from `main` branch → `/ (root)`
4. Your app is live at `https://<username>.github.io/<repo>`

### 5. Convert to Android APK with PWABuilder

1. Go to https://www.pwabuilder.com/
2. Paste your GitHub Pages URL
3. Click **Package for Store** → **Android**
4. Download the APK, transfer to the Android phone, install

## Notes

- No npm, no build step — pure static HTML/CSS/JS
- Works offline installable; network is still required for searches
- If the browser doesn't support `SpeechRecognition`, text search still works
