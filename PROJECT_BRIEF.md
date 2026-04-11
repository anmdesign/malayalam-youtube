# Project Brief: Dad's YouTube Finder App

## What We Are Building

A **web app** (HTML + CSS + JavaScript) that works as a YouTube search tool designed for an elderly user. It will be wrapped into an **Android APK** using PWABuilder (a free website — no Android Studio needed).

The app will be hosted for free on **GitHub Pages** or **Netlify**.

---

## User Profile

- Elderly Malayalam-speaking man
- Not tech-savvy — needs a very simple, large-text UI
- Will use **voice (mic)** to search, primarily in **Malayalam**
- Uses an **Android phone**

---

## Core Features

### 1. Voice Search (Primary Input)
- A large, prominent **mic button** on screen
- Uses the browser's **Web Speech API** (`SpeechRecognition`)
- Language set to **`ml-IN`** (Malayalam - India)
- After speaking, the recognised text auto-fills the search box and triggers a search automatically
- Show a visual "listening..." indicator while mic is active

### 2. Text Search (Fallback)
- A text input field with a search button
- User can also type manually if voice doesn't work

### 3. YouTube Search Results
- Call the **YouTube Data API v3** (REST, via fetch)
- Endpoint: `https://www.googleapis.com/youtube/v3/search`
- Parameters: `part=snippet`, `type=video`, `maxResults=15`, `relevanceLanguage=ml`
- Display results as a **vertical list of cards**, each card showing:
  - **Thumbnail image** (use `snippet.thumbnails.high.url`)
  - **Video title** (large, bold text)
  - **Channel name** (smaller, grey text)

### 4. Open in YouTube App
- When a video card is tapped, open it in the YouTube app using this URL scheme:
  ```
  https://www.youtube.com/watch?v=VIDEO_ID
  ```
- This automatically opens the YouTube app on Android if installed

### 5. API Key Configuration
- The YouTube API key should be stored in a clearly labelled variable at the top of the JS file:
  ```javascript
  const YOUTUBE_API_KEY = "YOUR_API_KEY_HERE";
  ```
- Add a comment explaining where to get the key

---

## Design Requirements

| Element | Requirement |
|---|---|
| Font size | Minimum 18px for body text, 22px+ for titles |
| Buttons | Large tap targets (min 60px height), rounded corners |
| Mic button | Very large (80px+), red colour, centred on screen |
| Colour scheme | Dark background (#0f0f0f), white text, red accents (YouTube style) |
| Thumbnails | Full width of card, ~200px tall, rounded corners |
| Spacing | Generous padding between cards (no cramped layout) |
| Language | UI labels in **Malayalam** where possible (e.g., placeholder text, button labels) |

### Malayalam UI Text to Use
- Search placeholder: `"എന്ത് കാണണം?"` (What do you want to watch?)
- Mic button label: `"സംസാരിക്കൂ"` (Speak)
- Listening indicator: `"🎤 കേൾക്കുന്നു..."` (Listening...)
- Empty state: `"🎤 മൈക്ക് അമർത്തി സംസാരിക്കൂ"` (Press mic and speak)
- Open in YouTube: `"▶ YouTube-ൽ കാണുക"` (Watch on YouTube)
- Error message: `"തിരയൽ പരാജയപ്പെട്ടു. വീണ്ടും ശ്രമിക്കൂ."` (Search failed. Please try again.)

---

## File Structure to Create

```
/
├── index.html        ← Main app (single file app is fine)
├── style.css         ← All styles
├── app.js            ← All JavaScript logic
├── manifest.json     ← PWA manifest (needed for APK conversion)
└── icons/
    ├── icon-192.png  ← App icon (192x192)
    └── icon-512.png  ← App icon (512x512)
```

> Note: A single `index.html` with embedded `<style>` and `<script>` is also acceptable if that is simpler.

---

## PWA Requirements (Needed for APK Conversion)

The app must be a valid **Progressive Web App** so PWABuilder can convert it to an APK:

### manifest.json
```json
{
  "name": "Dad's YouTube Finder",
  "short_name": "YouTubeFinder",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f0f0f",
  "theme_color": "#ff0000",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### Service Worker (sw.js)
Create a minimal service worker so the app is installable:
```javascript
// Minimal service worker — caches nothing, just makes the app installable
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
```

Register it in `index.html`:
```html
<script>
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
</script>
```

### index.html must include:
```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#ff0000">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
```

---

## JavaScript Logic Overview

### Voice Search Flow
```
User taps mic button
  → Start SpeechRecognition({ lang: 'ml-IN', continuous: false })
  → Show "കേൾക്കുന്നു..." indicator
  → On result → fill search box with transcript
  → Auto-trigger searchYouTube(query)
  → On error → show friendly error message in Malayalam
```

### YouTube Search Flow
```
searchYouTube(query)
  → Show loading spinner
  → fetch YouTube Data API v3
  → Parse JSON response
  → Map items to VideoItem objects { videoId, title, channel, thumbnail }
  → Render cards in results list
  → On card tap → window.open YouTube URL
```

### Error Handling
- If API key is not set → show message: `"API key സജ്ജമാക്കിയിട്ടില്ല"` 
- If no results → show: `"ഫലങ്ങൾ കിട്ടിയില്ല"` (No results found)
- If network error → show retry button

---

## Deployment Steps (Add as Comments or README)

After building, the user needs to:

1. **Get YouTube API Key**
   - Go to https://console.cloud.google.com/
   - Create a project → Enable "YouTube Data API v3"
   - Go to Credentials → Create API Key
   - Paste it into `app.js` where it says `YOUR_API_KEY_HERE`

2. **Host on GitHub Pages (free)**
   - Create a GitHub account at github.com
   - Create a new repository, upload all files
   - Go to Settings → Pages → Deploy from main branch
   - The app will be live at `https://username.github.io/repo-name`

3. **Convert to APK using PWABuilder**
   - Go to https://www.pwabuilder.com/
   - Enter the GitHub Pages URL
   - Click "Package for Store" → Choose Android
   - Download the APK
   - Transfer APK to dad's phone and install

---

## Important Notes for Claude Code

- Do **not** use any paid APIs or services
- Do **not** use any npm packages or build tools — plain HTML/CSS/JS only (so it can be hosted as static files on GitHub Pages)
- The YouTube API key must be easy to find and replace — add a clear `// TODO:` comment
- Generate placeholder icon images (simple coloured squares are fine) at `icons/icon-192.png` and `icons/icon-512.png` using a canvas or inline SVG
- Test that the app works without a service worker registered (first load)
- Make sure `fetch()` calls include proper error handling
- The mic button should show visual feedback (colour change / animation) when actively listening
