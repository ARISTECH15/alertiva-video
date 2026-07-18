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
  ROOT, die,
  fetchRecentArticles, stripMd, firstSentence, sentences, tts, probeDuration, parseVtt, proportionalSpans,
  humaniserJT, makeMusicTrack, prependSilence, shiftCues, LEAD_SEC,
  downloadImage, renderRemotion, muxFinal, maxrateForSize, ensureUnderLimit, fileMB,
  uploadVideo, recordVideo, CAN_UPLOAD,
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

  // Matière brute par sujet — sans rubrique annoncée ni titre lu à voix haute.
  const sujets = arts.map((a) => {
    const sum = sentences(a.summary).slice(0, 2);
    const body = sentences(a.content).filter((s) => !sum.includes(s)).slice(0, 2);
    return `${stripMd(a.title)}. ${[...sum, ...body].join(" ") || firstSentence(a.summary)}`;
  });

  // Un SEUL appel pour tout le journal : un par sujet ferait sauter le quota.
  // ~55 mots par sujet ≈ 22 s : 15 sujets donnent un journal d'environ 5 min 30.
  // Sans cette consigne chiffrée, le modèle rend des brèves de 15 mots et le JT
  // tombe à 95 secondes (constaté le 19/07).
  const MOTS_PAR_SUJET = Number(process.env.JT_MOTS_PAR_SUJET || 55);
  console.log("   → réécriture parlée du journal (accroche + question finale)…");
  const humanises = await humaniserJT(sujets, { motsParSujet: MOTS_PAR_SUJET });
  // Repli : on garde au moins la suppression du générique et des rubriques.
  const parts = humanises || sujets.map((s, i) =>
    i === sujets.length - 1
      ? `${s} Et vous, qu'est-ce qui vous marque le plus dans l'actualité du jour ? Dites-le en commentaire.`
      : s);
  console.log(humanises ? `     ${parts.length} passages réécrits` : "     ⚠ IA indisponible → texte de repli");

  const workDir = path.join(ROOT, "public", "work-jt");
  fs.mkdirSync(workDir, { recursive: true });
  const mp3Rel = "work-jt/voice.mp3";
  const mp3Abs = path.join(ROOT, "public", mp3Rel);
  const vttAbs = path.join(workDir, "voice.vtt");

  console.log("   → voix off edge-tts…");
  tts(parts.join("\n\n"), mp3Abs, vttAbs);
  // Silence d'ouverture pour laisser jouer le jingle avant le premier mot.
  const durationSec = prependSilence(mp3Abs, LEAD_SEC) + 0.4;
  const cues = shiftCues(parseVtt(vttAbs), LEAD_SEC);
  console.log(`   → durée : ${durationSec.toFixed(1)}s (dont ${LEAD_SEC}s de jingle)`);

  // Timeline : les passages se répartissent APRÈS le jingle ; le premier visuel
  // démarre à 0 pour le couvrir. Plus de carte de générique.
  const spansNarration = proportionalSpans(parts, durationSec - LEAD_SEC);
  const spans = spansNarration.map((s) => ({ from: s.from + LEAD_SEC, to: s.to + LEAD_SEC }));
  const outroSec = Math.min(3, durationSec * 0.04);

  const segments = [];
  const transitions = []; // instants des jingles de transition
  for (let i = 0; i < parts.length; i++) {
    const a = arts[i];
    const from = i === 0 ? 0 : spans[i].from;
    const to = i === parts.length - 1 ? Math.max(from + 0.1, durationSec - outroSec) : spans[i].to;
    if (i > 0) transitions.push(spans[i].from - 0.6); // jingle juste avant le sujet suivant
    const imgRel = `work-jt/img-${i}.jpg`;
    const ok = a ? await downloadImage(a.cover_image, path.join(ROOT, "public", imgRel)) : false;
    // Texte à l'écran = l'accroche du passage (ce qu'on entend), pas le titre de
    // l'article. Pas de badge rubrique non plus.
    const accroche = (firstSentence(parts[i]) || stripMd(a?.title || "")).slice(0, 100);
    segments.push({ type: "article", image: ok ? imgRel : undefined, title: accroche, from, to });
  }
  segments.push({ type: "outro", from: Math.max(0.1, durationSec - outroSec), to: durationSec });

  const props = { durationSec, audioFile: mp3Rel, date: dateStr, segments, cues };
  fs.writeFileSync(path.join(workDir, "props.json"), JSON.stringify(props, null, 2));

  console.log(`   → jingle d'ouverture + ${transitions.length} transitions…`);
  const musicAbs = path.join(workDir, "music.m4a");
  makeMusicTrack(durationSec, [0, ...transitions], musicAbs);

  const outDir = path.join(ROOT, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const propsPath = path.join(workDir, "props.json");
  const mr = maxrateForSize(durationSec);

  // Rend une composition Remotion puis mixe voix + musique + normalise.
  const renderOne = (compId, outName) => {
    const raw = path.join(outDir, `raw-${outName}`);
    renderRemotion(compId, propsPath, raw);
    const out = path.join(outDir, outName);
    muxFinal(raw, musicAbs, out, { maxrateK: mr, leadSec: LEAD_SEC });
    fs.rmSync(raw, { force: true });
    // Vérifié AVANT l'upload : un dépassement découvert plus tard ferait perdre
    // les vingt minutes de rendu qui viennent de s'écouler.
    ensureUnderLimit(out);
    console.log(`   → ${outName} : ${fileMB(out).toFixed(1)} Mo`);
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
          const desc =
            `Le journal Alertiva News du ${dateStr} — l'essentiel de l'actualité en quelques minutes.\n\n` +
            `Au sommaire :\n${sommaire}\n\n` +
            `👍 Un like, 🔔 un abonnement et 📲 un partage nous aident énormément — et dites-nous en commentaire quel sujet vous a le plus marqué.\n\n` +
            `— À PROPOS —\nAlertiva News, c'est l'essentiel de l'actualité française et internationale, vérifiée et sourcée, chaque jour.\n` +
            `🌐 https://alertivanews.com\n🎵 TikTok : @alertiva\n▶️ YouTube : @ALERTIVANEWS\n\n` +
            `#actualité #news #journal #info #alertiva`;
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
        const cap = `Le JT Alertiva News du ${dateStr} — l'essentiel de l'actualité.\n\n` +
          `👍 Un like, 🔔 abonne-toi et 📲 partage. Quel sujet t'a le plus marqué ? Dis-le en commentaire.\n\n` +
          `🔗 Tous nos articles : alertivanews.com (lien en bio)\n\n` +
          `Alertiva News — l'essentiel de l'actualité, vérifiée et sourcée, chaque jour.\n\n` +
          `#actualité #news #JT #alertiva`;
        const r = await meta.publishToMeta(urlV, cap, { fb: false, ig: true });
        console.log("   → Meta (JT) :", JSON.stringify(r));
      } catch (e) { console.log("   ⚠ Meta JT (ignoré) : " + (e.message || e)); }
    }
  } else {
    console.log("   ⚠ SUPABASE_SERVICE_ROLE_KEY absente : JT gardé en local, pas d'upload.");
  }
}

main().catch((e) => die(e.stack || String(e)));
