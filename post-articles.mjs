#!/usr/bin/env node
/**
 * Publie les articles récents (couverture + accroche + lien) sur la Page Facebook
 * (post lien cliquable) et Instagram (image + légende). Dédoublonné, plafonné.
 *   node post-articles.mjs
 */
import { postFacebookLink, postInstagramImage } from "./lib/facebook.mjs";

const SB_URL = process.env.SB_URL || "https://yzszorqusxudeejunmsx.supabase.co";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = "https://alertivanews.com";

async function sbGet(q) {
  const r = await fetch(`${SB_URL}/rest/v1/${q}`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  if (!r.ok) throw new Error(`GET ${q} → ${r.status} ${await r.text()}`);
  return r.json();
}
async function record(network, articleUrl, id) {
  await fetch(`${SB_URL}/rest/v1/social_posts`, {
    method: "POST",
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ network, link: articleUrl, post_id: id, source: "alertiva-social", status: "published", published_at: new Date().toISOString() }),
  });
}
async function alreadyPosted(url) {
  const r = await sbGet(`social_posts?link=eq.${encodeURIComponent(url)}&network=in.(facebook_link,instagram_image)&select=id&limit=1`);
  return r.length > 0;
}

async function main() {
  if (!SR) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquante");
  const CAP = Number(process.env.ARTICLE_POST_CAP || 3);
  const arts = await sbGet(
    "news_articles?status=eq.published&cover_image=not.is.null&is_sensitive=eq.false&order=published_at.desc&limit=25&select=slug,title,summary,cover_image"
  );
  let done = 0;
  for (const a of arts) {
    if (done >= CAP) break;
    const url = `${SITE}/article/${a.slug}`;
    if (await alreadyPosted(url)) continue;
    const teaser = String(a.summary || a.title).slice(0, 280);
    let posted = false;
    try { const id = await postFacebookLink(url, `${a.title}\n\n${teaser}`); await record("facebook_link", url, id); console.log("   FB:", id); posted = true; }
    catch (e) { console.log("   ⚠ FB : " + (e.message || e)); }
    try {
      const cap = `${a.title}\n\n${teaser}\n\n🔗 Toute l'actu sur alertivanews.com\n\n#actualité #news #info #alertiva`;
      const id = await postInstagramImage(a.cover_image, cap); await record("instagram_image", url, id); console.log("   IG:", id); posted = true;
    } catch (e) { console.log("   ⚠ IG : " + (e.message || e)); }
    if (posted) { done++; console.log("✅ posté : " + a.title); }
  }
  console.log(`✅ ${done} article(s) publié(s) sur FB/IG`);
}
main().catch((e) => { console.error("❌ " + (e.stack || String(e))); process.exit(1); });
