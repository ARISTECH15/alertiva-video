#!/usr/bin/env node
/**
 * Test : upload la vidéo d'article la plus récente sur la chaîne YouTube (non répertorié).
 *   node youtube-test.mjs
 */
import { ensureAccessToken, uploadVideo, recordSocialPost } from "./lib/youtube.mjs";

const SB_URL = process.env.SB_URL || "https://yzszorqusxudeejunmsx.supabase.co";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  if (!SR) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquante");
  const r = await fetch(
    `${SB_URL}/rest/v1/article_videos?kind=eq.article&order=created_at.desc&limit=1&select=public_url,title`,
    { headers: { apikey: SR, Authorization: `Bearer ${SR}` } }
  );
  const v = (await r.json())[0];
  if (!v?.public_url) throw new Error("Aucune vidéo dans article_videos.");
  console.log("🎬", v.title);

  const token = await ensureAccessToken();
  console.log("🔑 Access token OK");

  const buf = Buffer.from(await (await fetch(v.public_url)).arrayBuffer());
  console.log("⬇️  Téléchargée :", (buf.length / 1024 / 1024).toFixed(1), "Mo");

  const description = `${v.title}\n\nAlertiva News — l'info en continu, claire et sourcée.\n👉 https://alertivanews.com\n\n#actualité #news #info #shorts #alertiva`;
  const id = await uploadVideo(buf, token, {
    title: v.title, description, tags: ["actualité", "news", "info", "alertiva"], privacy: "unlisted",
  });
  console.log("📤 video id :", id);
  console.log("▶️  https://youtu.be/" + id);

  await recordSocialPost({ mediaUrl: v.public_url, videoId: id, status: "published" });
  console.log("✅ Uploadé sur YouTube (non répertorié). Ouvre YouTube Studio pour le voir.");
}

main().catch((e) => { console.error("❌", e.stack || String(e)); process.exit(1); });
