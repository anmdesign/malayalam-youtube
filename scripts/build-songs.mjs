// ============================================================
// Builds data/songs.json: a fixed library of 1968-1989 Malayalam film songs
// for the songs tab. Built once (over a few days, because of the YouTube
// quota), then left alone; the app shuffles it every time it opens.
// ------------------------------------------------------------
// How a song gets in:
//   1. Wikidata gives every Malayalam film with its real release year.
//   2. A few YouTube searches find the channels that upload old film songs.
//   3. Those channels' full upload lists are read (1 quota unit per 50 videos).
//   4. A video is kept only if its title names a film released 1968-1989,
//      names no later film, and is the length of a single song.
//
// Runs from GitHub Actions (.github/workflows/songs.yml).
// Progress is kept in data/songs-build.json, so each run continues where the
// last one stopped. When every channel has been read, it does nothing.
//
// Usage:  YT_API_KEY=... SONG_UNITS=4000 node scripts/build-songs.mjs
//   SONG_UNITS  YouTube quota units this run may use (0 = only re-check the
//               existing list against Wikidata, no YouTube calls)
// ============================================================
import fs from "node:fs/promises";

const KEY = process.env.YT_API_KEY;
const BUDGET = +(process.env.SONG_UNITS ?? 4000);
const SONGS_PATH = new URL("../data/songs.json", import.meta.url);
const STATE_PATH = new URL("../data/songs-build.json", import.meta.url);

const OLD_FROM = 1968, OLD_TO = 1989;
const MIN_SECONDS = 120;        // shorter is a clip or a Short
const MAX_SECONDS = 12 * 60;    // longer is a jukebox or a whole film
const MAX_PAGES_PER_CHANNEL = 400; // 20,000 uploads
const MIN_CHANNEL_HITS = 3;     // a channel needs this many old-film songs in the searches to be read

// Order of the songs tab: the most-watched Prem Nazir era songs first, then the
// rest by views with that era boosted. The app shuffles within each group of 100.
const LIBRARY_SIZE = 1500;
const TOP_ERA_TO = 1979;         // 1968-1979 is "the Prem Nazir era" here
const TOP_ERA_FIRST = 100;       // this many of its most-watched songs open the list
const TOP_ERA_BOOST = 3;         // its songs count 3x their views in the rest of the list

// Searches used once, to find the channels that upload old film songs
const SEED_QUERIES = [
  "Prem Nazir old malayalam film songs",
  "Sathyan malayalam film songs",
  "Madhu Sheela malayalam film songs",
  "Jayan malayalam film songs",
  "Yesudas 1970s malayalam film songs",
  "S Janaki old malayalam film songs",
  "P Jayachandran old malayalam film songs",
  "Vayalar Devarajan malayalam film songs",
  "evergreen malayalam film songs 1970s",
  "evergreen malayalam film songs 1980s",
  "Mohanlal 1980s malayalam film songs",
  "Mammootty 1980s malayalam film songs",
];

const NOT_A_SONG = /#shorts|karaoke|cover|remix|reprise|unplugged|instrumental|flute|violin|keyboard|guitar|whatsapp|status|trailer|teaser|reaction|tutorial|class|full movie|jukebox|non ?stop|mashup|medley|scene|comedy|climax|interview|serial|episode/i;

// ----- Helpers -----

let used = 0;
class OutOfBudget extends Error {}

async function yt(endpoint, params, cost) {
  if (used + cost > BUDGET) throw new OutOfBudget();
  used += cost;
  const url = new URL("https://www.googleapis.com/youtube/v3/" + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", KEY);
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    if (/quota/i.test(data.error?.message || "")) throw new OutOfBudget();
    throw new Error(`YouTube ${endpoint}: ${data.error?.message || res.status}`);
  }
  return data;
}

async function sparql(query) {
  const url = "https://query.wikidata.org/sparql?query=" + encodeURIComponent(query);
  const res = await fetch(url, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": "dads-youtube-finder/1.0 (github.com/anmdesign/malayalam-youtube)" },
  });
  if (!res.ok) throw new Error("Wikidata: HTTP " + res.status);
  return (await res.json()).results.bindings;
}

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

async function readJson(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, "utf8")); } catch { return fallback; }
}

const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

// ============================================================
// Matching titles to films
// ============================================================

// Loose spelling key, so "Avalude Raavukal" and "Avalude Ravukal" match
function loose(s) {
  return s.toLowerCase()
    .replace(/[^a-zഀ-ൿ]+/g, "")
    .replace(/ee/g, "i").replace(/oo/g, "u").replace(/w/g, "v").replace(/th/g, "t").replace(/zh/g, "l")
    .replace(/(.)\1+/g, "$1");
}

// Words that sit next to the film name in titles: "Angadi Movie Song HD"
const NOISE = /\b(video|songs?|full|hd|4k|\d+p|malayalam|movies?|films?|old|evergreen|super ?hits?|hits?|remastered|official|lyrical|lyrics|audio|from|the|evergreen|classic|nostalgia|nostalgic|ever ?green|all ?time|best|of|ft|feat|starring)\b|\d+/gi;

// Film names, by loose key. Old = released 1968-1989; new = released later.
// A name used for both an old film and a later remake is "both".
async function loadFilms() {
  const rows = await sparql(`
    SELECT ?film (MIN(YEAR(?d)) AS ?year) (GROUP_CONCAT(DISTINCT ?l; separator="|") AS ?names) WHERE {
      ?film wdt:P31 wd:Q11424; wdt:P364 wd:Q36236; wdt:P577 ?d.
      { ?film rdfs:label ?l } UNION { ?film skos:altLabel ?l }
      FILTER(LANG(?l) = "en" || LANG(?l) = "ml")
    } GROUP BY ?film`);
  const films = new Map(); // key -> { name, year, era: "old" | "new" | "both" }
  for (const r of rows) {
    const year = +r.year.value;
    const era = year >= OLD_FROM && year <= OLD_TO ? "old" : year > OLD_TO ? "new" : "older";
    // Some aliases carry a prefix like "English: Ahimsa"
    const names = r.names.value.split("|").map((n) => n.replace(/\(.*?\)/g, "").replace(/^[A-Za-z]+:\s*/, "").trim());
    const name = names.find((n) => /[a-z]/i.test(n)) || names[0];
    for (const n of names) {
      const key = loose(n);
      if (key.length < 4) continue;
      const prev = films.get(key);
      if (!prev) films.set(key, { name, year, era, years: [year] });
      else {
        prev.years.push(year);
        if (prev.era !== era) prev.era = "both";
      }
    }
  }
  console.log(`Wikidata: ${rows.length} Malayalam films, ${[...films.values()].filter((f) => f.era === "old").length} old names`);
  return films;
}

// The film a song title names, if it is a 1968-1989 film and nothing later
function matchFilm(title, films) {
  const years = (title.match(/\b(19\d\d|20\d\d)\b/g) || []).map(Number);
  if (years.some((y) => y < OLD_FROM - 5 || y > OLD_TO)) return null;

  const segments = title.split(/[|｜\-–—:()\[\]\/,•]+|\bmovie\b|\bfilm\b/i);
  let hit = null;
  for (const seg of segments) {
    const key = loose(seg.replace(NOISE, " "));
    if (key.length < 4) continue;
    const f = films.get(key);
    if (!f) continue;
    if (f.era === "new") return null;
    if (f.era === "both") {
      // Same name used in different eras (e.g. a later remake): only a year in
      // the title naming the old film tells which one this is
      const y = years.find((y) => y >= OLD_FROM && y <= OLD_TO && f.years.some((fy) => Math.abs(fy - y) <= 1));
      if (!y) return null;
      hit ||= { name: f.name, year: y };
    } else if (f.era === "old") hit ||= f;
  }
  return hit;
}

function toSong(item, film) {
  return {
    id: item.id,
    title: decodeEntities(item.snippet.title),
    channel: item.snippet.channelTitle,
    film: film.name,
    year: film.year,
    duration: parseDuration(item.contentDetails?.duration),
  };
}

// videos.list for durations, 1 unit per 50 ids; returns the ones that are single songs
async function checkVideos(candidates, songs, seen) {
  for (let i = 0; i < candidates.length; i += 50) {
    const batch = candidates.slice(i, i + 50);
    const data = await yt("videos", { part: "snippet,contentDetails", id: batch.map((c) => c.id).join(",") }, 1);
    const byId = new Map((data.items || []).map((it) => [it.id, it]));
    for (const c of batch) {
      const item = byId.get(c.id);
      if (!item || item.snippet.liveBroadcastContent !== "none") continue;
      const song = toSong(item, c.film);
      if (song.duration < MIN_SECONDS || song.duration > MAX_SECONDS) continue;
      if (seen.has(song.id)) continue;
      seen.add(song.id);
      songs.push(song);
    }
  }
}

// People who only worked after the 80s: a title naming them is a newer song
// from a film that shares its name with an old one
const NEW_ERA = /suraj venjaramood|venjaramood|fahad|fahadh|dulquer|prithviraj|nivin|tovino|kunchacko|jayasurya|asif ali|kavya madhavan|indrajith|unni mukundan|vineeth sreenivasan|nazriya|manju warrier|namitha pramod|anu sithara|aishwarya lekshmi|shane nigam|soubin|basil joseph|sushin|gopi sundar|deepak dev|bijibal|shaan rahman|alphons|vidyasagar|m jayachandran|rex vijayan|vijay yesudas|shreya ghoshal|sithara krishnakumar|haricharan|najim arshad|rimi tomy|jassie gift|aparna balamurali|mamta mohandas|meera jasmine|navya nair|anoop menon|lal jose|dileep|kalabhavan mani|christo xavier|vaisakh sugunan|aju varghese|gireesh puthenchery|gireesh puthanchery|jyotsna|jyolsna|harisankar|vaikom vijayalakshmi/i;

const isSongTitle = (title) => !NOT_A_SONG.test(title) && !NEW_ERA.test(title) && !/deleted video|private video/i.test(title);

// ============================================================
// Ranking
// ============================================================

// The same song uploaded by several channels: "Kannum Kannum | Angadi | ..."
// and "Kannum Kannum Thammil Video Song - Angadi (1980)" share song and film.
// The song name is the first part of the title; when that is in Malayalam
// letters ("വെള്ളിച്ചില്ലും | Vellichillam"), the next part. Only consonants are
// compared, so "Vellichillum" and "Vellichillam" are the same song.
function songKey(s) {
  const parts = s.title.split(/[|｜\-–—(\[]/).map((p) => loose(p.replace(NOISE, " ").replace(/[^\x00-\x7f]/g, "")));
  const name = parts[0].length >= 4 ? parts[0] : parts[1] || loose(s.title);
  return name.replace(/[aeiouy]/g, "").slice(0, 8) + "/" + loose(s.film);
}

function rankSongs(songs) {
  const best = new Map();
  for (const s of songs) {
    const k = songKey(s);
    if (!best.has(k) || (s.views || 0) > (best.get(k).views || 0)) best.set(k, s);
  }
  const unique = [...best.values()];
  const topEra = (s) => s.year <= TOP_ERA_TO;
  const first = unique.filter(topEra).sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, TOP_ERA_FIRST);
  const firstIds = new Set(first.map((s) => s.id));
  const score = (s) => (s.views || 0) * (topEra(s) ? TOP_ERA_BOOST : 1);
  const rest = unique.filter((s) => !firstIds.has(s.id)).sort((a, b) => score(b) - score(a));
  console.log(`Ranking: ${songs.length} songs, ${unique.length} after removing duplicate uploads`);
  // Cut to size only once every song has its view count
  const ranked = [...first, ...rest];
  return songs.every((s) => s.views != null) ? ranked.slice(0, LIBRARY_SIZE) : ranked;
}

// ============================================================

async function main() {
  if (!KEY && BUDGET > 0) throw new Error("Set YT_API_KEY");
  const films = await loadFilms();
  const store = await readJson(SONGS_PATH, { songs: [] });
  const state = await readJson(STATE_PATH, { seeded: false, channels: [], done: false });

  // Re-check what we already have against the film years (no quota)
  const seen = new Set();
  const songs = [];
  for (const s of store.songs) {
    const film = matchFilm(s.title, films);
    if (!film || !isSongTitle(s.title) || seen.has(s.id)) continue;
    seen.add(s.id);
    songs.push({ id: s.id, title: s.title, channel: s.channel, film: film.name, year: film.year, duration: s.duration, views: s.views });
  }
  console.log(`Kept ${songs.length} of ${store.songs.length} existing songs`);

  try {
    // 1. View counts for songs that don't have one yet (1 unit per 50)
    const noViews = songs.filter((s) => s.views == null);
    for (let i = 0; i < noViews.length; i += 50) {
      const batch = noViews.slice(i, i + 50);
      const data = await yt("videos", { part: "statistics", id: batch.map((s) => s.id).join(",") }, 1);
      const views = new Map((data.items || []).map((it) => [it.id, +it.statistics.viewCount || 0]));
      for (const s of batch) s.views = views.get(s.id) ?? 0;
    }

    // 2. Find the channels (once)
    if (!state.seeded && BUDGET > 0) {
      const hits = new Map(); // channelId -> { name, count }
      const candidates = [];
      for (const q of SEED_QUERIES) {
        const s = await yt("search", { part: "snippet", type: "video", maxResults: "50", regionCode: "IN", q }, 100);
        for (const it of s.items || []) {
          const title = decodeEntities(it.snippet.title);
          const film = matchFilm(title, films);
          if (!film || !isSongTitle(title)) continue;
          const h = hits.get(it.snippet.channelId) || { name: it.snippet.channelTitle, count: 0 };
          h.count++;
          hits.set(it.snippet.channelId, h);
          if (!seen.has(it.id.videoId)) candidates.push({ id: it.id.videoId, film });
        }
      }
      await checkVideos(candidates, songs, seen);
      state.channels = [...hits].filter(([, h]) => h.count >= MIN_CHANNEL_HITS)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([id, h]) => ({ id, name: h.name, hits: h.count, nextPage: null, pages: 0, done: false }));
      state.seeded = true;
      console.log("Channels:", state.channels.map((c) => `${c.name} (${c.hits})`).join(", "));
    }

    // 3. Read each channel's uploads, page by page
    for (const ch of state.channels.filter((c) => !c.done)) {
      const uploads = "UU" + ch.id.slice(2);
      let added = 0;
      while (!ch.done) {
        const params = { part: "snippet", playlistId: uploads, maxResults: "50" };
        if (ch.nextPage) params.pageToken = ch.nextPage;
        const page = await yt("playlistItems", params, 1);
        const candidates = [];
        for (const it of page.items || []) {
          const id = it.snippet.resourceId?.videoId;
          const title = decodeEntities(it.snippet.title);
          if (!id || seen.has(id) || !isSongTitle(title)) continue;
          const film = matchFilm(title, films);
          if (film) candidates.push({ id, film });
        }
        const before = songs.length;
        await checkVideos(candidates, songs, seen);
        added += songs.length - before;
        ch.pages++;
        ch.nextPage = page.nextPageToken || null;
        if (!ch.nextPage || ch.pages >= MAX_PAGES_PER_CHANNEL) ch.done = true;
      }
      console.log(`  ${ch.name}: +${added} songs (${ch.pages} pages)`);
    }
    state.done = state.seeded && state.channels.every((c) => c.done);

  } catch (e) {
    if (!(e instanceof OutOfBudget)) throw e;
    console.log("Stopped for today (quota budget used); the next run continues.");
  }

  const library = rankSongs(songs);
  await fs.writeFile(SONGS_PATH, JSON.stringify({ updated: todayIST(), songs: library }) + "\n");
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 1) + "\n");
  console.log(`Wrote ${library.length} of ${songs.length} songs (${used} quota units used)${state.done ? " — library complete" : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
