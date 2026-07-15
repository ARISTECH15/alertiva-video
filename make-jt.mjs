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
  fetchRecentArticles, stripMd, firstSentence, sentences, tts, probeDuration, parseVtt, proportionalSpans,
  downloadImage, makeMusicBed, renderRemotion, muxFinal, maxrateForSize, uploadVideo, recordVideo, CAN_UPLOAD,
} from "./lib/alertiva.mjs";

const N = 15; // JT complet : ~15 titres pour viser plusieurs minutes

async function main() {
  console.log("🎬 Alertiva — Le JT du soir");

  const rows = await fetchRecentArticles(40);
  if (!Array.isArray(rows) || rows.length < 4) return die("Pas assez d'articles avec image.");

  // Variété : au plus 3 par rubrique.
  const perCat = {};
  const arts = [];
  for (const a of rows) {
    perCat[a.category_slug] = (perCat[a.category_slug] || 0) + 1;
    if (perCat[a.category_slug] <= 3) arts.push(a);
    if (arts.length >= N) break;
  }
  console.log(`   → ${arts.length} titres retenus`);

  const dateStr = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  // Narration : intro + un passage par article + outro (abonne + partage).
  const introText = `Bonjour, voici le journal Alertiva News, l'essentiel de l'actualité de ce ${dateStr}.`;
  // Narration étoffée par titre (résumé + extrait du contenu) pour un JT de plusieurs minutes.
  const artTexts = arts.map((a) => {
    const sum = sentences(a.summary).slice(0, 2);
    const body = sentences(a.content).filter((s) => !sum.includes(s)).slice(0, 2);
    const txt = [...sum, ...body].join(" ") || firstSentence(a.summary);
    return `${CAT_FR[a.category_slug] || ""}. ${stripMd(a.title)}. ${txt}`;
  });
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

  const outDir = path.join(ROOT, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const propsPath = path.join(workDir, "props.json");
  const mr = maxrateForSize(durationSec);

  // Rend une composition Remotion puis mixe voix + musique + normalise.
  const renderOne = (compId, outName) => {
    const raw = path.join(outDir, `raw-${outName}`);
    renderRemotion(compId, propsPath, raw);
    const out = path.join(outDir, outName);
    muxFinal(raw, musicAbs, out, { maxrateK: mr });
    fs.rmSync(raw, { force: true });
    return out;
  };

  console.log(`   → rendu JT vertical 9:16 (TikTok/Studio) ${Math.round(durationSec)}s…`);
  const finalVertical = renderOne("AlertivaJT", "alertiva-jt.mp4");
  console.log("   → rendu JT paysage 16:9 (YouTube)…");
  const finalWide = renderOne("AlertivaJTWide", "alertiva-jt-wide.mp4");
  const mo = (p) => (fs.statSync(p).size / 1024 / 1024).toFixed(1);
  console.log(`✅ JT prêts : vertical ${mo(finalVertical)} Mo · paysage ${mo(finalWide)} Mo (${Math.round(durationSec)}s)`);

  if (CAN_UPLOAD) {
    const day = new Date().toISOString().slice(0, 10);

    // Vertical (9:16) → Supabase (Studio + TikTok à publier à la main)
    const urlV = await uploadVideo(finalVertical, `jt/${day}.mp4`);
    await recordVideo({ articleId: null, kind: "jt", storagePath: `jt/${day}.mp4`, publicUrl: urlV, durationSec, title: `Le JT — ${dateStr}` });
    console.log(`   → JT vertical en ligne : ${urlV}`);

    // Paysage (16:9) → Supabase + YouTube (format long)
    const urlW = await uploadVideo(finalWide, `jt-yt/${day}.mp4`);
    await recordVideo({ articleId: null, kind: "jt_yt", storagePath: `jt-yt/${day}.mp4`, publicUrl: urlW, durationSec, title: `Le JT (YouTube) — ${dateStr}` });
    console.log(`   → JT paysage en ligne : ${urlW}`);

    if (process.env.YT_ENABLED !== "0") {
      try {
        const yt = await import("./lib/youtube.mjs");
        if ((await yt.youtubeCountToday()) < Number(process.env.YT_TOTAL_CAP || 6)) {
          const token = await yt.ensureAccessToken();
          const buf = fs.readFileSync(finalWide);
          const sommaire = arts.map((a) => "• " + stripMd(a.title)).join("\n");
          const desc = `Le journal Alertiva News du ${dateStr} — l'essentiel de l'actualité en quelques minutes.\n\nAu sommaire :\n${sommaire}\n\n👉 https://alertivanews.com\n\n#actualité #news #journal #info #alertiva`;
          const id = await yt.uploadVideo(buf, token, {
            title: `JT Alertiva News — ${dateStr}`.slice(0, 100), description: desc.slice(0, 4900),
            tags: ["actualité", "news", "journal", "JT", "alertiva"], privacy: "public",
          });
          await yt.recordSocialPost({ mediaUrl: urlW, videoId: id });
          console.log(`   → YouTube (long, paysage) : https://youtu.be/${id}`);
        } else {
          console.log("   → YouTube : quota du jour atteint, skip JT");
        }
      } catch (e) { console.log("   ⚠ YouTube (ignoré) : " + (e.message || e)); }
    }

    // Instagram Reel du JT (vertical, ≤ 15 min OK sur IG). Pas de Reel Facebook (limité à ~90 s).
    if (process.env.META_ENABLED !== "0") {
      try {
        const meta = await import("./lib/facebook.mjs");
        const cap = `Le JT Alertiva News du ${dateStr} — l'essentiel de l'actualité.\n\n👉 https://alertivanews.com\n\n#actualité #news #JT #alertiva`;
        const r = await meta.publishToMeta(urlV, cap, { fb: false, ig: true });
        console.log("   → Meta (JT) :", JSON.stringify(r));
      } catch (e) { console.log("   ⚠ Meta JT (ignoré) : " + (e.message || e)); }
    }
  } else {
    console.log("   ⚠ SUPABASE_SERVICE_ROLE_KEY absente : JT gardé en local, pas d'upload.");
  }
}

main().catch((e) => die(e.stack || String(e)));
