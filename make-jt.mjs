#!/usr/bin/env node
/**
 * Alertiva News — « Le JT » du soir : récap vidéo vertical (> 1 min) des
 * derniers titres, voix off gratuite edge-tts, musique de fond, CTA.
 *
 *   node make-jt.mjs
 *
 * Rendu 100% possible en ligne (GitHub Actions).
 */
import fs from "node:fs";
import path from "node:path";
import {
  ROOT, CAT_FR, die,
  fetchRecentArticles, stripMd, firstSentence, tts, probeDuration, parseVtt, proportionalSpans,
  downloadImage, makeMusicBed, renderRemotion, muxFinal, uploadVideo, recordVideo, CAN_UPLOAD,
} from "./lib/alertiva.mjs";

const N = 10;

async function main() {
  console.log("🎬 Alertiva — Le JT du soir");

  const rows = await fetchRecentArticles(20);
  if (!Array.isArray(rows) || rows.length < 4) return die("Pas assez d'articles avec image.");

  // Variété : au plus 2 par rubrique.
  const perCat = {};
  const arts = [];
  for (const a of rows) {
    perCat[a.category_slug] = (perCat[a.category_slug] || 0) + 1;
    if (perCat[a.category_slug] <= 2) arts.push(a);
    if (arts.length >= N) break;
  }
  console.log(`   → ${arts.length} titres retenus`);

  const dateStr = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  // Narration : intro + un passage par article + outro (abonne + partage).
  const introText = `Bonjour, voici le journal Alertiva News, l'essentiel de l'actualité de ce ${dateStr}.`;
  const artTexts = arts.map((a) => `${CAT_FR[a.category_slug] || ""}. ${stripMd(a.title)}. ${firstSentence(a.summary)}`);
  const outroText = `Voilà pour ce tour de l'actualité. Abonne-toi et partage cette vidéo pour ne rien manquer, ` +
    `et retrouve tous nos articles sur alertiva news point com. À très vite sur Alertiva News.`;
  const parts = [introText, ...artTexts, outroText];

  const workDir = path.join(ROOT, "public", "work-jt");
  fs.mkdirSync(workDir, { recursive: true });
  const mp3Rel = "work-jt/voice.mp3";
  const mp3Abs = path.join(ROOT, "public", mp3Rel);
  const vttAbs = path.join(workDir, "voice.vtt");

  console.log("   → voix off edge-tts…");
  tts(parts.join("\n\n"), mp3Abs, vttAbs);
  const durationSec = probeDuration(mp3Abs) + 0.4;
  const cues = parseVtt(vttAbs);
  console.log(`   → durée voix : ${durationSec.toFixed(1)}s`);

  // Timeline + téléchargement des visuels.
  const spans = proportionalSpans(parts, durationSec);
  const segments = [];
  for (let i = 0; i < parts.length; i++) {
    const sp = spans[i];
    if (i === 0) segments.push({ type: "intro", ...sp });
    else if (i === parts.length - 1) segments.push({ type: "outro", ...sp });
    else {
      const a = arts[i - 1];
      const imgRel = `work-jt/img-${i}.jpg`;
      const ok = await downloadImage(a.cover_image, path.join(ROOT, "public", imgRel));
      segments.push({ type: "article", image: ok ? imgRel : undefined, title: stripMd(a.title), category: CAT_FR[a.category_slug] || a.category_slug, ...sp });
    }
  }

  const props = { durationSec, audioFile: mp3Rel, date: dateStr, segments, cues };
  fs.writeFileSync(path.join(workDir, "props.json"), JSON.stringify(props, null, 2));

  console.log("   → musique de fond…");
  const musicAbs = path.join(workDir, "music.m4a");
  makeMusicBed(durationSec, musicAbs);

  console.log(`   → rendu Remotion (${Math.round(durationSec)}s)…`);
  const outDir = path.join(ROOT, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const raw = path.join(outDir, "alertiva-jt-raw.mp4");
  renderRemotion("AlertivaJT", path.join(workDir, "props.json"), raw);

  console.log("   → mixage voix + musique + normalisation…");
  const finalOut = path.join(outDir, "alertiva-jt.mp4");
  muxFinal(raw, musicAbs, finalOut);
  fs.rmSync(raw, { force: true });

  const size = (fs.statSync(finalOut).size / 1024 / 1024).toFixed(1);
  console.log(`✅ JT prêt : out/alertiva-jt.mp4 (${size} Mo, ${Math.round(durationSec)}s, 1080×1920)`);

  if (CAN_UPLOAD) {
    console.log("   → upload Supabase Storage…");
    const day = new Date().toISOString().slice(0, 10);
    const storagePath = `jt/${day}.mp4`;
    const publicUrl = await uploadVideo(finalOut, storagePath);
    await recordVideo({ articleId: null, kind: "jt", storagePath, publicUrl, durationSec, title: `Le JT — ${dateStr}` });
    console.log(`   → en ligne : ${publicUrl}`);
  } else {
    console.log("   ⚠ SUPABASE_SERVICE_ROLE_KEY absente : JT gardé en local, pas d'upload.");
  }
}

main().catch((e) => die(e.stack || String(e)));
