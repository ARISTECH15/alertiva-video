#!/usr/bin/env node
/**
 * Test : dépose la vidéo la plus récente d'article_videos en brouillon sur @alertiva.
 * Ne re-rend rien — télécharge le MP4 déjà hébergé et le pousse à TikTok.
 *   node publish-latest.mjs
 */
import { ensureAccessToken, postVideoDraft, postVideoDirect, waitInbox, waitPublish, recordSocialPost } from "./lib/tiktok.mjs";

const SB_URL = process.env.SB_URL || "https://yzszorqusxudeejunmsx.supabase.co";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  if (!SR) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquante");
  const r = await fetch(
    `${SB_URL}/rest/v1/article_videos?kind=eq.article&order=created_at.desc&limit=1&select=article_id,public_url,title`,
    { headers: { apikey: SR, Authorization: `Bearer ${SR}` } }
  );
  const v = (await r.json())[0];
  if (!v?.public_url) throw new Error("Aucune vidéo dans article_videos.");
  console.log("🎬 Vidéo :", v.title);

  const token = await ensureAccessToken();
  console.log("🔑 Access token OK");

  const buf = Buffer.from(await (await fetch(v.public_url)).arrayBuffer());
  console.log("⬇️  Téléchargée :", (buf.length / 1024 / 1024).toFixed(1), "Mo");

  // TIKTOK_DIRECT=1 (app auditée) → publication directe et publique, 100% sans intervention.
  // Sinon → dépôt en brouillon dans l'inbox (comportement actuel, tap manuel requis).
  if (process.env.TIKTOK_DIRECT === "1") {
    const publishId = await postVideoDirect(buf, token, { title: v.title });
    console.log("📤 Direct Post publish_id :", publishId);
    const st = await waitPublish(publishId, token);
    console.log("📡 statut :", st);
    await recordSocialPost({ mediaUrl: v.public_url, publishId, status: st === "PUBLISH_COMPLETE" ? "published" : "pending" });
    console.log(st === "PUBLISH_COMPLETE"
      ? "✅ Publié directement sur @alertiva (public) !"
      : "⚠ statut inattendu : " + st);
  } else {
    const publishId = await postVideoDraft(buf, token);
    console.log("📤 publish_id :", publishId);
    const st = await waitInbox(publishId, token);
    console.log("📡 statut :", st);
    await recordSocialPost({ mediaUrl: v.public_url, publishId, status: st === "SEND_TO_USER_INBOX" ? "published" : "pending" });
    console.log(st === "SEND_TO_USER_INBOX"
      ? "✅ Brouillon déposé dans l'inbox TikTok de @alertiva ! Ouvre l'app pour le voir."
      : "⚠ statut inattendu : " + st);
  }
}

main().catch((e) => { console.error("❌", e.stack || String(e)); process.exit(1); });
