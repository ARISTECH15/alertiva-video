#!/usr/bin/env node
/**
 * Alertiva News — génère UNE vidéo verticale pour le meilleur article récent
 * pas encore mis en vidéo (> 1 min, monétisable). Voix ElevenLabs (repli edge-tts
 * si quota épuisé), plusieurs images, pas de jingle, sous-titres, CTA abonne + partage.
 *
 *   node make-article.mjs
 *
 * Rendu 100% possible en ligne (GitHub Actions) : aucun besoin du PC allumé.
 */
import fs from "node:fs";
import path from "node:path";
import {
  ROOT, CAT_FR, die,
  fetchRecentArticles, videoedArticleIds, lastVideoCategories,
  stripMd, sentences, firstSentence, ttsBest, probeDuration, parseVtt,
  humaniser,
  downloadImage, renderRemotion, muxFinal, maxrateForSize, ensureUnderLimit, fileMB,
  uploadVideo, recordVideo, updateArticleCover, CAN_UPLOAD,
} from "./lib/alertiva.mjs";

const clean = (s) => stripMd(s);
// Durée visée de la narration. On ne rallonge plus artificiellement le texte :
// le remplissage était l'exact contraire d'une narration humaine.
const TARGET_SEC = Number(process.env.ARTICLE_TARGET_SEC || 55);

async function main() {
  console.log("🎬 Alertiva — vidéo par article");

  const recent = await fetchRecentArticles(30);
  if (!Array.isArray(recent) || !recent.length) return console.log("   Rien à produire (aucun article).");

  const done = await videoedArticleIds();
  const lastCats = await lastVideoCategories(3);

  // Candidats : publiés, avec image + résumé, non sensibles, pas déjà en vidéo.
  const candidates = recent
    .filter((a) => a.cover_image && a.summary && !a.is_sensitive && !done.has(a.id))
    .sort((a, b) => (b.views - a.views) || (new Date(b.published_at) - new Date(a.published_at)));

  if (!candidates.length) return console.log("   Rien à produire (tout est déjà en vidéo).");

  // Diversité : éviter la rubrique des dernières vidéos si possible.
  const chosen = candidates.find((a) => !lastCats.includes(a.category_slug)) || candidates[0];
  const cat = CAT_FR[chosen.category_slug] || "À la une";
  console.log(`   → « ${chosen.title} » (${cat}, ${chosen.views} vues)`);

  // Autres titres pour le rappel « Aussi à la une » (rubriques variées).
  const seenCat = new Set([chosen.category_slug]);
  const heads = [];
  for (const a of recent) {
    if (a.id === chosen.id || seenCat.has(a.category_slug)) continue;
    seenCat.add(a.category_slug); heads.push(clean(a.title));
    if (heads.length >= 4) break;
  }
  for (const a of recent) {
    if (heads.length >= 4) break;
    if (a.id === chosen.id) continue;
    const t = clean(a.title);
    if (!heads.includes(t)) heads.push(t);
  }

  // Narration. Plus de générique « Alertiva News. [rubrique]. » ni de titre annoncé :
  // l'accroche doit porter la conséquence dès la première seconde, sinon la
  // complétion s'effondre — et c'est la complétion qui décide de la distribution.
  const sumSents = sentences(chosen.summary);
  const contentSents = sentences(chosen.content).filter((s) => !sumSents.includes(s));
  const matiere = [clean(chosen.title), ...sumSents, ...contentSents.slice(0, 4)].join(" ");

  const workDir = path.join(ROOT, "public", "work-article");
  fs.mkdirSync(workDir, { recursive: true });
  const mp3Rel = "work-article/voice.mp3";
  const mp3Abs = path.join(ROOT, "public", mp3Rel);
  const vttAbs = path.join(workDir, "voice.vtt");

  console.log("   → réécriture parlée (accroche + question finale)…");
  const humanise = await humaniser(matiere, { secondes: TARGET_SEC, question: true });
  // Repli sans IA : au moins on retire le générique et le titre annoncé.
  const secours = [...sumSents, ...contentSents.slice(0, 3)].join(" ") +
    ` Et vous, qu'est-ce que vous en pensez ? Dites-le en commentaire, et retrouvez toute l'actualité sur alertiva news point com.`;
  const narration = humanise || secours;
  console.log(humanise ? "     accroche IA obtenue" : "     ⚠ IA indisponible → texte de repli");

  // Plus de jingle d'ouverture : la voix démarre à 0 (rendu net, façon DDUNIT).
  console.log("   → voix off (ElevenLabs, repli edge-tts auto si quota épuisé)…");
  const engine = await ttsBest(narration, mp3Abs, vttAbs);
  let durationSec = probeDuration(mp3Abs) + 0.4;
  console.log(`   → voix : ${engine} · durée ${durationSec.toFixed(1)}s`);

  const cues = parseVtt(vttAbs);

  // Images du sujet : plusieurs illustrations IA (angles variés) si une clé est configurée,
  // sinon la couverture existante. La 1re devient aussi la couverture de l'article sur le site.
  const images = [];
  try {
    const ai = await import("./lib/aiImage.mjs");
    if (await ai.haveImageKey()) {
      const n = Number(process.env.AI_IMAGES_PER_ARTICLE || 5);
      const urls = await ai.generateImages(`${clean(chosen.title)} — actualité ${cat.toLowerCase()}`, n);
      if (urls.length) {
        await updateArticleCover(chosen.id, urls[0]);
        for (let i = 0; i < urls.length; i++) {
          const rel = `work-article/img-${i}.jpg`;
          if (await downloadImage(urls[i], path.join(ROOT, "public", rel))) images.push(rel);
        }
        console.log(`   → ${images.length} images IA générées`);
      }
    }
  } catch (e) { console.log("   ⚠ images IA (repli banque) : " + (e.message || e)); }
  if (!images.length) {
    const rel = "work-article/img.jpg";
    if (await downloadImage(chosen.cover_image, path.join(ROOT, "public", rel))) images.push(rel);
  }

  // Timeline. L'image démarre à 0 : elle couvre le jingle d'ouverture, il n'y a
  // plus de carte de générique. Pas de badge rubrique non plus.
  const outroSec = Math.min(2.6, durationSec * 0.09);
  // Le texte à l'écran est L'ACCROCHE, pas le titre de l'article : ceux qui
  // regardent sans le son doivent lire la même promesse que celle qu'on entend.
  const accroche = (humanise ? firstSentence(humanise) : clean(chosen.title)).slice(0, 100);
  const segments = [
    { type: "article", images, title: accroche, from: 0, to: Math.max(0.1, durationSec - outroSec) },
    { type: "outro", from: Math.max(0.1, durationSec - outroSec), to: durationSec },
  ];

  const dateStr = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const props = { durationSec, audioFile: mp3Rel, date: dateStr, category: "", segments, cues };
  fs.writeFileSync(path.join(workDir, "props.json"), JSON.stringify(props, null, 2));

  console.log(`   → rendu Remotion (${Math.round(durationSec)}s)…`);
  const outDir = path.join(ROOT, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const raw = path.join(outDir, "alertiva-article-raw.mp4");
  renderRemotion("AlertivaArticle", path.join(workDir, "props.json"), raw);

  console.log("   → normalisation audio (voix seule, façon DDUNIT)…");
  const finalOut = path.join(outDir, `alertiva-article-${chosen.slug}.mp4`);
  muxFinal(raw, null, finalOut, { maxrateK: maxrateForSize(durationSec) });
  fs.rmSync(raw, { force: true });
  ensureUnderLimit(finalOut); // vérifié avant l'upload, pas pendant

  const size = (fs.statSync(finalOut).size / 1024 / 1024).toFixed(1);
  console.log(`✅ Vidéo prête : ${path.relative(ROOT, finalOut)} (${size} Mo, ${Math.round(durationSec)}s)`);

  // Upload cloud + enregistrement (si clé service_role disponible).
  if (CAN_UPLOAD) {
    console.log("   → upload Supabase Storage…");
    const storagePath = `articles/${chosen.id}.mp4`;
    const publicUrl = await uploadVideo(finalOut, storagePath);
    await recordVideo({ articleId: chosen.id, kind: "article", storagePath, publicUrl, durationSec, title: chosen.title });
    console.log(`   → en ligne : ${publicUrl}`);

    // Upload YouTube en Short (vertical court) — plafonné pour respecter le quota API.
    if (process.env.YT_ENABLED !== "0") {
      try {
        const yt = await import("./lib/youtube.mjs");
        const CAP = Number(process.env.YT_ARTICLE_CAP || 5);
        if ((await yt.youtubeCountToday()) < CAP) {
          const token = await yt.ensureAccessToken();
          const buf = fs.readFileSync(finalOut);
          // Lien PROFOND vers l'article : YouTube est le seul réseau où le lien
          // est cliquable, autant envoyer sur le sujet que la personne vient de voir.
          const lien = `https://alertivanews.com/article/${chosen.slug}`;
          const desc =
            `${clean(chosen.summary).slice(0, 300)}\n\n` +
            `👉 L'article complet : ${lien}\n\n` +
            `👍 Un like, 🔔 un abonnement et 📲 un partage nous aident énormément — et dites-nous en commentaire ce que vous en pensez.\n\n` +
            `— À PROPOS —\nAlertiva News, c'est l'essentiel de l'actualité française et internationale, vérifiée et sourcée, chaque jour.\n` +
            `🌐 https://alertivanews.com\n🎵 TikTok : @alertiva\n▶️ YouTube : @ALERTIVANEWS\n\n` +
            `#actualité #news #info #alertiva`;
          const id = await yt.uploadVideo(buf, token, {
            title: clean(chosen.title).slice(0, 100), description: desc,
            tags: ["actualité", "news", "info", "alertiva", "shorts"], privacy: "public",
          });
          await yt.recordSocialPost({ mediaUrl: publicUrl, videoId: id });
          console.log(`   → YouTube Short : https://youtu.be/${id}`);
        } else {
          console.log("   → YouTube : quota du jour atteint, skip");
        }
      } catch (e) { console.log("   ⚠ YouTube (ignoré) : " + (e.message || e)); }
    }

    // Publication auto Facebook + Instagram (Reels) — résilient, chaque réseau indépendant.
    if (process.env.META_ENABLED !== "0") {
      try {
        const meta = await import("./lib/facebook.mjs");
        // Instagram ne rend pas les URL cliquables en légende : on renvoie vers le
        // lien en bio, et on donne l'adresse en clair pour Facebook, où elle l'est.
        const cap = `${clean(chosen.title)}\n\n${clean(chosen.summary).slice(0, 200)}\n\n` +
          `👍 Un like, 🔔 abonne-toi et 📲 partage si l'info t'a été utile. Ton avis en commentaire nous intéresse.\n\n` +
          `🔗 L'article complet : alertivanews.com/article/${chosen.slug}\n(lien en bio)\n\n` +
          `Alertiva News — l'essentiel de l'actualité, vérifiée et sourcée, chaque jour.\n\n` +
          `#actualité #news #info #alertiva`;
        const r = await meta.publishToMeta(publicUrl, cap, { fb: true, ig: true });
        console.log("   → Meta :", JSON.stringify(r));
      } catch (e) { console.log("   ⚠ Meta (ignoré) : " + (e.message || e)); }
    }

    // Dépôt automatique en brouillon TikTok (@alertiva). Activé UNIQUEMENT quand l'app
    // TikTok est passée en Live/auditée (TIKTOK_LIVE=1). En sandbox, l'upload n'atterrit
    // pas sur le vrai compte → on l'évite pour ne pas polluer social_posts. Résilient.
    if (process.env.TIKTOK_LIVE === "1") {
      try {
        const tk = await import("./lib/tiktok.mjs");
        const token = await tk.ensureAccessToken();
        const buf = fs.readFileSync(finalOut);
        const publishId = await tk.postVideoDraft(buf, token);
        const st = await tk.waitInbox(publishId, token);
        await tk.recordSocialPost({ mediaUrl: publicUrl, publishId, status: st === "SEND_TO_USER_INBOX" ? "published" : "pending" });
        console.log(`   → TikTok brouillon : ${st}`);
      } catch (e) {
        console.log("   ⚠ TikTok (ignoré) : " + (e.message || e));
      }
    }
  } else {
    console.log("   ⚠ SUPABASE_SERVICE_ROLE_KEY absente : vidéo gardée en local, pas d'upload.");
  }
}

main().catch((e) => die(e.stack || String(e)));
