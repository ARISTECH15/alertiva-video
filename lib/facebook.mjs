// Publication auto sur la Page Facebook (Reels) + Instagram (Reels) depuis le pipeline.
// Jetons dans Supabase api_tokens (provider='facebook' : access_token = jeton de Page,
// meta.page_id, meta.ig_user_id). Résilient : chaque réseau est indépendant.
const SB_URL = process.env.SB_URL || "https://yzszorqusxudeejunmsx.supabase.co";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const GRAPH = "https://graph.facebook.com/v21.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getFb() {
  if (!SR) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquante");
  const r = await fetch(`${SB_URL}/rest/v1/api_tokens?provider=eq.facebook&select=access_token,meta`, {
    headers: { apikey: SR, Authorization: `Bearer ${SR}` },
  });
  const t = (await r.json())[0];
  if (!t?.access_token) throw new Error("Facebook non connecté");
  return { token: t.access_token, pageId: t.meta?.page_id, igId: t.meta?.ig_user_id };
}

export async function postFacebookReel(mediaUrl, caption) {
  const { token, pageId } = await getFb();
  if (!pageId) throw new Error("Aucune Page Facebook liée");
  const start = await fetch(`${GRAPH}/${pageId}/video_reels?upload_phase=start&access_token=${encodeURIComponent(token)}`, { method: "POST" });
  const sj = await start.json();
  if (!sj.video_id || !sj.upload_url) throw new Error("FB start : " + JSON.stringify(sj.error || sj));
  const up = await fetch(sj.upload_url, { method: "POST", headers: { Authorization: `OAuth ${token}`, file_url: mediaUrl } });
  if (up.status >= 300) throw new Error("FB upload : " + up.status + " " + (await up.text()));
  const fin = await fetch(`${GRAPH}/${pageId}/video_reels?upload_phase=finish&video_id=${sj.video_id}&video_state=PUBLISHED&description=${encodeURIComponent(caption)}&access_token=${encodeURIComponent(token)}`, { method: "POST" });
  const fj = await fin.json();
  if (fj.error) throw new Error("FB finish : " + JSON.stringify(fj.error));
  return sj.video_id;
}

export async function postInstagramReel(mediaUrl, caption) {
  const { token, igId } = await getFb();
  if (!igId) throw new Error("Aucun compte Instagram relié");
  const create = await fetch(`${GRAPH}/${igId}/media`, { method: "POST", body: new URLSearchParams({ media_type: "REELS", video_url: mediaUrl, caption, thumb_offset: "4000", access_token: token }) });
  const cj = await create.json();
  if (!cj.id) throw new Error("IG create : " + JSON.stringify(cj.error || cj));
  let status = "";
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const s = await fetch(`${GRAPH}/${cj.id}?fields=status_code&access_token=${token}`);
    status = (await s.json()).status_code;
    if (status === "FINISHED") break;
    if (status === "ERROR") throw new Error("IG traitement échoué");
  }
  if (status !== "FINISHED") throw new Error("IG délai dépassé");
  const pub = await fetch(`${GRAPH}/${igId}/media_publish`, { method: "POST", body: new URLSearchParams({ creation_id: cj.id, access_token: token }) });
  const pj = await pub.json();
  if (!pj.id) throw new Error("IG publish : " + JSON.stringify(pj.error || pj));
  return pj.id;
}

// Post d'ARTICLE : lien cliquable sur la Page Facebook (carte d'aperçu auto depuis l'OG de l'article).
export async function postFacebookLink(articleUrl, message) {
  const { token, pageId } = await getFb();
  if (!pageId) throw new Error("Aucune Page Facebook liée");
  const r = await fetch(`${GRAPH}/${pageId}/feed`, {
    method: "POST",
    body: new URLSearchParams({ message, link: articleUrl, access_token: token }),
  });
  const j = await r.json();
  if (!j.id) throw new Error("FB feed : " + JSON.stringify(j.error || j));
  return j.id;
}

// Post d'ARTICLE : image (couverture) + légende en feed Instagram (pas de lien cliquable sur IG).
export async function postInstagramImage(imageUrl, caption) {
  const { token, igId } = await getFb();
  if (!igId) throw new Error("Aucun compte Instagram relié");
  const create = await fetch(`${GRAPH}/${igId}/media`, { method: "POST", body: new URLSearchParams({ image_url: imageUrl, caption, access_token: token }) });
  const cj = await create.json();
  if (!cj.id) throw new Error("IG image create : " + JSON.stringify(cj.error || cj));
  for (let i = 0; i < 6; i++) {
    const pub = await fetch(`${GRAPH}/${igId}/media_publish`, { method: "POST", body: new URLSearchParams({ creation_id: cj.id, access_token: token }) });
    const pj = await pub.json();
    if (pj.id) return pj.id;
    if (pj.error && pj.error.code !== 9007) throw new Error("IG image publish : " + JSON.stringify(pj.error));
    await sleep(4000);
  }
  throw new Error("IG image : conteneur non prêt");
}

async function record(network, mediaUrl, id) {
  await fetch(`${SB_URL}/rest/v1/social_posts`, {
    method: "POST",
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ network, media_url: mediaUrl, post_id: id, source: "alertiva-video", status: "published", published_at: new Date().toISOString() }),
  });
}

/** Publie sur Meta (Reels). opts.fb / opts.ig (défaut true). Chaque réseau est indépendant. */
export async function publishToMeta(mediaUrl, caption, opts = {}) {
  const out = {};
  if (opts.fb !== false) {
    try { out.fb = await postFacebookReel(mediaUrl, caption); await record("facebook", mediaUrl, out.fb); }
    catch (e) { out.fbErr = e.message || String(e); }
  }
  if (opts.ig !== false) {
    try { out.ig = await postInstagramReel(mediaUrl, caption); await record("instagram", mediaUrl, out.ig); }
    catch (e) { out.igErr = e.message || String(e); }
  }
  return out;
}
