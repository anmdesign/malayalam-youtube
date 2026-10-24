// ============================================================
// Dad's YouTube Finder
// ------------------------------------------------------------
// Voice first: tap the mic, speak Malayalam, see results.
// Home screen rows (live news, old movies, comedy, actors) come from
// data/feed.json, rebuilt by scripts/build-feed.mjs on GitHub Actions.
//
// YouTube Data API v3 key (used only for spoken/typed searches).
// Get one free at: https://console.cloud.google.com/
//   1. Create a project
//   2. Enable "YouTube Data API v3"
//   3. Credentials → Create API Key → copy it here
// ============================================================
const YOUTUBE_API_KEY = "AIzaSyDi79UoXTKw6n-pyk00zYL3-trM-WxsgSo";

// ----- Malayalam UI strings -----
const MSG = {
  emptyHint:     "🎤 മൈക്ക് അമർത്തി സംസാരിക്കൂ",
  listening:     "🎤 കേൾക്കുന്നു...",
  searching:     "തിരയുന്നു",
  noResults:     "ഫലങ്ങൾ കിട്ടിയില്ല. വീണ്ടും പറയൂ.",
  noApiKey:      "API key സജ്ജമാക്കിയിട്ടില്ല",
  searchFailed:  "തിരയൽ പരാജയപ്പെട്ടു. വീണ്ടും ശ്രമിക്കൂ.",
  openingYouTube:"YouTube-ൽ തിരയുന്നു...",
  offline:       "ഇന്റർനെറ്റ് ഇല്ല. കണക്ഷൻ നോക്കൂ.",
  micUnsupported:"ഈ ബ്രൗസറിൽ മൈക്ക് ലഭ്യമല്ല",
  heard:         "കേട്ടത്:",
  live:          "തത്സമയം",
  rowNews:       "🔴 തത്സമയ വാർത്ത",
  rowActors:     "നടന്മാർ",
  noSongs:       "പാട്ടുകൾ നാളെ മുതൽ ഇവിടെ കാണാം.",
  moviesOf:      "സിനിമകൾ",
};

// ----- DOM refs -----
const micButton   = document.getElementById("micButton");
const searchForm  = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const statusEl    = document.getElementById("status");
const homeView    = document.getElementById("homeView");
const listView    = document.getElementById("listView");
const listTitle   = document.getElementById("listTitle");
const resultsEl   = document.getElementById("results");
const backButton  = document.getElementById("backButton");
const tabs        = document.getElementById("tabs");
const tabYoutube  = document.getElementById("tabYoutube");
const tabSongs    = document.getElementById("tabSongs");
const hero        = document.getElementById("hero");
const songsView   = document.getElementById("songsView");
const songsEl     = document.getElementById("songs");

let feed = null;

// ----- Status helpers -----
function setStatus(text, mode) {
  statusEl.textContent = text || "";
  statusEl.classList.remove("error", "loading");
  if (mode === "error")   statusEl.classList.add("error");
  if (mode === "loading") statusEl.classList.add("loading");
}

// ============================================================
// Views: home (rows), list (search results / actor movies) and songs
// (the second tab). List and songs push a history entry so the phone's
// back button returns to home instead of closing the app.
// ============================================================
function setView(view) {
  hero.classList.toggle("hidden", view === "songs");
  homeView.classList.toggle("hidden", view !== "home");
  listView.classList.toggle("hidden", view !== "list");
  songsView.classList.toggle("hidden", view !== "songs");
  backButton.classList.toggle("hidden", view !== "list");
  tabs.classList.toggle("hidden", view === "list");
  tabYoutube.classList.toggle("active", view !== "songs");
  tabSongs.classList.toggle("active", view === "songs");
  window.scrollTo(0, 0);
}

function pushView(view) {
  if (history.state?.view === "home") history.pushState({ view }, "");
  else history.replaceState({ view }, "");
}

function showList(title, items) {
  listTitle.textContent = title;
  renderList(resultsEl, items);
  pushView("list");
  setView("list");
}

function showHome() {
  setView("home");
  setStatus(MSG.emptyHint);
}

async function showSongs() {
  pushView("songs");
  setView("songs");
  try {
    const res = await fetch("data/songs.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (history.state?.view === "songs") renderList(songsEl, shuffled(data.songs || []));
  } catch (err) {
    console.error("songs:", err);
    if (!songsEl.children.length) songsEl.appendChild(el("li", "status", navigator.onLine ? MSG.noSongs : MSG.offline));
  }
}

window.addEventListener("popstate", () => (history.state?.view === "songs" ? setView("songs") : showHome()));
backButton.addEventListener("click", () => history.back());
tabSongs.addEventListener("click", () => { if (history.state?.view !== "songs") showSongs(); });
tabYoutube.addEventListener("click", () => { if (history.state?.view === "songs") history.back(); });

// ============================================================
// Opening videos: on Android, go straight to the YouTube app
// (inside the installed app a plain link may open a browser tab).
// ============================================================
const IS_ANDROID = /Android/i.test(navigator.userAgent);

function youtubeLink(path) {
  const web = "https://www.youtube.com/" + path;
  if (!IS_ANDROID) return { href: web, newTab: true };
  return {
    href: `intent://www.youtube.com/${path}#Intent;scheme=https;package=com.google.android.youtube;` +
          `S.browser_fallback_url=${encodeURIComponent(web)};end`,
    newTab: false,
  };
}

function setLink(a, path) {
  const link = youtubeLink(path);
  a.href = link.href;
  if (link.newTab) { a.target = "_blank"; a.rel = "noopener"; }
}

// ----- Formatting -----
function formatDuration(sec) {
  if (!sec) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

// YouTube search snippets come HTML-escaped ("Mohanlal&#39;s")
function decodeEntities(s) {
  const t = document.createElement("textarea");
  t.innerHTML = s;
  return t.value;
}

// Films uploaded in pieces ("Part 1", "(1/3)", "1 of 2", "ഭാഗം 2") are hidden,
// and so is anything too short to be a whole film, so only complete movies show.
const PART_OF_FILM = /\bpart\s*[-:#.]?\s*(\d+|one|two|three|four|i{1,3}|iv)\b|\bepisode\b|\bep\s*\d|\(\s*\d+\s*\/\s*\d+\s*\)|\b\d+\s+of\s+\d+\b|പാർട്ട്|ഭാഗം/i;
const MIN_MOVIE_SECONDS = 75 * 60;
const isFullFilm = (v) => v.duration >= MIN_MOVIE_SECONDS && !PART_OF_FILM.test(v.title);

const ROW_SHOW = 15; // movies shown per row, picked at random from the row's pool

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

// Thumbnail with a LIVE or duration badge
function thumb(v, className) {
  const wrap = el("div", "thumb-wrap");
  const img = el("img", className);
  img.src = v.thumb;
  img.alt = "";
  img.loading = "lazy";
  wrap.appendChild(img);
  if (v.live) wrap.appendChild(el("span", "badge badge-live", "● " + MSG.live));
  else if (v.duration) wrap.appendChild(el("span", "badge", formatDuration(v.duration)));
  return wrap;
}

// ============================================================
// Home rows
// ============================================================
function newsPath(v) {
  // Stream ids can change; if the feed is stale, let YouTube pick the current stream
  const ageHours = (Date.now() - Date.parse(feed.newsUpdatedAt)) / 36e5;
  return ageHours < 6 ? "watch?v=" + v.id : `channel/${v.channelId}/live`;
}

function rowSection(title, children) {
  const section = el("section", "row");
  section.appendChild(el("h2", "row-title", title));
  const scroller = el("div", "row-scroller");
  children.forEach((c) => scroller.appendChild(c));
  section.appendChild(scroller);
  return section;
}

function tile(v, path, caption, sub) {
  const a = el("a", "tile");
  setLink(a, path);
  a.appendChild(thumb(v, "tile-thumb"));
  const body = el("div", "tile-body");
  body.appendChild(caption);
  if (sub) body.appendChild(el("p", "tile-sub", sub));
  a.appendChild(body);
  return a;
}

function newsTile(v) {
  const caption = el("div", "tile-channel");
  if (v.logo) {
    const logo = el("img", "tile-logo");
    logo.src = v.logo;
    logo.alt = "";
    caption.appendChild(logo);
  }
  caption.appendChild(el("span", "tile-name", v.name));
  return tile(v, newsPath(v), caption);
}

function movieTile(v) {
  return tile(v, "watch?v=" + v.id, el("h3", "tile-title", v.title), v.year ? String(v.year) : v.channel);
}

function actorButton(actor) {
  const b = el("button", "actor");
  b.type = "button";
  if (actor.photo) {
    const img = el("img", "actor-photo");
    img.src = actor.photo;
    img.alt = "";
    img.loading = "lazy";
    b.appendChild(img);
  } else {
    // No photo on Wikidata: show the first Malayalam letter instead
    const first = [...new Intl.Segmenter("ml", { granularity: "grapheme" }).segment(actor.name)][0].segment;
    b.appendChild(el("span", "actor-photo actor-initial", first));
  }
  b.appendChild(el("span", "actor-name", actor.name));
  b.addEventListener("click", () => showList(`${actor.name} ${MSG.moviesOf}`, shuffled(actor.videos.filter(isFullFilm))));
  return b;
}

function renderHome() {
  homeView.innerHTML = "";
  if (feed.news?.length)   homeView.appendChild(rowSection(MSG.rowNews, feed.news.map(newsTile)));
  for (const row of feed.rows || []) {
    const videos = shuffled(row.videos.filter(isFullFilm)).slice(0, ROW_SHOW);
    if (videos.length) homeView.appendChild(rowSection(row.title, videos.map(movieTile)));
  }
  if (feed.actors?.length) homeView.appendChild(rowSection(MSG.rowActors, feed.actors.map(actorButton)));
}

async function loadFeed() {
  try {
    const res = await fetch("data/feed.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    feed = await res.json();
    renderHome();
  } catch (err) {
    console.error("feed:", err);
    if (!navigator.onLine) setStatus(MSG.offline, "error");
  }
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

  recognition.onerror = (event) => {
    console.error("SpeechRecognition error:", event.error, event);
    const map = {
      "not-allowed":       "മൈക്ക് അനുമതി നിഷേധിച്ചു (mic permission denied)",
      "service-not-allowed":"മൈക്ക് അനുമതി നിഷേധിച്ചു (mic permission denied)",
      "no-speech":         "ഒന്നും കേട്ടില്ല. വീണ്ടും സംസാരിക്കൂ.",
      "audio-capture":     "മൈക്ക് കണ്ടെത്തിയില്ല",
      "network":           "നെറ്റ്‌വർക്ക് പിശക് (network error)",
      "language-not-supported": "മലയാളം ഈ ബ്രൗസറിൽ പിന്തുണയ്ക്കുന്നില്ല",
      "aborted":           "റദ്ദാക്കി",
    };
    setStatus(map[event.error] || ("മൈക്ക് പിശക്: " + event.error), "error");
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
// Spoken Malayalam -> better YouTube query.
// Most movie uploads have English titles, so common words and actor
// names are swapped for their English form. Words are matched by
// prefix so inflected forms ("മോഹൻലാലിന്റെ") still match.
// ============================================================
const WORD_HINTS = [
  [["സിനിമ", "പടം", "പടങ്ങ", "ചിത്രം", "ചിത്രങ്ങ"], "full movie"],
  [["പാട്ട", "ഗാനം", "ഗാനങ്ങ"], "song"],
  [["വാർത്ത"], "news"],
  [["പഴയ"], "old"],
  [["പുതിയ"], "new"],
  [["കോമഡി", "തമാശ"], "comedy"],
  [["ഭക്തിഗാന"], "devotional song"],
  [["മോഹൻലാ", "ലാലേട്ട"], "Mohanlal"],
  [["മമ്മൂട്ടി", "മമ്മൂക്ക"], "Mammootty"],
  [["നസീ", "പ്രേം"], "Prem Nazir"],
  [["ജയൻ", "ജയന്റെ"], "Jayan"],
  [["സത്യൻ", "സത്യന്റെ"], "Sathyan"],
  [["ജഗതി"], "Jagathy"],
  [["ശ്രീനിവാസ"], "Sreenivasan"],
  [["ദിലീപ"], "Dileep"],
  [["സുരേഷ്"], "Suresh Gopi"],
  [["ജയറാ"], "Jayaram"],
  [["യേശുദാസ"], "Yesudas"],
];
// Filler words that only hurt the search ("show me", "I want to watch")
const FILLER = ["കാണണം", "കാണിക്കൂ", "കാണിച്ചു", "തരൂ", "ഒരു", "വേണം", "ഇടൂ", "വെക്കൂ", "എനിക്ക്", "പ്ലേ", "ചെയ്യൂ", "കാണാൻ"];

function buildQuery(text) {
  const out = [];
  for (const word of text.trim().split(/\s+/)) {
    if (FILLER.includes(word)) continue;
    const hint = WORD_HINTS.find(([prefixes]) => prefixes.some((p) => word.startsWith(p)));
    const term = hint ? hint[1] : word;
    if (!out.includes(term)) out.push(term);
  }
  if (!/malayalam/i.test(out.join(" "))) out.push("malayalam");
  return out.join(" ");
}

// ============================================================
// YouTube Data API v3 search
// ============================================================
async function searchYouTube(spoken) {
  if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === "YOUR_API_KEY_HERE") {
    setStatus(MSG.noApiKey, "error");
    return;
  }
  if (!navigator.onLine) {
    setStatus(MSG.offline, "error");
    return;
  }

  const query = buildQuery(spoken);
  const cached = cachedSearch(query);
  if (cached) {
    setStatus("");
    showList(`${MSG.heard} “${spoken}”`, cached);
    return;
  }

  setStatus(MSG.searching, "loading");

  try {
    const search = await ytApi("search", {
      part: "snippet",
      type: "video",
      maxResults: "20",
      relevanceLanguage: "ml",
      regionCode: "IN",
      q: query,
    });
    const ids = (search.items || []).map((it) => it.id && it.id.videoId).filter(Boolean);

    // Durations and live status (1 quota unit), to drop Shorts and show lengths
    const details = ids.length ? await ytApi("videos", { part: "snippet,contentDetails", id: ids.join(",") }) : { items: [] };
    const byId = new Map(details.items.map((it) => [it.id, it]));

    const items = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((it) => ({
        id:       it.id,
        title:    decodeEntities(it.snippet.title),
        channel:  it.snippet.channelTitle,
        thumb:    (it.snippet.thumbnails.high || it.snippet.thumbnails.medium || it.snippet.thumbnails.default).url,
        duration: parseDuration(it.contentDetails.duration),
        live:     it.snippet.liveBroadcastContent === "live",
      }))
      .filter((v) => v.live || (v.duration > 60 && !/#shorts/i.test(v.title) && !PART_OF_FILM.test(v.title)));

    if (items.length === 0) {
      setStatus(MSG.noResults);
      return;
    }

    saveSearch(query, items);
    setStatus("");
    showList(`${MSG.heard} “${spoken}”`, items);
  } catch (err) {
    console.error(err);
    if (err.quota) openYouTubeSearch(query);
    else setStatus(MSG.searchFailed, "error");
  }
}

// Daily search limit used up: hand the query to YouTube's own search
// (in the YouTube app on Android), which has no limit.
function openYouTubeSearch(query) {
  setStatus(MSG.openingYouTube, "loading");
  const link = youtubeLink("results?search_query=" + encodeURIComponent(query));
  if (link.newTab) window.open(link.href, "_blank", "noopener");
  else location.href = link.href;
  // The YouTube app is now open; put the mic hint back for when Dad returns
  setTimeout(() => setStatus(MSG.emptyHint), 2000);
}

// ----- Search memory -----
// Each search costs 1% of the day's YouTube limit, so results are kept on
// the phone for a few days and repeated searches are free.
const SEARCH_CACHE_KEY = "searchCache";
const SEARCH_CACHE_DAYS = 3;
const SEARCH_CACHE_MAX = 100;

function readSearchCache() {
  try { return JSON.parse(localStorage.getItem(SEARCH_CACHE_KEY)) || {}; }
  catch (_) { return {}; }
}

function cachedSearch(query) {
  const hit = readSearchCache()[query.toLowerCase()];
  return hit && Date.now() - hit.at < SEARCH_CACHE_DAYS * 864e5 ? hit.items : null;
}

function saveSearch(query, items) {
  const cache = readSearchCache();
  cache[query.toLowerCase()] = { at: Date.now(), items };
  // Keep only the newest searches so storage stays small
  const keep = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, SEARCH_CACHE_MAX);
  try { localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(Object.fromEntries(keep))); }
  catch (_) { /* storage full or blocked: just skip remembering */ }
}

async function ytApi(endpoint, params) {
  const url = new URL("https://www.googleapis.com/youtube/v3/" + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", YOUTUBE_API_KEY);
  const res = await fetch(url.toString());
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error("HTTP " + res.status);
    // Daily limit used up: YouTube answers 403 quotaExceeded or 429 "Quota exceeded ..."
    err.quota = res.status === 429 || /quota/i.test(data.error?.message || "") ||
      (data.error?.errors || []).some((e) => /quota/i.test(e.reason));
    throw err;
  }
  return data;
}

// ISO 8601 duration ("PT1H52M3S") -> seconds
function parseDuration(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

// ============================================================
// Result list (search results, actor movies, songs)
// ============================================================
function renderList(listEl, items) {
  listEl.innerHTML = "";
  for (const v of items) {
    const li = document.createElement("li");
    const a = el("a", "card");
    setLink(a, "watch?v=" + v.id);
    a.appendChild(thumb(v, "card-thumb"));

    const body = el("div", "card-body");
    body.appendChild(el("h3", "card-title", v.title));
    body.appendChild(el("p", "card-channel", v.channel));
    a.appendChild(body);

    li.appendChild(a);
    listEl.appendChild(li);
  }
}

// ----- Start -----
history.replaceState({ view: "home" }, "");
loadFeed();

// Coming back to the app after a while (e.g. after watching a film in the
// YouTube app): reload the rows so they are fresh and in a new order.
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (Date.now() - hiddenAt > 5 * 60e3 && !homeView.classList.contains("hidden")) loadFeed();
});
