#!/usr/bin/env node
/**
 * Alertiva News — génère UNE vidéo verticale pour le meilleur article récent
 * pas encore mis en vidéo (> 1 min, monétisable). Voix off gratuite edge-tts,
 * musique de fond légère, sous-titres, CTA abonne + partage.
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
  stripMd, sentences, tts, probeDuration, parseVtt, proportionalSpans,
  downloadImage, makeMusicBed, renderRemotion, muxFinal, maxrateForSize, uploadVideo, recordVideo, CAN_UPLOAD,
} from "./lib/alertiva.mjs";

const clean = (s) => stripMd(s);
const MIN_SEC = 62; // marge de sécurité au-dessus de la minute

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

  // Narration.
  const sumSents = sentences(chosen.summary);
  const contentSents = sentences(chosen.content).filter((s) => !sumSents.includes(s));
  const intro = `Alertiva News. ${cat}.`;
  const body = [clean(chosen.title) + ".", ...sumSents, ...contentSents.slice(0, 2)].join(" ");
  const recap = heads.length ? `Également à la une aujourd'hui. ${heads.join(". ")}.` : "";
  const buildParts = (outro) => (recap ? [intro, body, recap, outro] : [intro, body, outro]);

  const workDir = path.join(ROOT, "public", "work-article");
  fs.mkdirSync(workDir, { recursive: true });
  const mp3Rel = "work-article/voice.mp3";
  const mp3Abs = path.join(ROOT, "public", mp3Rel);
  const vttAbs = path.join(workDir, "voice.vtt");

  // Voix + garantie de durée > 1 min.
  let outro = `Abonne-toi à Alertiva News et partage cette vidéo pour rester informé. Retrouve toute l'actualité sur alertiva news point com.`;
  let parts = buildParts(outro);
  console.log("   → voix off edge-tts…");
  tts(parts.join("\n\n"), mp3Abs, vttAbs);
  let durationSec = probeDuration(mp3Abs);
  if (durationSec < MIN_SEC) {
    outro += " Restez avec nous, l'information continue en direct sur Alertiva News, votre rendez-vous quotidien.";
    parts = buildParts(outro);
    tts(parts.join("\n\n"), mp3Abs, vttAbs);
    durationSec = probeDuration(mp3Abs);
  }
  durationSec += 0.5;
  console.log(`   → durée voix : ${durationSec.toFixed(1)}s`);

  const cues = parseVtt(vttAbs);

  // Image nette du sujet.
  const imgRel = "work-article/img.jpg";
  const okImg = await downloadImage(chosen.cover_image, path.join(ROOT, "public", imgRel));

  // Timeline proportionnelle au texte.
  const spans = proportionalSpans(parts, durationSec);
  const segments = [];
  const kinds = recap ? ["intro", "article", "headlines", "outro"] : ["intro", "article", "outro"];
  spans.forEach((sp, i) => {
    const type = kinds[i];
    if (type === "article") segments.push({ type, image: okImg ? imgRel : undefined, title: clean(chosen.title), category: cat, ...sp });
    else if (type === "headlines") segments.push({ type, heading: "Aussi à la une", items: heads, ...sp });
    else segments.push({ type, ...sp });
  });

  const dateStr = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const props = { durationSec, audioFile: mp3Rel, date: dateStr, category: cat, segments, cues };
  fs.writeFileSync(path.join(workDir, "props.json"), JSON.stringify(props, null, 2));

  // Musique + rendu + mixage.
  console.log("   → musique de fond…");
  const musicAbs = path.join(workDir, "music.m4a");
  makeMusicBed(durationSec, musicAbs);

  console.log(`   → rendu Remotion (${Math.round(durationSec)}s)…`);
  const outDir = path.join(ROOT, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const raw = path.join(outDir, "alertiva-article-raw.mp4");
  renderRemotion("AlertivaArticle", path.join(workDir, "props.json"), raw);

  console.log("   → mixage voix + musique + normalisation…");
  const finalOut = path.join(outDir, `alertiva-article-${chosen.slug}.mp4`);
  muxFinal(raw, musicAbs, finalOut, { maxrateK: maxrateForSize(durationSec) });
  fs.rmSync(raw, { force: true });

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
          const desc = `${clean(chosen.title)}\n\n${clean(chosen.summary).slice(0, 300)}\n\n👉 https://alertivanews.com\n\n#Shorts #actualité #news #info #alertiva`;
          const id = await yt.uploadVideo(buf, token, {
            title: `${clean(chosen.title)} #Shorts`.slice(0, 100), description: desc,
            tags: ["actualité", "news", "info", "alertiva", "shorts"], privacy: "public",
          });
          await yt.recordSocialPost({ mediaUrl: publicUrl, videoId: id });
          console.log(`   → YouTube Short : https://youtu.be/${id}`);
        } else {
          console.log("   → YouTube : quota du jour atteint, skip");
        }
      } catch (e) { console.log("   ⚠ YouTube (ignoré) : " + (e.message || e)); }
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
