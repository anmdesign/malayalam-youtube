// ============================================================
// Dad's YouTube Finder
// ------------------------------------------------------------
// TODO: paste your YouTube Data API v3 key below.
// Get one free at: https://console.cloud.google.com/
//   1. Create a project
//   2. Enable "YouTube Data API v3"
//   3. Credentials → Create API Key → copy it here
// ============================================================
const YOUTUBE_API_KEY = "YOUR_API_KEY_HERE";

// ----- Malayalam UI strings -----
const MSG = {
  emptyHint:     "🎤 മൈക്ക് അമർത്തി സംസാരിക്കൂ",
  listening:     "🎤 കേൾക്കുന്നു...",
  searching:     "തിരയുന്നു",
  noResults:     "ഫലങ്ങൾ കിട്ടിയില്ല",
  noApiKey:      "API key സജ്ജമാക്കിയിട്ടില്ല",
  searchFailed:  "തിരയൽ പരാജയപ്പെട്ടു. വീണ്ടും ശ്രമിക്കൂ.",
  micUnsupported:"ഈ ബ്രൗസറിൽ മൈക്ക് ലഭ്യമല്ല",
  watch:         "▶ YouTube-ൽ കാണുക",
};

// ----- DOM refs -----
const micButton   = document.getElementById("micButton");
const searchForm  = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const statusEl    = document.getElementById("status");
const resultsEl   = document.getElementById("results");

// ----- Status helpers -----
function setStatus(text, mode) {
  statusEl.textContent = text || "";
  statusEl.classList.remove("error", "loading");
  if (mode === "error")   statusEl.classList.add("error");
  if (mode === "loading") statusEl.classList.add("loading");
}

function clearResults() {
  resultsEl.innerHTML = "";
}

// ============================================================
// Voice search (Web Speech API)
// ============================================================
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = "ml-IN";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isListening = true;
    micButton.classList.add("listening");
    setStatus(MSG.listening);
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    searchInput.value = transcript;
    searchYouTube(transcript);
  };

  recognition.onerror = () => {
    setStatus(MSG.searchFailed, "error");
  };

  recognition.onend = () => {
    isListening = false;
    micButton.classList.remove("listening");
  };
} else {
  // Mic not supported: keep button visible but disabled look, let text search work
  micButton.disabled = true;
  micButton.style.opacity = "0.4";
}

micButton.addEventListener("click", () => {
  if (!recognition) {
    setStatus(MSG.micUnsupported, "error");
    return;
  }
  if (isListening) {
    recognition.stop();
    return;
  }
  try {
    clearResults();
    recognition.start();
  } catch (_) {
    // already started — ignore
  }
});

// ============================================================
// Text search form
// ============================================================
searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (q) searchYouTube(q);
});

// ============================================================
// YouTube Data API v3 search
// ============================================================
async function searchYouTube(query) {
  if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === "YOUR_API_KEY_HERE") {
    setStatus(MSG.noApiKey, "error");
    return;
  }

  clearResults();
  setStatus(MSG.searching, "loading");

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "15");
  url.searchParams.set("relevanceLanguage", "ml");
  url.searchParams.set("q", query);
  url.searchParams.set("key", YOUTUBE_API_KEY);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();

    const items = (data.items || [])
      .filter((it) => it.id && it.id.videoId)
      .map((it) => ({
        videoId:   it.id.videoId,
        title:     it.snippet.title,
        channel:   it.snippet.channelTitle,
        thumbnail: (it.snippet.thumbnails.high || it.snippet.thumbnails.medium || it.snippet.thumbnails.default).url,
      }));

    if (items.length === 0) {
      setStatus(MSG.noResults);
      return;
    }

    setStatus("");
    renderResults(items);
  } catch (err) {
    console.error(err);
    setStatus(MSG.searchFailed, "error");
  }
}

// ============================================================
// Render result cards
// ============================================================
function renderResults(items) {
  clearResults();
  for (const v of items) {
    const li = document.createElement("li");

    const a = document.createElement("a");
    a.className = "card";
    a.href = "https://www.youtube.com/watch?v=" + v.videoId;
    a.target = "_blank";
    a.rel = "noopener";

    const img = document.createElement("img");
    img.className = "card-thumb";
    img.src = v.thumbnail;
    img.alt = "";
    img.loading = "lazy";

    const body = document.createElement("div");
    body.className = "card-body";

    const title = document.createElement("h2");
    title.className = "card-title";
    title.textContent = v.title;

    const channel = document.createElement("p");
    channel.className = "card-channel";
    channel.textContent = v.channel;

    body.appendChild(title);
    body.appendChild(channel);
    a.appendChild(img);
    a.appendChild(body);
    li.appendChild(a);
    resultsEl.appendChild(li);
  }
}
