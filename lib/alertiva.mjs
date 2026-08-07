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

// ---------- Voix premium : ElevenLabs (repli automatique edge-tts) ----------
// Clé + voix lues dans l'env (ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID) ou dans
// la table Supabase `settings` (voice_key_elevenlabs / voice_id_elevenlabs).
async function settingsValue(key) {
  if (!CAN_UPLOAD) return "";
  try {
    const r = await fetch(`${SB_URL}/rest/v1/settings?key=eq.${key}&select=value`, {
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
    });
    const rows = await r.json();
    return rows?.[0]?.value || "";
  } catch { return ""; }
}

async function elevenConfig() {
  const key = process.env.ELEVENLABS_API_KEY || (await settingsValue("voice_key_elevenlabs"));
  const voice = process.env.ELEVENLABS_VOICE_ID || (await settingsValue("voice_id_elevenlabs")) || "21m00Tcm4TlvDq8ikWAM";
  return { key, voice };
}

const vttStamp = (t) => {
  const x = Math.max(0, t);
  const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s = x % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
};

/** Écrit un .vtt en groupant les mots (timing ElevenLabs) en lignes lisibles. */
function wordsToVtt(words, vttAbs) {
  const blocs = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    const txt = cur.map((w) => w.text).join(" ").trim();
    blocs.push(`${vttStamp(cur[0].start)} --> ${vttStamp(cur[cur.length - 1].end)}\n${txt}`);
    cur = [];
  };
  for (const w of words) {
    cur.push(w);
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0);
    if (chars >= 42 || (w.end - cur[0].start) >= 2.6) flush();
  }
  flush();
  fs.mkdirSync(path.dirname(vttAbs), { recursive: true });
  fs.writeFileSync(vttAbs, "WEBVTT\n\n" + blocs.join("\n\n") + "\n", "utf8");
}

/**
 * Voix off « premium ». Essaie ElevenLabs (voix humaine + timing mot à mot pour
 * des sous-titres bien calés). REPLI AUTOMATIQUE sur edge-tts si ElevenLabs est
 * indisponible : pas de clé, quota épuisé (401/402/429) ou panne réseau — une
 * vidéo en voix gratuite vaut mieux qu'aucune vidéo. Renvoie "elevenlabs" ou "edge".
 */
export async function ttsBest(text, mp3Abs, vttAbs) {
  const { key, voice } = await elevenConfig();
  if (key) {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.75, use_speaker_boost: true },
        }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status + " " + (await res.text()).slice(0, 160));
      const j = await res.json();
      if (!j.audio_base64) throw new Error("réponse sans audio");
      fs.mkdirSync(path.dirname(mp3Abs), { recursive: true });
      fs.writeFileSync(mp3Abs, Buffer.from(j.audio_base64, "base64"));
      const al = j.alignment || j.normalized_alignment || {};
      const chars = al.characters || [], starts = al.character_start_times_seconds || [], ends = al.character_end_times_seconds || [];
      const words = [];
      let cur = null;
      for (let i = 0; i < chars.length; i++) {
        if (/\s/.test(chars[i])) { if (cur) { words.push(cur); cur = null; } }
        else {
          if (!cur) cur = { text: "", start: starts[i] || 0, end: 0 };
          cur.text += chars[i];
          cur.end = ends[i] || cur.start;
        }
      }
      if (cur) words.push(cur);
      if (words.length) { wordsToVtt(words, vttAbs); console.log("     → voix ElevenLabs ✓"); return "elevenlabs"; }
      // Pas d'alignement exploitable : repli complet edge-tts (voix + sous-titres).
      console.log("   ⚠ ElevenLabs sans alignement → repli edge-tts");
    } catch (e) {
      console.log("   ⚠ ElevenLabs indisponible (" + (e.message || e) + ") → repli edge-tts");
    }
  }
  tts(text, mp3Abs, vttAbs);
  return "edge";
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
export async function downloadImage(url, absPath, timeoutMs = 40000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, Buffer.from(await r.arrayBuffer()));
    return true;
  } catch { return false; }
}

// ---------- Images de banque GRATUITE (façon DDUNIT : vraies photos, pas d'IA) ----------
const CAT_EN = {
  monde: "world international scene", france: "france city street", politique: "government parliament",
  economie: "economy business finance", tech: "technology computer", sport: "sport stadium athlete",
  sciences: "science research laboratory", sante: "health hospital medical", culture: "culture art concert",
  insolite: "unusual surprising scene",
};

// Mots-clés EN pertinents (Groq) pour chercher des photos. Repli : la catégorie.
async function imageKeywords(title, summary, categorySlug) {
  const fallback = [CAT_EN[categorySlug] || "news event"];
  const key = await groqKey();
  if (!key) return fallback;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile", temperature: 0.3, max_tokens: 80,
        messages: [{ role: "user", content:
          `4 requêtes de recherche d'images de banque, en ANGLAIS, 2-3 mots chacune, séparées par des virgules. ` +
          `Des scènes/objets visuels CONCRETS illustrant ce sujet, SANS nom propre, sans texte.\n` +
          `Titre : ${title}\nRésumé : ${String(summary || "").slice(0, 300)}\n` +
          `Réponds uniquement par les 4 requêtes séparées par des virgules.` }],
      }),
    });
    const j = await r.json();
    const kws = String(j?.choices?.[0]?.message?.content || "")
      .split(/[,\n]/).map((s) => s.replace(/["'.\d:]/g, "").trim()).filter((s) => s.length > 2).slice(0, 4);
    return kws.length ? kws : fallback;
  } catch { return fallback; }
}

async function pexelsSearch(query, key, perPage) {
  try {
    const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=portrait`,
      { headers: { Authorization: key } });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.photos || []).map((p) => p.src && (p.src.large2x || p.src.portrait || p.src.large)).filter(Boolean);
  } catch { return []; }
}

async function openverseSearch(query, perPage) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=${perPage}&mature=false`,
      { headers: { "User-Agent": "AlertivaNews/1.0 (+https://alertivanews.com)" }, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return [];
    const j = await r.json();
    return (j.results || []).map((x) => x.url).filter(Boolean);
  } catch { return []; }
}

/**
 * Jusqu'à n URLs de VRAIES photos de banque (comme DDUNIT). Pexels si
 * `settings.img_key_pexels` (ou env PEXELS_API_KEY) présent, sinon Openverse (sans
 * clé). Mots-clés EN via Groq pour la pertinence. Résilient : renvoie ce qu'il trouve.
 */
export async function stockImages({ title, summary, categorySlug }, n = 5) {
  const kws = await imageKeywords(title, summary, categorySlug);
  const pexKey = process.env.PEXELS_API_KEY || (await settingsValue("img_key_pexels"));
  const urls = [];
  const seen = new Set();
  const push = (list) => { for (const u of list) { if (u && !seen.has(u)) { seen.add(u); urls.push(u); if (urls.length >= n) return; } } };
  if (pexKey) for (const kw of kws) { if (urls.length >= n) break; push(await pexelsSearch(kw, pexKey, 2)); }
  for (const kw of kws) { if (urls.length >= n) break; push(await openverseSearch(kw, 3)); }
  return urls.slice(0, n);
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
    `Tu transformes une dépêche en NARRATION PARLÉE pour une vidéo verticale d'actualité (TikTok).\n` +
    `Ce texte sera lu à voix haute par une voix de synthèse : écris pour l'OREILLE, pas pour l'œil.\n` +
    `OBJECTIF : accrocher en 3 secondes et GARDER le spectateur jusqu'au bout.\n\n` +
    `STRUCTURE OBLIGATOIRE — méthode de l'entonnoir :\n` +
    `1. ACCROCHE (3 premières secondes) : commence par le CHOC ou la CONCLUSION — une affirmation forte\n` +
    `   qui dit la conséquence la plus marquante. INTERDIT d'ouvrir par : "Alertiva News", une rubrique\n` +
    `   (sport, monde, insolite…), un titre annoncé, "Aujourd'hui", "Selon", "C'est officiel". On entre\n` +
    `   DIRECTEMENT dans le vif. Exemple de ton : "Voici pourquoi votre facture va exploser dès demain."\n` +
    `2. LE FAIT BRUT : l'information nue, immédiatement, en une ou deux phrases.\n` +
    `3. LE CONTEXTE : pourquoi c'est arrivé, en une ou deux phrases.\n` +
    `4. LES CONSÉQUENCES : ce que ça change CONCRÈTEMENT dans le quotidien de la personne qui regarde.\n` +
    (question
      ? `5. CLÔTURE en deux temps : d'abord une QUESTION CLIVANTE qui pousse à commenter — du type\n` +
        `   "Et vous, vous trouvez ça normal ou choquant ? Dites-le en commentaire." — puis UNE phrase\n` +
        `   courte invitant à liker, partager et s'abonner. Jamais de ton publicitaire.\n` +
        `6. BOUCLE : ta toute dernière phrase doit s'enchaîner naturellement avec la phrase d'accroche (1),\n` +
        `   pour que le spectateur reboucle sur le début sans s'en rendre compte.\n`
      : `5. Termine par une phrase de clôture courte.\n`) +
    `\nSTYLE :\n` +
    `- Phrases de 12 mots maximum. Français PARLÉ et vivant : contractions, adresse directe ("vous"),\n` +
    `  rythme. Zéro tournure de presse écrite ("en effet", "par ailleurs", "il convient de", "ce mardi").\n` +
    `- Les chiffres s'écrivent comme on les prononce ("quinze pour cent", "deux millions d'euros").\n` +
    `- AUCUN emoji, AUCUN hashtag, AUCUNE didascalie, AUCUN nom de rubrique. Uniquement le texte à dire.\n` +
    `- N'invente RIEN : aucun chiffre, date, nom ni citation absent du matériau fourni.\n\n` +
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
export async function humaniserJT(sujets, { motsParSujet = 55 } = {}) {
  const key = await groqKey();
  if (!key || !sujets.length) return null;
  const N = sujets.length;
  const bas = Math.round(motsParSujet * 0.8);
  const haut = Math.round(motsParSujet * 1.25);

  const system =
    `Tu écris la narration parlée d'un journal télévisé vertical, lue par une voix de synthèse.\n\n` +
    `On te donne ${N} sujets numérotés. Tu produis EXACTEMENT ${N} passages, dans le MÊME ORDRE,\n` +
    `séparés par une ligne contenant uniquement trois tirets : ---\n\n` +
    `RÈGLES :\n` +
    `- Le passage 1 EST L'ACCROCHE façon "Top ${N}" : annonce d'entrée le nombre d'infos à retenir pour\n` +
    `  donner envie de rester jusqu'au bout — du type "Voici les ${N} infos à retenir maintenant." —\n` +
    `  puis enchaîne DIRECTEMENT sur la première, la plus forte. Pas de "Bonjour", pas de "voici le\n` +
    `  journal", pas de nom de chaîne, pas de date.\n` +
    `- N'annonce JAMAIS la rubrique (sport, monde, insolite…) ni le titre de l'article. On entre dans le fait.\n` +
    `- LONGUEUR DE CHAQUE PASSAGE : entre ${bas} et ${haut} mots. CONTRAINTE LA PLUS IMPORTANTE.\n` +
    `  Un passage de moins de ${bas} mots est un ÉCHEC : le journal devient une liste de brèves.\n` +
    `  Pour atteindre cette longueur, DÉVELOPPE réellement : le fait, le détail concret (chiffre, lieu,\n` +
    `  personne, échéance), puis ce que ça change pour les gens. Trois angles par sujet, pas un résumé.\n` +
    `  Compte tes mots passage par passage avant de répondre.\n` +
    `- Phrases courtes (12 mots max) à l'intérieur du passage, français parlé et vivant, adresse directe.\n` +
    `- Enchaîne naturellement d'un sujet à l'autre, sans "passons à", "autre sujet", "par ailleurs".\n` +
    `- Les chiffres s'écrivent comme on les prononce.\n` +
    `- Le DERNIER passage se termine par une question CLIVANTE (normal ou choquant ?) qui pousse à\n` +
    `  commenter, puis une phrase courte et naturelle invitant à liker, s'abonner et partager. Jamais de ton publicitaire.\n` +
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
          model, temperature: 0.8, max_tokens: Math.min(5000, N * haut * 2 + 600),
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

// ---------- images IA par section (gpt-image via OpenRouter) ----------

/**
 * Découpe le sujet en N sections et renvoie N prompts d'image EN ANGLAIS (un par section),
 * pour une photo d'actualité verticale 9:16. Sans clé Groq / échec → null (repli Pexels).
 */
export async function sectionImagePrompts(matiere, n = 4) {
  const key = await groqKey();
  if (!key || n < 1) return null;
  const system =
    `You write image-generation prompts for a vertical 9:16 NEWS video.\n` +
    `From the French news text, output EXACTLY ${n} prompts in ENGLISH, one per line, numbered "1." to "${n}.".\n` +
    `Each prompt = a photorealistic, editorial news PHOTOGRAPH illustrating one beat of the story, in order\n` +
    `(the 1st is the strongest hook image). Rules: vertical composition; realistic, sober, respectful;\n` +
    `NO text, NO watermark, NO logo, NO real identifiable politician/celebrity faces (use generic people/scenes);\n` +
    `no gore. Under 40 words each. Answer ONLY with the ${n} numbered lines.`;
  const modeles = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"];
  for (const model of modeles) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 45000);
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", signal: ctrl.signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model, temperature: 0.7, max_tokens: 900,
          ...(model.startsWith("openai/") ? { reasoning_effort: "low" } : {}),
          messages: [{ role: "system", content: system }, { role: "user", content: matiere.slice(0, 4000) }],
        }),
      });
      clearTimeout(t);
      const j = await r.json().catch(() => ({}));
      const txt = String(j?.choices?.[0]?.message?.content || "").trim();
      if (!txt) continue;
      const lines = txt.split(/\n+/).map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean);
      if (lines.length >= n) return lines.slice(0, n);
    } catch { /* modèle suivant */ }
  }
  return null;
}

/**
 * Génère des images via l'API images d'OpenRouter (gpt-image-1-mini par défaut, qualité basse, 9:16).
 * Écrit chaque PNG dans outAbsPaths[i]. S'arrête au 1er échec (ex. crédit épuisé) et renvoie les
 * chemins écrits — l'appelant complète avec des photos Pexels gratuites. Silencieux et non bloquant.
 */
export async function genImagesAI(prompts, outAbsPaths) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || !prompts?.length) return [];
  const model = process.env.OPENROUTER_IMAGE_MODEL || "openai/gpt-image-1-mini";
  const quality = process.env.OPENROUTER_IMAGE_QUALITY || "low";
  const written = [];
  let cost = 0;
  for (let i = 0; i < prompts.length; i++) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/images", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`, "Content-Type": "application/json",
          "HTTP-Referer": "https://alertivanews.com", "X-Title": "Alertiva News",
        },
        // gpt-image n'accepte PAS "9:16" ; le portrait le plus proche est "2:3" (accepté :
        // 1:1, 3:2, 2:3, auto). La composition recadre en cover vers 1080×1920.
        body: JSON.stringify({ model, prompt: prompts[i], n: 1, quality, aspect_ratio: process.env.OPENROUTER_IMAGE_ASPECT || "2:3" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { console.log(`   ⚠ gpt-image #${i} HTTP ${r.status} : ${JSON.stringify(j).slice(0, 260)}`); break; }
      const d = (j?.data && j.data[0]) || {};
      const b64 = d.b64_json
        || (typeof d.url === "string" && d.url.startsWith("data:") ? d.url.split(",")[1] : null)
        || (j?.choices?.[0]?.message?.images?.[0]?.image_url?.url || "").split(",")[1] || null;
      if (!b64) { console.log(`   ⚠ gpt-image #${i} sans image : ${JSON.stringify(j).slice(0, 260)}`); break; }
      fs.writeFileSync(outAbsPaths[i], Buffer.from(b64, "base64"));
      written.push(outAbsPaths[i]);
      cost += Number(j?.usage?.cost || 0);
    } catch (e) { console.log(`   ⚠ gpt-image #${i} : ${e.message || e}`); break; }
  }
  if (written.length) console.log(`   💰 gpt-image : ${written.length} image(s), coût ~$${cost.toFixed(3)}`);
  return written;
}

/**
 * Storyboard "cartes" : découpe l'actu en N sections, chacune avec un titre court (headline),
 * un résumé (summary) et un prompt d'image de fond EN ANGLAIS. JSON strict, parsing défensif.
 * Sans clé / échec → null (l'appelant retombe sur l'ancien rendu).
 */
export async function cardStoryboard(matiere, n = 6) {
  const key = await groqKey();
  if (!key || n < 1) return null;
  const system =
    `Tu prépares le STORYBOARD d'une vidéo verticale d'actualité (cartes plein écran avec texte).\n` +
    `À partir du texte d'actu FRANÇAIS, découpe l'info en ${n} SECTIONS dans l'ordre (entonnoir :\n` +
    `accroche choc → faits → contexte → conséquences → question finale). Pour CHAQUE section :\n` +
    `- "headline" : titre TRÈS court (2 à 5 mots), percutant (affiché en MAJUSCULES) ;\n` +
    `- "summary" : une phrase de résumé de la section, max 16 mots, français clair et parlé ;\n` +
    `- "image" : un prompt d'image EN ANGLAIS = photo d'actualité éditoriale verticale, réaliste,\n` +
    `  SANS aucun texte ni logo, sans visage de personnalité identifiable.\n` +
    `N'invente AUCUN fait absent du texte. Réponds UNIQUEMENT avec ce JSON, rien d'autre :\n` +
    `{"sections":[{"headline":"…","summary":"…","image":"…"}]} — exactement ${n} sections.`;
  const modeles = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"];
  for (const model of modeles) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 50000);
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", signal: ctrl.signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model, temperature: 0.6, max_tokens: 1500,
          ...(model.startsWith("openai/") ? { reasoning_effort: "low" } : {}),
          messages: [{ role: "system", content: system }, { role: "user", content: matiere.slice(0, 5000) }],
        }),
      });
      clearTimeout(t);
      const j = await r.json().catch(() => ({}));
      const txt = String(j?.choices?.[0]?.message?.content || "").trim();
      const m = txt.match(/\{[\s\S]*\}/);
      if (!m) continue;
      const parsed = JSON.parse(m[0]);
      const sections = (Array.isArray(parsed?.sections) ? parsed.sections : [])
        .filter((s) => s && s.headline && s.summary && s.image)
        .map((s) => ({ headline: stripMd(String(s.headline)), summary: stripMd(String(s.summary)), image: String(s.image) }))
        .slice(0, n);
      if (sections.length >= Math.min(3, n)) return sections;
    } catch { /* modèle suivant */ }
  }
  return null;
}

// ---------- jingles « flash info » (style chaîne d'info) ----------
// Motif court de 3 notes montantes, attaque nette : signature sonore reconnaissable,
// 100 % synthétisée donc libre de droits. Sert à l'ouverture et, dans le JT,
// aux transitions entre deux titres.
const STING_SEC = 1.5;

/** Jingle d'ouverture fourni par Farid : assets/intro.mp3 (ou .wav / .m4a). */
export function introFile() {
  for (const ext of ["mp3", "wav", "m4a"]) {
    const p = path.join(ROOT, "assets", `intro.${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Durée du silence d'ouverture = durée du jingle. S'adapte au fichier fourni
 * (borné à 6 s) pour qu'on l'entende en entier avant le premier mot.
 */
export function leadSeconds() {
  const f = introFile();
  if (!f) return 2.2;
  return Math.min(6, Math.max(1.5, probeDuration(f) || 2.2));
}

export function makeSting(outAbs) {
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });

  // Musique fournie : on la prend telle quelle, juste bornée et avec un fondu.
  const custom = introFile();
  if (custom) {
    const d = leadSeconds();
    run("ffmpeg", ["-y", "-i", custom, "-t", String(d),
      "-af", `afade=t=out:st=${Math.max(0, d - 0.5).toFixed(2)}:d=0.5,alimiter=limit=0.95`,
      "-c:a", "pcm_s16le", outAbs]);
    return outAbs;
  }

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
  // Concurrence bornée : par défaut Remotion ouvre autant d'onglets Chrome que de
  // cœurs. Sur un runner GitHub (2 cœurs) ou une machine chargée, un rendu long
  // finit par se faire tuer sans message — le rendu s'arrête net à mi-parcours.
  const conc = process.env.REMOTION_CONCURRENCY || "2";
  run("npx", ["remotion", "render", "src/index.ts", compId, rawOutAbs,
    `--props=${propsAbs}`, `--concurrency=${conc}`]);
}

// Limite d'upload du projet Supabase (le bucket, lui, n'en impose aucune).
export const UPLOAD_MAX_MB = Number(process.env.UPLOAD_MAX_MB || 48);

// Débit vidéo max (kbps) visant ~targetMB. Le plancher était à 700 kbps : au-delà
// d'environ 9 minutes, ça dépassait mécaniquement la limite d'upload et le JT
// échouait APRÈS 20 minutes de rendu. Un plancher bas dégrade l'image, mais une
// vidéo un peu moins nette vaut mieux qu'une vidéo perdue.
export function maxrateForSize(durationSec, targetMB = 42) {
  return Math.min(2500, Math.max(300, Math.floor((targetMB * 8 * 1024) / Math.max(1, durationSec)) - 200));
}

export const fileMB = (abs) => fs.statSync(abs).size / 1024 / 1024;

/**
 * Garantit qu'un fichier tient sous la limite d'upload. Ré-encode à un débit
 * calculé sur la taille réellement obtenue, jusqu'à deux fois. Sans ce garde-fou,
 * le dépassement n'apparaît qu'au moment de l'upload — après tout le rendu.
 */
export function ensureUnderLimit(mp4Abs, maxMB = UPLOAD_MAX_MB) {
  for (let essai = 0; essai < 2; essai++) {
    const mb = fileMB(mp4Abs);
    if (mb <= maxMB) return mp4Abs;
    const dur = probeDuration(mp4Abs) || 1;
    const cible = maxMB * 0.88; // marge : le conteneur ajoute un peu
    const kbps = Math.max(220, Math.floor((cible * 8 * 1024) / dur) - 128);
    console.log(`   ⚠ ${mb.toFixed(1)} Mo > ${maxMB} Mo — ré-encodage à ${kbps} kbps…`);
    const tmp = mp4Abs.replace(/\.mp4$/, "-fit.mp4");
    run("ffmpeg", ["-y", "-i", mp4Abs,
      "-c:v", "libx264", "-preset", "fast", "-crf", "30",
      "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`, "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "112k", "-movflags", "+faststart", tmp]);
    fs.rmSync(mp4Abs, { force: true });
    fs.renameSync(tmp, mp4Abs);
  }
  return mp4Abs;
}

// Mix voix + musique (ducking sous la voix) puis normalisation -14 LUFS.
// leadSec : durée d'ouverture pendant laquelle la musique reste à plein volume
// (le jingle doit s'entendre), avant de repasser en fond sous la narration.
export function muxFinal(rawMp4Abs, musicAbs, finalOutAbs, { maxrateK = 2200, leadSec = 0 } = {}) {
  // Voix seule (musicAbs absent) : aucune musique, juste la normalisation -14 LUFS
  // — rendu net « façon DDUNIT ». Utilisé par les Shorts d'article (sans jingle).
  if (!musicAbs) {
    run("ffmpeg", ["-y", "-i", rawMp4Abs, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
      "-map", "0:v", "-map", "0:a",
      "-c:v", "libx264", "-preset", "fast", "-crf", "26",
      "-maxrate", `${Math.round(maxrateK)}k`, "-bufsize", `${Math.round(maxrateK * 2)}k`, "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", finalOutAbs]);
    return;
  }
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
/**
 * Upload vers Storage, avec réessais. Un aléa réseau ne doit pas faire perdre
 * vingt minutes de rendu : c'est exactement ce qui est arrivé au JT du 19/07
 * (« TypeError: fetch failed » après un rendu réussi de 14 Mo).
 * `fetch failed` masque la cause réelle dans err.cause — on la remonte.
 */
export async function uploadVideo(finalOutAbs, storagePath) {
  if (!CAN_UPLOAD) return null;
  const bytes = fs.readFileSync(finalOutAbs);
  const mb = (bytes.length / 1024 / 1024).toFixed(1);
  let dernier = "";

  for (let essai = 1; essai <= 3; essai++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 180000); // 3 min pour un gros fichier
      const res = await fetch(`${SB_URL}/storage/v1/object/videos/${storagePath}`, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`,
          "Content-Type": "video/mp4", "x-upsert": "true",
          "Content-Length": String(bytes.length),
        },
        body: bytes,
        duplex: "half",
      });
      clearTimeout(timer);
      if (res.ok) return `${SB_URL}/storage/v1/object/public/videos/${storagePath}`;
      dernier = `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`;
      // 4xx (hors 429) : inutile de réessayer, la requête est refusée sur le fond.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch (e) {
      const cause = e?.cause?.code || e?.cause?.message || e?.name || "";
      dernier = `${e.message}${cause ? ` (${cause})` : ""}`;
    }
    if (essai < 3) {
      console.log(`   ⚠ upload ${storagePath} (${mb} Mo) — essai ${essai} : ${dernier} → nouvelle tentative…`);
      await new Promise((r) => setTimeout(r, essai * 5000));
    }
  }
  throw new Error(`UPLOAD videos/${storagePath} (${mb} Mo) après 3 essais → ${dernier}`);
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
