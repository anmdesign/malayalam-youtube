// ============================================================
// Builds data/feed.json for the home screen rows.
// ------------------------------------------------------------
// Runs from GitHub Actions (.github/workflows/feed.yml):
//   - every run:        refresh the live news row
//   - once a day (IST): rebuild old movies, comedy movies, actor lists
//
// Usage:  YT_API_KEY=... node scripts/build-feed.mjs [--force]
//   --force  rebuild the movie rows even if they were built today
//
// Movie titles and years come from Wikidata, so "old" and "before 2017"
// are real release years, not YouTube upload dates. Each film is then
// looked up on YouTube once; the answer is remembered in
// data/match-cache.json so later days cost almost no API quota.
// ============================================================
import fs from "node:fs/promises";

const KEY = process.env.YT_API_KEY;
const FORCE = process.argv.includes("--force");
const FEED_PATH = new URL("../data/feed.json", import.meta.url);
const CACHE_PATH = new URL("../data/match-cache.json", import.meta.url);

// ----- Rows config (edit these lists to change what Dad sees) -----

// Live news row, in display order. Asianet News first.
const NEWS_CHANNELS = [
  { id: "UCf8w5m0YsRa8MHQ5bwSGmbw", name: "ഏഷ്യാനെറ്റ് ന്യൂസ്" },
  { id: "UCP0uG-mcMImgKnJz-VjJZmQ", name: "മനോരമ ന്യൂസ്" },
  { id: "UCwXrBBZnIh2ER4lal6WbAHw", name: "മാതൃഭൂമി ന്യൂസ്" },
  { id: "UCup3etEdjyF1L3sRbU-rKLw", name: "24 ന്യൂസ്" },
  { id: "UCFx1nseXKTc1Culiu3neeSQ", name: "റിപ്പോർട്ടർ ടിവി" },
  { id: "UC-f7r46JhYv78q5pGrO6ivA", name: "മീഡിയവൺ" },
  { id: "UCnEvxaWfVL91XIYuyQRO5QA", name: "കൈരളി ന്യൂസ്" },
  { id: "UC-mMi78WJST4N5o8_i1FoXw", name: "ന്യൂസ് 18 കേരളം" },
  { id: "UCNVkxRPqsBNejO6B9thG9Xw", name: "ജനം ടിവി" },
  { id: "UCY18ujuIEIqOBywA0RfbINQ", name: "കേരളകൗമുദി ന്യൂസ്" },
  { id: "UCDM528eqIJElfflkvfT-MuQ", name: "ജയ്ഹിന്ദ് ന്യൂസ്" },
];

const OLD_MOVIES = { fromYear: 1960, toYear: 2000 };
const COMEDY_MAX_YEAR = 2016;
// Wikidata genres: comedy film, comedy-drama, romantic comedy
const COMEDY_GENRES = ["wd:Q157443", "wd:Q859369", "wd:Q860626"];

// Actor buttons. qid = Wikidata id, used for photo and the 2016 cut-off.
const ACTORS = [
  { key: "premnazir", qid: "Q2735277", name: "Prem Nazir", ml: "പ്രേം നസീർ" },
  { key: "mohanlal",  qid: "Q2050534", name: "Mohanlal",   ml: "മോഹൻലാൽ" },
];
const ACTOR_MAX_YEAR = 2016;

const ROW_SIZE = 15;             // movies per row
const MAX_NEW_LOOKUPS = 15;      // YouTube searches per row per day (100 quota units each)
const MIN_MOVIE_MINUTES = 60;    // anything shorter is a clip, not a film
const CACHE_RECHECK_DAYS = 60;   // retry films that weren't on YouTube after this long

// ----- Helpers -----

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function yt(endpoint, params) {
  const url = new URL("https://www.googleapis.com/youtube/v3/" + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", KEY);
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(`YouTube ${endpoint}: ${data.error?.message || res.status}`);
  return data;
}

async function sparql(query) {
  const url = "https://query.wikidata.org/sparql?query=" + encodeURIComponent(query);
  const res = await fetch(url, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": "dads-youtube-finder/1.0 (github.com/arunknm/malayalam-youtube)" },
  });
  if (!res.ok) throw new Error("Wikidata: HTTP " + res.status);
  return (await res.json()).results.bindings;
}

// ISO 8601 duration ("PT1H52M3S") -> seconds
function parseDuration(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Lowercase, drop punctuation and Wikidata disambiguation like "(1991 film)"
function norm(s) {
  return " " + s.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim() + " ";
}

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
}

// Same order all day, different order every day
function seededShuffle(arr, seed) {
  let h = 0;
  for (const c of seed) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  const rand = () => ((h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) | 0) >>> 0) / 2 ** 32;
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// videos.list for up to 50 ids per call (1 quota unit per call)
async function videoDetails(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const data = await yt("videos", { part: "snippet,contentDetails", id: ids.slice(i, i + 50).join(","), maxResults: "50" });
    for (const it of data.items || []) out.set(it.id, it);
  }
  return out;
}

function toCard(item, extra = {}) {
  const t = item.snippet.thumbnails;
  return {
    id: item.id,
    title: decodeEntities(item.snippet.title),
    channel: item.snippet.channelTitle,
    thumb: (t.high || t.medium || t.default).url,
    duration: parseDuration(item.contentDetails?.duration),
    ...extra,
  };
}

async function readJson(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, "utf8")); } catch { return fallback; }
}

// ============================================================
// Live news
// ============================================================

// A channel's /live page redirects to its current stream. Scraping it costs
// no quota; the result is then confirmed with videos.list.
async function scrapeLiveId(channelId) {
  try {
    const res = await fetch(`https://www.youtube.com/channel/${channelId}/live`, {
      headers: { "User-Agent": UA, "Accept-Language": "en", Cookie: "CONSENT=YES+1; SOCS=CAI" },
    });
    const html = await res.text();
    return /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/.exec(html)?.[1] || null;
  } catch {
    return null;
  }
}

async function buildNews({ allowSearchFallback }) {
  const ids = await Promise.all(NEWS_CHANNELS.map((c) => scrapeLiveId(c.id)));
  const details = await videoDetails(ids.filter(Boolean));
  const logos = await yt("channels", { part: "snippet", id: NEWS_CHANNELS.map((c) => c.id).join(","), maxResults: "50" });
  const logoById = new Map((logos.items || []).map((c) => [c.id, c.snippet.thumbnails.default.url]));

  const row = [];
  for (const [i, ch] of NEWS_CHANNELS.entries()) {
    let item = ids[i] && details.get(ids[i]);
    if (!(item && item.snippet.liveBroadcastContent === "live") && allowSearchFallback) {
      // 100 quota units, so only on the daily run
      const s = await yt("search", { part: "snippet", channelId: ch.id, eventType: "live", type: "video", maxResults: "1" });
      const vid = s.items?.[0]?.id?.videoId;
      item = vid && (await videoDetails([vid])).get(vid);
    }
    if (item && item.snippet.liveBroadcastContent === "live") {
      row.push({ ...toCard(item, { name: ch.name, logo: logoById.get(ch.id) || null, channelId: ch.id }), live: true });
    } else {
      console.log(`  no live stream right now: ${ch.name}`);
    }
  }
  return row;
}

// ============================================================
// Movies from Wikidata -> YouTube
// ============================================================

async function wikidataFilms(where) {
  const rows = await sparql(`
    SELECT DISTINCT ?film ?label (MIN(YEAR(?d)) AS ?year) WHERE {
      ?film wdt:P31 wd:Q11424; wdt:P364 wd:Q36236; wdt:P577 ?d.
      ${where}
      ?film rdfs:label ?label FILTER(LANG(?label) = "en")
    } GROUP BY ?film ?label`);
  return rows.map((r) => ({ qid: r.film.value.split("/").pop(), label: r.label.value, year: +r.year.value }));
}

const NOT_A_FILM = /trailer|teaser|scene|song|promo|climax|making|review|reaction|interview|jukebox/i;

// Find the full movie on YouTube for one Wikidata film. Returns a video id or null.
async function searchFilm(film) {
  const label = norm(film.label);
  if (label.trim().length < 3) return null;
  const s = await yt("search", {
    part: "snippet", type: "video", videoDuration: "long", maxResults: "5",
    q: `${film.label.replace(/\(.*?\)/g, "")} ${film.year} malayalam full movie`,
  });
  const hit = (s.items || []).find((it) => {
    const title = decodeEntities(it.snippet.title);
    return norm(title).includes(label) && !NOT_A_FILM.test(title);
  });
  return hit?.id?.videoId || null;
}

async function buildFilmRow(name, films, cache, today) {
  const picked = [];
  let lookups = 0;
  for (const film of seededShuffle(films, name + today)) {
    if (picked.length >= ROW_SIZE * 2) break; // spares in case some fail the duration check
    const c = cache[film.qid];
    const fresh = c && (c.videoId || (Date.parse(today) - Date.parse(c.checked)) / 864e5 < CACHE_RECHECK_DAYS);
    if (fresh) {
      if (c.videoId) picked.push({ film, videoId: c.videoId });
      continue;
    }
    if (lookups >= MAX_NEW_LOOKUPS) continue;
    lookups++;
    const videoId = await searchFilm(film);
    cache[film.qid] = { videoId, checked: today, label: film.label };
    if (videoId) picked.push({ film, videoId });
  }

  const details = await videoDetails(picked.map((p) => p.videoId));
  const row = [];
  for (const { film, videoId } of picked) {
    const item = details.get(videoId);
    const card = item && toCard(item, { year: film.year });
    if (!card || card.duration < MIN_MOVIE_MINUTES * 60) {
      cache[film.qid] = { videoId: null, checked: today, label: film.label }; // deleted or not a full film
      continue;
    }
    if (row.length < ROW_SIZE) row.push(card);
  }
  console.log(`  ${name}: ${row.length} movies (${lookups} new YouTube lookups, ${films.length} films known)`);
  return row;
}

// ============================================================
// Actors
// ============================================================

async function buildActor(actor) {
  // Photo, and the actor's films released after the cut-off (to hide them)
  const [photoRows, lateFilms] = await Promise.all([
    sparql(`SELECT ?img WHERE { wd:${actor.qid} wdt:P18 ?img } LIMIT 1`),
    wikidataFilms(`?film wdt:P161 wd:${actor.qid}. FILTER(YEAR(?d) > ${ACTOR_MAX_YEAR})`),
  ]);
  const photo = photoRows[0] ? photoRows[0].img.value.replace("http://", "https://") + "?width=320" : null;
  const lateTitles = lateFilms.map((f) => norm(f.label)).filter((t) => t.trim().length >= 4);

  const ids = [];
  let pageToken = "";
  for (let page = 0; page < 2; page++) {
    const s = await yt("search", {
      part: "snippet", type: "video", videoDuration: "long", maxResults: "50",
      q: `${actor.name} malayalam full movie`, ...(pageToken && { pageToken }),
    });
    ids.push(...(s.items || []).map((it) => it.id.videoId).filter(Boolean));
    if (!(pageToken = s.nextPageToken)) break;
  }

  const details = await videoDetails([...new Set(ids)]);
  const videos = [];
  for (const id of new Set(ids)) {
    const item = details.get(id);
    if (!item) continue;
    const card = toCard(item);
    const t = norm(card.title);
    if (card.duration < MIN_MOVIE_MINUTES * 60 || NOT_A_FILM.test(card.title)) continue;
    if (lateTitles.some((late) => t.includes(late))) continue;
    videos.push(card);
  }
  console.log(`  ${actor.name}: ${videos.length} movies`);
  return { key: actor.key, name: actor.ml, photo, videos };
}

// ============================================================

async function main() {
  if (!KEY) throw new Error("Set YT_API_KEY");
  const today = todayIST();
  await fs.mkdir(new URL("../data/", import.meta.url), { recursive: true });
  const feed = await readJson(FEED_PATH, {});
  const fullRun = FORCE || feed.moviesDate !== today;

  console.log("Live news...");
  feed.news = await buildNews({ allowSearchFallback: fullRun });
  feed.newsUpdatedAt = new Date().toISOString();

  if (fullRun) {
    const cache = await readJson(CACHE_PATH, {});

    console.log("Old movies...");
    const oldFilms = await wikidataFilms(`FILTER(YEAR(?d) >= ${OLD_MOVIES.fromYear} && YEAR(?d) <= ${OLD_MOVIES.toYear})`);
    feed.old = await buildFilmRow("old", oldFilms, cache, today);

    console.log("Comedy movies...");
    const comedyFilms = await wikidataFilms(`?film wdt:P136 ?g. VALUES ?g { ${COMEDY_GENRES.join(" ")} } FILTER(YEAR(?d) <= ${COMEDY_MAX_YEAR})`);
    feed.comedy = await buildFilmRow("comedy", comedyFilms, cache, today);

    console.log("Actors...");
    feed.actors = [];
    for (const a of ACTORS) feed.actors.push(await buildActor(a));

    feed.moviesDate = today;
    await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 1) + "\n");
  }

  await fs.writeFile(FEED_PATH, JSON.stringify(feed, null, 1) + "\n");
  console.log("Wrote data/feed.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
