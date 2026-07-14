// Boîte à outils commune aux vidéos Alertiva (JT du soir + vidéos par article).
// Lecture via clé anon (publique, sans risque). Écriture Storage + table
// uniquement si SUPABASE_SERVICE_ROLE_KEY est fournie (secret GitHub / env local).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
export const ROOT = path.dirname(HERE);

export const SB_URL = process.env.SB_URL || "https://yzszorqusxudeejunmsx.supabase.co";
export const SB_ANON =
  process.env.SB_ANON ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6c3pvcnF1c3h1ZGVlanVubXN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2NTU5NzUsImV4cCI6MjA5OTIzMTk3NX0.3NyXoEqtX3bM48VlxN7bW2WraUGUdjDyJ3D70qs5O_s";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
export const CAN_UPLOAD = Boolean(SERVICE_ROLE);

export const VOICE = process.env.ALERTIVA_VOICE || "fr-FR-HenriNeural";
export const PYTHON = process.env.PYTHON || "python";

export const CAT_FR = {
  monde: "À l'international", france: "En France", politique: "Politique",
  economie: "Économie", tech: "Technologie", sport: "Sport", sciences: "Sciences",
  sante: "Santé", culture: "Culture", insolite: "Insolite",
};

export const die = (m) => { console.error("❌ " + m); process.exit(1); };

export const run = (cmd, argv) => {
  const r = spawnSync(cmd, argv, { stdio: "inherit", shell: process.platform === "win32", cwd: ROOT });
  if (r.status !== 0) die("Échec commande : " + cmd + " " + argv.join(" "));
};

// ---------- texte ----------
export const stripMd = (s) =>
  String(s || "").replace(/[#*_>`~\[\]]/g, " ").replace(/\((https?:[^)]+)\)/g, " ").replace(/\s+/g, " ").trim();

export const sentences = (s) => {
  const t = stripMd(s);
  const out = t.match(/[^.!?]+[.!?]+/g);
  return (out ? out.map((x) => x.trim()) : (t ? [t] : []));
};

export const firstSentence = (s) => {
  const arr = sentences(s);
  if (arr.length) return arr[0];
  const t = stripMd(s);
  return t.slice(0, 160).trim();
};

// ---------- Supabase REST ----------
async function sbGet(pathQuery) {
  const res = await fetch(`${SB_URL}/rest/v1/${pathQuery}`, {
    headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` },
  });
  if (!res.ok) throw new Error(`GET ${pathQuery} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbInsert(table, row) {
  if (!CAN_UPLOAD) return null;
  const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json", Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`INSERT ${table} → ${res.status} ${await res.text()}`);
  return res.json();
}

export const fetchRecentArticles = (limit = 30) =>
  sbGet(`news_articles?status=eq.published&cover_image=not.is.null&order=published_at.desc&limit=${limit}` +
    `&select=id,slug,title,summary,content,category_slug,cover_image,views,published_at,is_sensitive`);

export async function videoedArticleIds() {
  const rows = await sbGet(`article_videos?select=article_id&kind=eq.article`);
  return new Set(rows.map((r) => r.article_id).filter(Boolean));
}

export async function lastVideoCategories(n = 3) {
  try {
    const rows = await sbGet(`article_videos?kind=eq.article&order=created_at.desc&limit=${n}` +
      `&select=news_articles(category_slug)`);
    return rows.map((r) => r.news_articles?.category_slug).filter(Boolean);
  } catch { return []; }
}

// ---------- edge-tts + sous-titres ----------
export function tts(text, mp3Abs, vttAbs) {
  const dir = path.dirname(mp3Abs);
  fs.mkdirSync(dir, { recursive: true });
  const txtFile = path.join(dir, "script.txt");
  fs.writeFileSync(txtFile, text, "utf8");
  run(PYTHON, ["-m", "edge_tts", "--voice", VOICE, "--file", txtFile, "--write-media", mp3Abs, "--write-subtitles", vttAbs]);
}

export function probeDuration(mp3Abs) {
  const p = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", mp3Abs], { encoding: "utf8", shell: process.platform === "win32" });
  return parseFloat(String(p.stdout).trim()) || 0;
}

export function parseVtt(vttAbs) {
  const vtt = fs.readFileSync(vttAbs, "utf8");
  const toSec = (t) => { const [h, m, s] = t.replace(",", ".").split(":"); return (+h) * 3600 + (+m) * 60 + parseFloat(s); };
  const cues = [];
  for (const b of vtt.split(/\r?\n\r?\n/)) {
    const mm = b.match(/(\d\d:\d\d:\d\d[.,]\d+)\s*-->\s*(\d\d:\d\d:\d\d[.,]\d+)\s*([\s\S]*)/);
    if (mm) cues.push({ start: toSec(mm[1]), end: toSec(mm[2]), text: mm[3].replace(/\s+/g, " ").trim() });
  }
  return cues;
}

// ---------- timeline ----------
export function proportionalSpans(parts, durationSec) {
  const total = parts.reduce((n, p) => n + p.length + 2, 0);
  let cursor = 0;
  return parts.map((p, i) => {
    const to = i === parts.length - 1 ? durationSec : cursor + ((p.length + 2) / total) * durationSec;
    const span = { from: cursor, to };
    cursor = to;
    return span;
  });
}

// ---------- images ----------
export async function downloadImage(url, absPath) {
  try {
    const r = await fetch(url);
    if (!r.ok) return false;
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, Buffer.from(await r.arrayBuffer()));
    return true;
  } catch { return false; }
}

// ---------- musique de fond (légère, façon info, 100% générée = zéro droit) ----------
// Si un fichier assets/music.mp3 existe, il est utilisé à la place (bouclé + fondu).
export function makeMusicBed(durationSec, outAbs) {
  const dur = Math.max(3, Math.ceil(durationSec));
  const custom = path.join(ROOT, "assets", "music.mp3");
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  if (fs.existsSync(custom)) {
    run("ffmpeg", ["-y", "-stream_loop", "-1", "-i", custom, "-t", String(dur),
      "-af", `afade=t=out:st=${Math.max(0, dur - 2)}:d=2`, "-c:a", "aac", "-b:a", "128k", outAbs]);
    return outAbs;
  }
  // Nappe douce : accord Do majeur (Do-Sol-Do-Mi) + trémolo lent + filtrage + écho.
  const graph = path.join(path.dirname(outAbs), "music.filter");
  fs.writeFileSync(graph,
    `[0:a][1:a][2:a][3:a]amix=inputs=4:normalize=1,` +
    `tremolo=f=0.12:d=0.5,lowpass=f=1600,highpass=f=90,aecho=0.8:0.85:1000:0.3,` +
    `afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(0, dur - 2)}:d=2,volume=1.2[m]`, "utf8");
  run("ffmpeg", ["-y",
    "-f", "lavfi", "-i", `sine=frequency=130.81:duration=${dur}:sample_rate=48000`,
    "-f", "lavfi", "-i", `sine=frequency=196.00:duration=${dur}:sample_rate=48000`,
    "-f", "lavfi", "-i", `sine=frequency=261.63:duration=${dur}:sample_rate=48000`,
    "-f", "lavfi", "-i", `sine=frequency=329.63:duration=${dur}:sample_rate=48000`,
    "-filter_complex_script", graph, "-map", "[m]", "-t", String(dur),
    "-c:a", "aac", "-b:a", "128k", outAbs]);
  return outAbs;
}

// ---------- rendu Remotion + mixage ----------
export function renderRemotion(compId, propsAbs, rawOutAbs) {
  run("npx", ["remotion", "render", "src/index.ts", compId, rawOutAbs, `--props=${propsAbs}`]);
}

// Débit vidéo max (kbps) visant ~targetMB tout en restant sous la limite Storage (50 Mo).
export function maxrateForSize(durationSec, targetMB = 44) {
  return Math.min(2500, Math.max(700, Math.floor((targetMB * 8 * 1024) / Math.max(1, durationSec)) - 200));
}

// Mix voix + musique (ducking sous la voix) puis normalisation -14 LUFS.
export function muxFinal(rawMp4Abs, musicAbs, finalOutAbs, { maxrateK = 2200 } = {}) {
  const graph = path.join(path.dirname(finalOutAbs), "mux.filter");
  fs.writeFileSync(graph,
    `[0:a]asplit=2[v0][vkey];` +
    `[1:a]volume=0.12[bg];` +
    `[bg][vkey]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=350[dk];` +
    `[v0][dk]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[out]`, "utf8");
  // Ré-encodage vidéo avec plafond de débit : garantit un fichier < 50 Mo (limite
  // Storage Supabase), même pour le JT long. CRF 26 = qualité nette ; maxrate borne le pic.
  run("ffmpeg", ["-y", "-i", rawMp4Abs, "-i", musicAbs, "-filter_complex_script", graph,
    "-map", "0:v", "-map", "[out]",
    "-c:v", "libx264", "-preset", "fast", "-crf", "26",
    "-maxrate", `${Math.round(maxrateK)}k`, "-bufsize", `${Math.round(maxrateK * 2)}k`, "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart", finalOutAbs]);
}

// ---------- upload Storage + enregistrement ----------
export async function uploadVideo(finalOutAbs, storagePath) {
  if (!CAN_UPLOAD) return null;
  const bytes = fs.readFileSync(finalOutAbs);
  const res = await fetch(`${SB_URL}/storage/v1/object/videos/${storagePath}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "video/mp4", "x-upsert": "true",
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`UPLOAD videos/${storagePath} → ${res.status} ${await res.text()}`);
  return `${SB_URL}/storage/v1/object/public/videos/${storagePath}`;
}

export async function recordVideo({ articleId = null, kind, storagePath, publicUrl, durationSec, title }) {
  if (!CAN_UPLOAD) return null;
  return sbInsert("article_videos", {
    article_id: articleId, kind, storage_path: storagePath,
    public_url: publicUrl, duration_sec: Math.round(durationSec), title, status: "ready",
  });
}
