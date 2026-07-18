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

// ---------- narration humanisée (accroche + question finale) ----------

async function groqKey() {
  if (!CAN_UPLOAD) return "";
  try {
    const r = await fetch(`${SB_URL}/rest/v1/settings?key=eq.text_key_groq&select=value`, {
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
    });
    const rows = await r.json();
    return rows?.[0]?.value || "";
  } catch { return ""; }
}

/**
 * Réécrit un texte brut d'actualité en NARRATION PARLÉE :
 *   - une ACCROCHE qui porte la conséquence dès les 2 premières secondes ;
 *   - aucune mention de rubrique ni de titre annoncé (on entre direct dans le fait) ;
 *   - une QUESTION finale pour déclencher les commentaires.
 * Sans clé ou en cas d'échec, renvoie null : l'appelant garde son texte d'origine.
 * Silencieux et non bloquant — une vidéo sans réécriture vaut mieux qu'aucune vidéo.
 */
export async function humaniser(matiere, { secondes = 60, question = true } = {}) {
  const key = await groqKey();
  if (!key) return null;

  const mots = Math.round((secondes / 60) * 150);
  const system =
    `Tu transformes une dépêche en NARRATION PARLÉE pour une vidéo verticale d'actualité.\n` +
    `Ce texte sera lu à voix haute par une voix de synthèse : écris pour l'OREILLE, pas pour l'œil.\n\n` +
    `RÈGLES ABSOLUES :\n` +
    `1. COMMENCE par une accroche qui dit la CONSÉQUENCE concrète pour la personne qui regarde.\n` +
    `   INTERDIT d'ouvrir par : "Alertiva News", une rubrique (sport, monde, insolite…), un titre annoncé,\n` +
    `   "Aujourd'hui", "Selon", "C'est officiel". On entre DIRECTEMENT dans le vif.\n` +
    `2. Ensuite le fait, puis ce que ça change concrètement. Phrases de 12 mots maximum.\n` +
    `3. Français PARLÉ et vivant : contractions, adresse directe ("vous"), rythme. Zéro tournure de presse écrite\n` +
    `   ("en effet", "par ailleurs", "il convient de", "à noter que", "ce mardi").\n` +
    `4. Les chiffres s'écrivent comme on les prononce ("quinze pour cent", "deux millions d'euros").\n` +
    `5. AUCUN emoji, AUCUN hashtag, AUCUNE didascalie, AUCUN nom de rubrique. Uniquement le texte à dire.\n` +
    (question
      ? `6. TERMINE par une question ouverte au spectateur, courte, qui donne envie de répondre en commentaire.\n`
      : `6. Termine par une phrase de clôture courte.\n`) +
    `7. N'invente RIEN : aucun chiffre, date, nom ni citation qui ne soit dans le matériau fourni.\n\n` +
    `LONGUEUR : environ ${mots} mots.\n\n` +
    `Réponds UNIQUEMENT avec le texte à lire. Pas de titre, pas de balise, pas de commentaire.`;

  const modeles = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"];
  for (const model of modeles) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 45000);
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", signal: ctrl.signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model, temperature: 0.8, max_tokens: Math.min(2000, mots * 3 + 400),
          ...(model.startsWith("openai/") ? { reasoning_effort: "low" } : {}),
          messages: [{ role: "system", content: system }, { role: "user", content: matiere.slice(0, 5000) }],
        }),
      });
      clearTimeout(t);
      const j = await r.json().catch(() => ({}));
      const txt = String(j?.choices?.[0]?.message?.content || "").trim();
      if (txt) return stripMd(txt);
      // 429/413/5xx : le modèle suivant a son propre quota.
    } catch { /* modèle suivant */ }
  }
  return null;
}

/**
 * Version JT : réécrit N sujets en N passages parlés, DANS LE MÊME ORDRE, en un
 * seul appel — 15 appels séparés feraient exploser le quota tokens/minute.
 * Le 1er passage porte l'accroche, le dernier finit par une question.
 * Renvoie null si le compte de blocs ne correspond pas : l'appelant garde son texte.
 */
export async function humaniserJT(sujets) {
  const key = await groqKey();
  if (!key || !sujets.length) return null;
  const N = sujets.length;

  const system =
    `Tu écris la narration parlée d'un journal télévisé vertical, lue par une voix de synthèse.\n\n` +
    `On te donne ${N} sujets numérotés. Tu produis EXACTEMENT ${N} passages, dans le MÊME ORDRE,\n` +
    `séparés par une ligne contenant uniquement trois tirets : ---\n\n` +
    `RÈGLES :\n` +
    `- Le passage 1 COMMENCE par une accroche qui donne envie de rester : la conséquence la plus forte\n` +
    `  du journal. Pas de "Bonjour", pas de "voici le journal", pas de nom de chaîne, pas de date.\n` +
    `- N'annonce JAMAIS la rubrique (sport, monde, insolite…) ni le titre de l'article. On entre dans le fait.\n` +
    `- Chaque passage : 2 à 4 phrases courtes (12 mots max), français parlé et vivant, adresse directe.\n` +
    `- Enchaîne naturellement d'un sujet à l'autre, sans "passons à", "autre sujet", "par ailleurs".\n` +
    `- Les chiffres s'écrivent comme on les prononce.\n` +
    `- Le DERNIER passage se termine par une question ouverte au spectateur, qui appelle un commentaire.\n` +
    `- Aucun emoji, aucun hashtag, aucune didascalie. Uniquement le texte à dire.\n` +
    `- N'invente rien : uniquement ce qui est dans les sujets fournis.\n\n` +
    `Réponds avec les ${N} passages séparés par --- et RIEN d'autre.`;

  const user = sujets.map((s, i) => `SUJET ${i + 1} :\n${s}`).join("\n\n").slice(0, 8000);
  const modeles = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"];

  for (const model of modeles) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 60000);
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", signal: ctrl.signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model, temperature: 0.8, max_tokens: Math.min(4000, N * 120 + 500),
          ...(model.startsWith("openai/") ? { reasoning_effort: "low" } : {}),
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
      });
      clearTimeout(t);
      const j = await r.json().catch(() => ({}));
      const txt = String(j?.choices?.[0]?.message?.content || "").trim();
      if (!txt) continue;
      const blocs = txt.split(/^\s*-{3,}\s*$/m).map((b) => stripMd(b)).filter(Boolean);
      if (blocs.length === N) return blocs;
      console.log(`     ⚠ ${model} a rendu ${blocs.length} passages au lieu de ${N}`);
    } catch { /* modèle suivant */ }
  }
  return null;
}

// ---------- jingles « flash info » (style chaîne d'info) ----------
// Motif court de 3 notes montantes, attaque nette : signature sonore reconnaissable,
// 100 % synthétisée donc libre de droits. Sert à l'ouverture et, dans le JT,
// aux transitions entre deux titres.
const STING_SEC = 1.5;

export function makeSting(outAbs) {
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const notes = [392.0, 523.25, 659.25]; // Sol4 – Do5 – Mi5
  const pas = 0.34;                       // décalage entre les notes
  const graph = path.join(path.dirname(outAbs), "sting.filter");
  const chaines = notes.map((f, i) => {
    const t = (i * pas).toFixed(2);
    // Enveloppe courte (attaque immédiate, extinction rapide) + placement dans le temps.
    return `[${i}:a]atrim=0:0.7,asetpts=PTS-STARTPTS,` +
      `afade=t=in:st=0:d=0.01,afade=t=out:st=0.25:d=0.45,` +
      `adelay=${Math.round(+t * 1000)}|${Math.round(+t * 1000)}[n${i}]`;
  });
  fs.writeFileSync(graph,
    `${chaines.join(";")};` +
    `[n0][n1][n2]amix=inputs=3:normalize=0,` +
    // Niveau élevé assumé : le mixage final réduit ensuite toute la musique,
    // un jingle discret ici deviendrait inaudible dans la vidéo.
    `lowpass=f=5000,aecho=0.7:0.6:180:0.25,volume=3.0,alimiter=limit=0.9,` +
    `apad=whole_dur=${STING_SEC}[out]`, "utf8");
  run("ffmpeg", ["-y",
    ...notes.flatMap((f) => ["-f", "lavfi", "-i", `sine=frequency=${f}:duration=1:sample_rate=48000`]),
    "-filter_complex_script", graph, "-map", "[out]", "-t", String(STING_SEC),
    "-c:a", "pcm_s16le", outAbs]);
  return outAbs;
}

/**
 * Piste musicale complète : nappe de fond + jingle à l'ouverture et à chaque
 * instant de `stingTimes` (secondes). Le mixage final duckera la nappe sous la
 * voix ; les jingles tombent là où la voix se tait, donc ils restent audibles.
 */
export function makeMusicTrack(durationSec, stingTimes, outAbs) {
  const dir = path.dirname(outAbs);
  fs.mkdirSync(dir, { recursive: true });
  const padAbs = path.join(dir, "pad.m4a");
  makeMusicBed(durationSec, padAbs);

  const temps = [...new Set(stingTimes.map((t) => Math.max(0, Math.round(t * 1000))))]
    .filter((ms) => ms < (durationSec - 0.5) * 1000)
    .sort((a, b) => a - b);
  if (!temps.length) { fs.copyFileSync(padAbs, outAbs); return outAbs; }

  const stingAbs = path.join(dir, "sting.wav");
  makeSting(stingAbs);

  const graph = path.join(dir, "track.filter");
  const split = `[1:a]asplit=${temps.length}${temps.map((_, i) => `[s${i}]`).join("")}`;
  const delays = temps.map((ms, i) => `[s${i}]adelay=${ms}|${ms}[d${i}]`);
  // alimiter : la somme nappe + jingles peut saturer, on borne proprement.
  const mix = `[0:a]${temps.map((_, i) => `[d${i}]`).join("")}` +
    `amix=inputs=${temps.length + 1}:normalize=0:duration=first,alimiter=limit=0.95[out]`;
  fs.writeFileSync(graph, [split, ...delays, mix].join(";"), "utf8");

  run("ffmpeg", ["-y", "-i", padAbs, "-i", stingAbs,
    "-filter_complex_script", graph, "-map", "[out]", "-t", String(durationSec),
    "-c:a", "aac", "-b:a", "128k", outAbs]);
  return outAbs;
}

/** Décale la voix pour laisser jouer le jingle d'ouverture avant le premier mot. */
export function prependSilence(mp3Abs, leadSec) {
  const tmp = mp3Abs.replace(/\.mp3$/, "-lead.mp3");
  const ms = Math.round(leadSec * 1000);
  // `all=1` plutôt que `adelay=ms|ms` : sous Windows la commande passe par cmd.exe,
  // qui prendrait le « | » pour un pipe et casserait l'appel.
  run("ffmpeg", ["-y", "-i", mp3Abs, "-af", `adelay=${ms}:all=1`, "-c:a", "libmp3lame", "-q:a", "4", tmp]);
  fs.renameSync(tmp, mp3Abs);
  return probeDuration(mp3Abs);
}

/** Décale les sous-titres du même retard que la voix. */
export const shiftCues = (cues, leadSec) =>
  cues.map((c) => ({ ...c, start: c.start + leadSec, end: c.end + leadSec }));

export const LEAD_SEC = 2.2; // durée du jingle d'ouverture avant le premier mot

// ---------- rendu Remotion + mixage ----------
export function renderRemotion(compId, propsAbs, rawOutAbs) {
  run("npx", ["remotion", "render", "src/index.ts", compId, rawOutAbs, `--props=${propsAbs}`]);
}

// Débit vidéo max (kbps) visant ~targetMB tout en restant sous la limite Storage (50 Mo).
export function maxrateForSize(durationSec, targetMB = 44) {
  return Math.min(2500, Math.max(700, Math.floor((targetMB * 8 * 1024) / Math.max(1, durationSec)) - 200));
}

// Mix voix + musique (ducking sous la voix) puis normalisation -14 LUFS.
// leadSec : durée d'ouverture pendant laquelle la musique reste à plein volume
// (le jingle doit s'entendre), avant de repasser en fond sous la narration.
export function muxFinal(rawMp4Abs, musicAbs, finalOutAbs, { maxrateK = 2200, leadSec = 0 } = {}) {
  const graph = path.join(path.dirname(finalOutAbs), "mux.filter");
  const gainMusique = leadSec > 0
    ? `volume='if(lt(t,${leadSec.toFixed(2)}),1.0,0.12)':eval=frame`
    : `volume=0.12`;
  fs.writeFileSync(graph,
    `[0:a]asplit=2[v0][vkey];` +
    `[1:a]${gainMusique}[bg];` +
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

// Remplace la couverture d'un article sur le site (ex. par une image IA plus pertinente).
export async function updateArticleCover(articleId, coverUrl) {
  if (!CAN_UPLOAD || !articleId || !coverUrl) return;
  await fetch(`${SB_URL}/rest/v1/news_articles?id=eq.${articleId}`, {
    method: "PATCH",
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ cover_image: coverUrl }),
  });
}
