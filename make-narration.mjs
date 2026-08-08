#!/usr/bin/env node
/**
 * Alertiva News — monte une vidéo verticale à partir d'une NARRATION ENREGISTRÉE
 * PAR FARID (sa vraie voix) + ses médias, dans l'ordre qu'il a choisi.
 *
 *   node make-narration.mjs                    → prend le plus ancien job "queued"
 *   NARRATION_JOB_ID=<uuid> node make-narration.mjs
 *
 * Différence clé avec make-article.mjs : PAS d'edge-tts. La voix vient du MP3
 * uploadé, et les sous-titres sont recalculés par Whisper (edge-tts fournissait
 * audio + timings ensemble ; ici l'audio est humain, il faut transcrire).
 * C'est le pivot anti-suppression : les plateformes récompensent la voix réelle.
 *
 * Rendu prévu pour GitHub Actions (PC éteint), comme le reste du pipeline.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  ROOT, SB_URL, die, PYTHON,
  probeDuration, parseVtt, downloadImage,
  makeMusicBed, renderRemotion, muxFinal, maxrateForSize,
  uploadVideo, recordVideo, CAN_UPLOAD,
  ttsQwen, ttsBest, copywriting,
} from "./lib/alertiva.mjs";

const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const WHISPER_MODEL = process.env.WHISPER_MODEL || "small";
const publicUrlOf = (storagePath) => `${SB_URL}/storage/v1/object/public/videos/${storagePath}`;

// ---------- accès service_role (la table est en RLS, l'anon ne voit rien) ----------
async function sbAdmin(pathQuery, init = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${pathQuery}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json", ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method || "GET"} ${pathQuery} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const setJob = (id, patch) =>
  sbAdmin(`narration_jobs?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });

// ---------- sous-titres : Whisper local, gratuit, hors ligne ----------
/** Transcrit le MP3 en VTT compatible parseVtt(). Cues courtes (lisibles en vertical). */
function transcribeToVtt(mp3Abs, vttAbs) {
  const py = path.join(path.dirname(vttAbs), "whisper_vtt.py");
  fs.writeFileSync(py, `import sys
from faster_whisper import WhisperModel

audio, out, size = sys.argv[1], sys.argv[2], sys.argv[3]
model = WhisperModel(size, device="cpu", compute_type="int8")
segments, _ = model.transcribe(audio, language="fr", vad_filter=True, word_timestamps=True)

def fmt(t):
    h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
    return "%02d:%02d:%06.3f" % (h, m, s)

MAX_WORDS = 5          # cues courtes : lisibles sur mobile, rythme rapide
cues, buf, start, last = [], [], None, None
for seg in segments:
    for w in (seg.words or []):
        if start is None:
            start = w.start
        buf.append(w.word.strip())
        last = w.end
        if len(buf) >= MAX_WORDS:
            cues.append((start, last, " ".join(buf))); buf, start = [], None
    if buf:  # on coupe aussi en fin de phrase
        cues.append((start, last, " ".join(buf))); buf, start = [], None

with open(out, "w", encoding="utf-8") as f:
    f.write("WEBVTT\\n\\n")
    for a, b, t in cues:
        if not t:
            continue
        f.write("%s --> %s\\n%s\\n\\n" % (fmt(a), fmt(b), t))
print("cues:", len(cues))
`, "utf8");

  const r = spawnSync(PYTHON, [py, mp3Abs, vttAbs, WHISPER_MODEL],
    { stdio: "inherit", shell: process.platform === "win32", cwd: ROOT });
  if (r.status !== 0 || !fs.existsSync(vttAbs)) {
    console.log("   ⚠ Whisper indisponible → vidéo SANS sous-titres");
    fs.writeFileSync(vttAbs, "WEBVTT\n\n", "utf8");
  }
}

async function main() {
  if (!SERVICE_ROLE) die("SUPABASE_SERVICE_ROLE_KEY requise.");
  console.log("🎙️  Alertiva — montage d'une narration (voix de Farid)");

  // 1. Le job à traiter.
  const id = process.env.NARRATION_JOB_ID;
  const rows = await sbAdmin(
    id ? `narration_jobs?id=eq.${id}&select=*`
       : `narration_jobs?status=eq.queued&order=created_at.asc&limit=1&select=*`);
  const job = rows?.[0];
  if (!job) return console.log("   Rien à monter (aucun job en attente).");
  console.log(`   → « ${job.title} »  (job ${job.id})`);

  try {
    await setJob(job.id, { status: "rendering", error: null });

    const workDir = path.join(ROOT, "public", "work-narration");
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });

    // 2. La voix : soit le MP3 uploadé (voix de Farid), soit GÉNÉRÉE (Grok Rex via OpenRouter)
    //    à partir du script — repli automatique ElevenLabs/edge-tts si le TTS échoue.
    const mp3Rel = "work-narration/voice.mp3";
    const mp3Abs = path.join(ROOT, "public", mp3Rel);
    const ttsVtt = path.join(workDir, "tts.vtt");
    if (job.audio_path) {
      if (!(await downloadImage(publicUrlOf(job.audio_path), mp3Abs))) die("Audio introuvable : " + job.audio_path);
    } else if (job.script && String(job.script).trim()) {
      console.log("   → voix générée (Grok Rex via OpenRouter)…");
      try { await ttsQwen(String(job.script), mp3Abs); }
      catch (e) { console.log("   ⚠ TTS échec → repli ElevenLabs/edge-tts : " + (e.message || e)); await ttsBest(String(job.script), mp3Abs, ttsVtt); }
    } else {
      die("Ni audio uploadé ni script fourni pour ce job.");
    }
    let durationSec = probeDuration(mp3Abs);
    if (!durationSec) die("Durée audio illisible (MP3 valide ?).");
    durationSec += 0.4; // petite queue pour ne pas couper le dernier mot
    console.log(`   → voix : ${durationSec.toFixed(1)}s`);

    // 3. Sous-titres depuis SA voix (edge-tts les fournissait, plus maintenant).
    console.log(`   → transcription Whisper (${WHISPER_MODEL})…`);
    const vttAbs = path.join(workDir, "voice.vtt");
    transcribeToVtt(mp3Abs, vttAbs);
    const cues = parseVtt(vttAbs);
    console.log(`   → ${cues.length} sous-titres`);

    // 4. Ses médias, DANS SON ORDRE.
    const media = Array.isArray(job.media) ? job.media : [];
    const rels = [];
    for (let i = 0; i < media.length; i++) {
      const m = media[i];
      const src = typeof m === "string" ? m : m.path;
      if (!src) continue;
      const ext = (path.extname(src).split("?")[0] || ".jpg").toLowerCase();
      const rel = `work-narration/media-${String(i).padStart(2, "0")}${ext}`;
      if (await downloadImage(publicUrlOf(src), path.join(ROOT, "public", rel))) rels.push(rel);
    }
    if (!rels.length) die("Aucun média exploitable (ajoute au moins une image).");
    console.log(`   → ${rels.length} média(s)`);

    // 5. Timeline. PAS de carte d'intro : l'accroche doit être dans les 2 premières
    //    secondes — un générique de marque y gâcherait le seul atout algorithmique.
    const outroSec = Math.min(2.5, durationSec * 0.12);
    const segments = [
      { type: "article", images: rels, title: job.title, from: 0, to: Math.max(0.1, durationSec - outroSec) },
      { type: "outro", from: Math.max(0.1, durationSec - outroSec), to: durationSec },
    ];

    const dateStr = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    const props = { durationSec, audioFile: mp3Rel, date: dateStr, category: "", segments, cues };
    const propsAbs = path.join(workDir, "props.json");
    fs.writeFileSync(propsAbs, JSON.stringify(props, null, 2));

    // 6. Musique + rendu + mixage (identiques au pipeline article).
    console.log("   → musique de fond…");
    const musicAbs = path.join(workDir, "music.m4a");
    makeMusicBed(durationSec, musicAbs);

    console.log(`   → rendu Remotion (${Math.round(durationSec)}s)…`);
    const outDir = path.join(ROOT, "out");
    fs.mkdirSync(outDir, { recursive: true });
    const raw = path.join(outDir, "alertiva-narration-raw.mp4");
    renderRemotion("AlertivaArticle", propsAbs, raw);

    console.log("   → mixage voix + musique…");
    const finalOut = path.join(outDir, `alertiva-narration-${job.id}.mp4`);
    muxFinal(raw, musicAbs, finalOut, { maxrateK: maxrateForSize(durationSec) });
    fs.rmSync(raw, { force: true });

    const sizeMB = (fs.statSync(finalOut).size / 1024 / 1024).toFixed(1);
    console.log(`✅ Vidéo prête (${sizeMB} Mo, ${Math.round(durationSec)}s)`);

    // 7. Publication dans /studio (téléchargement manuel — pas d'auto-post :
    //    la publication TikTok reste manuelle, c'est la stratégie retenue).
    if (!CAN_UPLOAD) return console.log("   ⚠ Pas de clé service_role : vidéo gardée en local.");
    const storagePath = `narration/${job.id}.mp4`;
    const publicUrl = await uploadVideo(finalOut, storagePath);
    await recordVideo({ articleId: null, kind: "narration", storagePath, publicUrl, durationSec, title: job.title });

    // Copywriting réseaux (description + hashtags) à partir du script (ou du titre). Non bloquant.
    let copyPatch = {};
    try {
      const copy = await copywriting(job.script || job.title);
      if (copy) { copyPatch = { caption: copy.description, hashtags: copy.hashtags }; console.log("   → copywriting OK"); }
    } catch (e) { console.log("   ⚠ copywriting (ignoré) : " + (e.message || e)); }

    await setJob(job.id, { status: "ready", video_url: publicUrl, duration_sec: Math.round(durationSec), ...copyPatch });
    console.log(`   → dans /studio : ${publicUrl}`);
  } catch (e) {
    await setJob(job.id, { status: "error", error: String(e.message || e).slice(0, 500) }).catch(() => {});
    throw e;
  }
}

main().catch((e) => die(e.stack || String(e)));
