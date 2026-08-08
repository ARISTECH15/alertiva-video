#!/usr/bin/env node
/**
 * Alertiva — Pipeline « narration TTS » : SCRIPT → VOIX → VIDÉO → COPYWRITING.
 * Extension de l'outil narration. 100 % modulaire, chaque étape gère ses erreurs.
 *
 * MODULES
 *   1. Voix   : Qwen-Audio-3.0-TTS via OpenRouter (repli auto ElevenLabs/edge-tts).
 *   2. Vidéo  : FFmpeg — les images d'un DOSSIER, réparties équitablement sur la durée de l'audio.
 *   3. Copy   : LLM (Groq) → { description, hashtags } sauvegardé à côté de la vidéo (.txt).
 *
 * USAGE
 *   node make-tts-video.mjs --script script.txt --images ./mes-images
 *   node make-tts-video.mjs --text "Mon script ici" --images ./img --out out/ma-video.mp4 --upload
 *
 * OPTIONS
 *   --script <fichier.txt>   script à lire (ou --text "…")
 *   --text   "<script>"      script en argument direct
 *   --images <dossier>       dossier d'images (jpg/png/webp), triées par nom
 *   --out    <fichier.mp4>   sortie (défaut out/tts-video.mp4)
 *   --upload                 uploade la vidéo dans /studio (Supabase) et l'enregistre
 *
 * ENV : OPENROUTER_API_KEY (TTS), TTS_VOICE / TTS_MODEL (facultatif),
 *       ELEVENLABS_* (repli voix), SUPABASE_SERVICE_ROLE_KEY (--upload).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  ROOT, probeDuration, ttsQwen, ttsBest, copywriting,
  uploadVideo, recordVideo, CAN_UPLOAD,
} from "./lib/alertiva.mjs";

const arg = (name, def = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
};
const hasFlag = (name) => process.argv.includes(`--${name}`);
const IMG_EXT = /\.(jpe?g|png|webp)$/i;

function listImages(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => IMG_EXT.test(f)).sort().map((f) => path.resolve(dir, f));
}

/** MODULE 2 — diaporama FFmpeg : chaque image tient durée/N, mise au format 9:16 (cover). */
function slideshow(audioAbs, imgs, outMp4Abs, fps = 30) {
  if (!imgs.length) throw new Error("Aucune image (jpg/png/webp) dans le dossier.");
  const dur = probeDuration(audioAbs);
  if (!dur) throw new Error("Durée audio illisible.");
  const per = Math.max(0.6, dur / imgs.length);
  const inputs = [];
  for (const img of imgs) inputs.push("-loop", "1", "-t", per.toFixed(3), "-i", img);
  inputs.push("-i", audioAbs);
  const parts = imgs.map(
    (_, i) => `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=${fps},format=yuv420p[v${i}]`
  );
  const concatIn = imgs.map((_, i) => `[v${i}]`).join("");
  const filter = `${parts.join(";")};${concatIn}concat=n=${imgs.length}:v=1:a=0[v]`;
  const args = [
    "-y", ...inputs,
    "-filter_complex", filter,
    "-map", "[v]", "-map", `${imgs.length}:a`,
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k",
    "-shortest", "-movflags", "+faststart", outMp4Abs,
  ];
  const r = spawnSync("ffmpeg", args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0 || !fs.existsSync(outMp4Abs)) throw new Error("FFmpeg a échoué (diaporama).");
  return outMp4Abs;
}

async function main() {
  // --- Script ---
  const scriptFile = arg("script");
  let script = arg("text") || "";
  if (!script && scriptFile && fs.existsSync(scriptFile)) script = fs.readFileSync(scriptFile, "utf8");
  script = String(script || "").trim();
  if (!script) throw new Error('Script vide. Donne --script <fichier.txt> ou --text "…".');

  // --- Images ---
  const imagesDir = arg("images");
  const imgs = listImages(imagesDir);
  if (!imgs.length) throw new Error(`Aucune image dans « ${imagesDir || "(dossier manquant)"} » (jpg/png/webp).`);
  console.log(`🖼️  ${imgs.length} image(s) — ${imagesDir}`);

  const outDir = path.join(ROOT, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const outMp4 = path.resolve(arg("out") || path.join(outDir, "tts-video.mp4"));
  const workDir = path.join(ROOT, "public", "work-tts");
  fs.mkdirSync(workDir, { recursive: true });
  const mp3Abs = path.join(workDir, "voice.mp3");
  const vttAbs = path.join(workDir, "voice.vtt");

  // --- MODULE 1 : voix (Qwen via OpenRouter, repli ElevenLabs/edge-tts) ---
  console.log("🗣️  voix — Qwen-Audio-3.0-TTS (OpenRouter)…");
  let engine = "qwen";
  try {
    await ttsQwen(script, mp3Abs);
  } catch (e) {
    console.log("   ⚠ Qwen TTS indisponible → repli ElevenLabs/edge-tts : " + (e.message || e));
    engine = await ttsBest(script, mp3Abs, vttAbs);
  }
  const durationSec = probeDuration(mp3Abs) || 0;
  if (!durationSec) throw new Error("Audio généré illisible.");
  console.log(`   → voix : ${engine} · ${durationSec.toFixed(1)}s`);

  // --- MODULE 2 : vidéo (FFmpeg diaporama) ---
  console.log("🎞️  montage FFmpeg (images réparties sur toute la durée)…");
  slideshow(mp3Abs, imgs, outMp4);
  console.log(`   → vidéo : ${outMp4} (${(fs.statSync(outMp4).size / 1048576).toFixed(1)} Mo)`);

  // --- MODULE 3 : copywriting (description + hashtags) ---
  console.log("✍️  copywriting…");
  const copy = await copywriting(script);
  if (copy) {
    const txt = `DESCRIPTION\n${copy.description}\n\nHASHTAGS\n${copy.hashtags.join(" ")}\n`;
    fs.writeFileSync(outMp4.replace(/\.mp4$/i, ".txt"), txt, "utf8");
    console.log("\n" + txt);
  } else {
    console.log("   ⚠ copywriting indisponible (LLM).");
  }

  // --- Upload optionnel dans /studio ---
  if (hasFlag("upload")) {
    if (!CAN_UPLOAD) console.log("   ⚠ --upload mais SUPABASE_SERVICE_ROLE_KEY absente.");
    else {
      const storagePath = `narration/tts-${Date.now()}.mp4`;
      const url = await uploadVideo(outMp4, storagePath);
      await recordVideo({ articleId: null, kind: "narration", storagePath, publicUrl: url, durationSec, title: (copy?.description || script).slice(0, 80) });
      console.log("   → /studio : " + url);
    }
  }

  console.log("\n✅ Pipeline terminé.");
}

main().catch((e) => { console.error("❌ " + (e.stack || String(e))); process.exit(1); });
