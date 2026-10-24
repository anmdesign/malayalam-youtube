// ============================================================
// Builds data/feed.json for the home screen rows.
// ------------------------------------------------------------
// Runs from GitHub Actions (.github/workflows/feed.yml):
//   - every run:        refresh the live news row
//   - once a day (IST): rebuild the movie rows (70s, 80s, 90s, comedy) and a few actor lists
//
// Usage:  YT_API_KEY=... node scripts/build-feed.mjs [--force]
//   --force  rebuild the movie rows even if they were built today
//
// Movie titles and years come from Wikidata, so decades and "before 2017"
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

// Movie rows, in display order. `where` is a Wikidata filter on ?film / ?d (release date).
// Comedy genres: comedy film, comedy-drama, romantic comedy.
const decade = (from) => `FILTER(YEAR(?d) >= ${from} && YEAR(?d) <= ${from + 9})`;
const MOVIE_ROWS = [
  { key: "70s",    title: "70-കളിലെ സിനിമകൾ", where: decade(1970) },
  { key: "80s",    title: "80-കളിലെ സിനിമകൾ", where: decade(1980) },
  { key: "90s",    title: "90-കളിലെ സിനിമകൾ", where: decade(1990) },
  { key: "comedy", title: "കോമഡി സിനിമകൾ",
    where: `?film wdt:P136 ?g. VALUES ?g { wd:Q157443 wd:Q859369 wd:Q860626 } FILTER(YEAR(?d) <= 2016)` },
];

// Actor buttons, in display order. qid = Wikidata id, used for photo and the 2016 cut-off.
const ACTORS = [
  { key: "mohanlal",   qid: "Q2050534",  name: "Mohanlal",          ml: "മോഹൻലാൽ" },
  { key: "mammootty",  qid: "Q2721855",  name: "Mammootty",         ml: "മമ്മൂട്ടി" },
  { key: "premnazir",  qid: "Q2735277",  name: "Prem Nazir",        ml: "പ്രേം നസീർ" },
  { key: "sathyan",    qid: "Q7426186",  name: "Sathyan",           ml: "സത്യൻ" },
  { key: "madhu",      qid: "Q277417",   name: "Madhu",             ml: "മധു" },
  { key: "jayan",      qid: "Q6167522",  name: "Jayan",             ml: "ജയൻ" },
  { key: "sukumaran",  qid: "Q7635921",  name: "Sukumaran",         ml: "സുകുമാരൻ" },
  { key: "thilakan",   qid: "Q3520698",  name: "Thilakan",          ml: "തിലകൻ" },
  { key: "nedumudi",   qid: "Q12072044", name: "Nedumudi Venu",     ml: "നെടുമുടി വേണു" },
  { key: "jagathy",    qid: "Q6122250",  name: "Jagathy Sreekumar", ml: "ജഗതി" },
  { key: "sreenivasan", qid: "Q7585727", name: "Sreenivasan",       ml: "ശ്രീനിവാസൻ" },
  { key: "innocent",   qid: "Q6035995",  name: "Innocent",          ml: "ഇന്നസെന്റ്" },
  { key: "mukesh",     qid: "Q277422",   name: "Mukesh",            ml: "മുകേഷ്" },
  { key: "jayaram",    qid: "Q3522919",  name: "Jayaram",           ml: "ജയറാം" },
  { key: "sureshgopi", qid: "Q3530125",  name: "Suresh Gopi",       ml: "സുരേഷ് ഗോപി" },
  { key: "dileep",     qid: "Q5276736",  name: "Dileep",            ml: "ദിലീപ്" },
];
const ACTOR_MAX_YEAR = 2016;
const ACTOR_REFRESH_DAYS = 7;    // each actor's list is rebuilt about once a week...
const ACTOR_REFRESH_PER_DAY = 3; // ...a few per day, to spread the quota (new actors are always built)

const POOL_SIZE = 60;            // movies kept per row; the app shows a random 15 each time it opens
const MAX_NEW_LOOKUPS = +(process.env.MAX_NEW_LOOKUPS ?? 8); // YouTube searches per row per day (100 quota units each)
const MIN_MOVIE_MINUTES = 75;    // anything shorter is a clip or one part of a split-up film
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

// News streams usually keep the same video id for weeks, so the last known id
// is reused when scraping fails (YouTube often blocks it from CI servers).
// A channel whose stream ended is searched for (100 units) at most every 12 hours.
const NEWS_SEARCH_EVERY_HOURS = 12;

async function buildNews(prevNews, searchedAt) {
  const prevId = new Map(prevNews.map((v) => [v.channelId, v.id]));
  const scraped = await Promise.all(NEWS_CHANNELS.map((c) => scrapeLiveId(c.id)));
  const ids = NEWS_CHANNELS.map((c, i) => scraped[i] || prevId.get(c.id) || null);
  const details = await videoDetails(ids.filter(Boolean));
  const logos = await yt("channels", { part: "snippet", id: NEWS_CHANNELS.map((c) => c.id).join(","), maxResults: "50" });
  const logoById = new Map((logos.items || []).map((c) => [c.id, c.snippet.thumbnails.default.url]));

  const row = [];
  for (const [i, ch] of NEWS_CHANNELS.entries()) {
    let item = ids[i] && details.get(ids[i]);
    const last = searchedAt[ch.id];
    const searchDue = !last || (Date.now() - Date.parse(last)) / 36e5 >= NEWS_SEARCH_EVERY_HOURS;
    if (!(item && item.snippet.liveBroadcastContent === "live") && searchDue) {
      searchedAt[ch.id] = new Date().toISOString();
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
// Films uploaded in pieces: "Part 1", "Episode 2", "(1/3)", "1 of 2", "ഭാഗം 1"
const PART_OF_FILM = /\bpart\s*[-:#.]?\s*(\d+|one|two|three|four|i{1,3}|iv)\b|\bepisode\b|\bep\s*\d|\(\s*\d+\s*\/\s*\d+\s*\)|\b\d+\s+of\s+\d+\b|പാർട്ട്|ഭാഗം/i;
// A year in the title that is far from the film's release year means it is a
// different (usually newer) film with the same name.
const wrongYear = (title, year) => {
  const years = (title.match(/\b(19[3-9]\d|20[0-4]\d)\b/g) || []).map(Number);
  return years.length > 0 && !years.some((y) => Math.abs(y - year) <= 1);
};
const isFullFilm = (card) => card.duration >= MIN_MOVIE_MINUTES * 60 && !NOT_A_FILM.test(card.title) && !PART_OF_FILM.test(card.title);

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
    return norm(title).includes(label) && !NOT_A_FILM.test(title) && !PART_OF_FILM.test(title) && !wrongYear(title, film.year);
  });
  return hit?.id?.videoId || null;
}

async function buildFilmRow(name, films, cache, today) {
  const picked = [];
  let lookups = 0;
  for (const film of seededShuffle(films, name + today)) {
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
    if (!card || !isFullFilm(card) || wrongYear(card.title, film.year)) {
      cache[film.qid] = { videoId: null, checked: today, label: film.label }; // deleted or not a full film
      continue;
    }
    if (row.length < POOL_SIZE) row.push(card);
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

  const s = await yt("search", {
    part: "snippet", type: "video", videoDuration: "long", maxResults: "50",
    q: `${actor.name} malayalam full movie`,
  });
  const ids = (s.items || []).map((it) => it.id.videoId).filter(Boolean);

  const details = await videoDetails([...new Set(ids)]);
  const videos = [];
  for (const id of new Set(ids)) {
    const item = details.get(id);
    if (!item) continue;
    const card = toCard(item);
    const t = norm(card.title);
    if (!isFullFilm(card)) continue;
    if (lateTitles.some((late) => t.includes(late))) continue;
    videos.push(card);
  }
  console.log(`  ${actor.name}: ${videos.length} movies`);
  return { key: actor.key, name: actor.ml, photo, videos, updated: todayIST() };
}

// ============================================================

async function main() {
  if (!KEY) throw new Error("Set YT_API_KEY");
  const today = todayIST();
  await fs.mkdir(new URL("../data/", import.meta.url), { recursive: true });
  const feed = await readJson(FEED_PATH, {});
  const fullRun = FORCE || feed.moviesDate !== today;

  console.log("Live news...");
  feed.newsSearchedAt ||= {};
  feed.news = await buildNews(feed.news || [], feed.newsSearchedAt);
  feed.newsUpdatedAt = new Date().toISOString();

  if (fullRun) {
    const cache = await readJson(CACHE_PATH, {});

    console.log("Movie rows...");
    feed.rows = [];
    for (const row of MOVIE_ROWS) {
      const films = await wikidataFilms(row.where);
      feed.rows.push({ key: row.key, title: row.title, videos: await buildFilmRow(row.key, films, cache, today) });
    }
    delete feed.old;    // replaced by the decade rows
    delete feed.comedy;

    console.log("Actors...");
    const prev = new Map((feed.actors || []).map((a) => [a.key, a]));
    const ageDays = (a) => (a?.updated ? (Date.parse(today) - Date.parse(a.updated)) / 864e5 : Infinity);
    const stale = ACTORS.filter((a) => prev.has(a.key) && ageDays(prev.get(a.key)) >= ACTOR_REFRESH_DAYS)
      .sort((a, b) => ageDays(prev.get(b.key)) - ageDays(prev.get(a.key)))
      .slice(0, ACTOR_REFRESH_PER_DAY);
    feed.actors = [];
    for (const a of ACTORS) {
      const rebuild = !prev.has(a.key) || stale.includes(a);
      const old = prev.get(a.key);
      feed.actors.push(rebuild ? await buildActor(a) : { ...old, name: a.ml, videos: old.videos.filter(isFullFilm) });
    }

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
