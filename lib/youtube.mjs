// Upload de vidéos sur la chaîne @ALERTIVANEWS (YouTube Data API v3).
// Jetons dans Supabase api_tokens (provider='youtube'), refresh automatique.
const SB_URL = process.env.SB_URL || "https://yzszorqusxudeejunmsx.supabase.co";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const G_TOKEN = "https://oauth2.googleapis.com/token";

function need() { if (!SR) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquante"); }

async function sbGet(q) {
  const r = await fetch(`${SB_URL}/rest/v1/${q}`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  if (!r.ok) throw new Error(`SB GET ${q} → ${r.status} ${await r.text()}`);
  return r.json();
}
async function sbPatch(q, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${q}`, {
    method: "PATCH",
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`SB PATCH ${q} → ${r.status} ${await r.text()}`);
}
async function sbPost(table, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`SB POST ${table} → ${r.status} ${await r.text()}`);
}

/** Renvoie un access_token YouTube valide (rafraîchit via refresh_token si besoin). */
export async function ensureAccessToken() {
  need();
  const rows = await sbGet("api_tokens?provider=eq.youtube&select=client_key,client_secret,access_token,refresh_token,expires_at");
  const t = rows[0];
  if (!t) throw new Error("Aucun jeton YouTube dans api_tokens (autorise d'abord la chaîne).");
  const exp = t.expires_at ? new Date(t.expires_at).getTime() : 0;
  if (t.access_token && exp - Date.now() > 120000) return t.access_token;

  const body = new URLSearchParams({
    client_id: t.client_key, client_secret: t.client_secret,
    grant_type: "refresh_token", refresh_token: t.refresh_token,
  });
  const r = await fetch(G_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json();
  if (!j.access_token) throw new Error("Refresh YouTube échoué : " + JSON.stringify(j));
  await sbPatch("api_tokens?provider=eq.youtube", {
    access_token: j.access_token,
    expires_at: new Date(Date.now() + (Number(j.expires_in) || 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  });
  return j.access_token;
}

/** Upload résumable d'un MP4 (Buffer). Renvoie l'ID vidéo YouTube. */
export async function uploadVideo(buf, accessToken, { title, description = "", tags = [], privacy = "unlisted", madeForKids = false }) {
  const size = buf.length;
  const meta = {
    snippet: { title: String(title).slice(0, 100), description: String(description).slice(0, 4900), tags, categoryId: "25" }, // 25 = News & Politics
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: madeForKids },
  };
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify(meta),
  });
  if (!init.ok) throw new Error(`init upload YT → ${init.status} ${await init.text()}`);
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new Error("YT : pas d'URL d'upload renvoyée");

  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(size) },
    body: buf,
  });
  const j = await put.json().catch(() => ({}));
  if (!j.id) throw new Error(`upload YT → ${put.status} ${JSON.stringify(j)}`);
  return j.id;
}

export async function recordSocialPost({ mediaUrl, videoId, status = "published" }) {
  need();
  await sbPost("social_posts", {
    network: "youtube",
    media_url: mediaUrl || null,
    link: videoId ? `https://youtu.be/${videoId}` : null,
    source: "alertiva-video",
    status,
    post_id: videoId || null,
    published_at: status === "published" ? new Date().toISOString() : null,
  });
}
