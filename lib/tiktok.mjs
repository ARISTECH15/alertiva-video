// Dépôt de vidéos en BROUILLON sur @alertiva (TikTok Content Posting API, inbox).
// Jetons stockés dans Supabase api_tokens (lecture/écriture service_role).
const SB_URL = process.env.SB_URL || "https://yzszorqusxudeejunmsx.supabase.co";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const TT = "https://open.tiktokapis.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** Renvoie un access_token valide, en rafraîchissant via refresh_token si nécessaire. */
export async function ensureAccessToken() {
  need();
  const rows = await sbGet("api_tokens?provider=eq.tiktok&select=client_key,client_secret,access_token,refresh_token,expires_at");
  const t = rows[0];
  if (!t) throw new Error("Aucun jeton TikTok dans api_tokens (autorise d'abord @alertiva).");
  const exp = t.expires_at ? new Date(t.expires_at).getTime() : 0;
  if (t.access_token && exp - Date.now() > 120000) return t.access_token; // encore > 2 min

  const body = new URLSearchParams({
    client_key: t.client_key, client_secret: t.client_secret,
    grant_type: "refresh_token", refresh_token: t.refresh_token,
  });
  const r = await fetch(`${TT}/v2/oauth/token/`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("Refresh TikTok échoué : " + JSON.stringify(j));
  await sbPatch("api_tokens?provider=eq.tiktok", {
    access_token: j.access_token,
    refresh_token: j.refresh_token || t.refresh_token,
    expires_at: new Date(Date.now() + (Number(j.expires_in) || 86400) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  });
  return j.access_token;
}

/** Dépose un MP4 (Buffer) en brouillon dans l'inbox du compte. Renvoie publish_id. */
export async function postVideoDraft(buf, accessToken) {
  const size = buf.length;
  const MAX = 64 * 1024 * 1024;
  const single = size <= MAX;
  const chunkSize = single ? size : 32 * 1024 * 1024;
  const totalChunks = single ? 1 : Math.floor(size / chunkSize); // le dernier chunk absorbe le reste

  const initRes = await fetch(`${TT}/v2/post/publish/inbox/video/init/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: totalChunks } }),
  });
  const initJson = await initRes.json();
  if (initJson?.error && initJson.error.code && initJson.error.code !== "ok") {
    throw new Error("init inbox : " + JSON.stringify(initJson.error));
  }
  const publishId = initJson?.data?.publish_id;
  const uploadUrl = initJson?.data?.upload_url;
  if (!publishId || !uploadUrl) throw new Error("init inbox sans upload_url : " + JSON.stringify(initJson));

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = i === totalChunks - 1 ? size - 1 : start + chunkSize - 1;
    const part = buf.subarray(start, end + 1);
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(part.length),
        "Content-Range": `bytes ${start}-${end}/${size}`,
      },
      body: part,
    });
    if (![200, 201, 206].includes(put.status)) {
      throw new Error(`upload chunk ${i} → ${put.status} ${await put.text()}`);
    }
  }
  return publishId;
}

/** Poll le statut jusqu'à livraison dans l'inbox (SEND_TO_USER_INBOX) ou échec. */
export async function waitInbox(publishId, accessToken, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`${TT}/v2/post/publish/status/fetch/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const j = await r.json();
    const st = j?.data?.status;
    if (st === "SEND_TO_USER_INBOX") return "SEND_TO_USER_INBOX";
    if (st === "FAILED") throw new Error("statut FAILED : " + JSON.stringify(j?.data || j));
    await sleep(4000);
  }
  return "TIMEOUT";
}

/** Enregistre la publication dans social_posts. */
export async function recordSocialPost({ mediaUrl, publishId, status = "published" }) {
  need();
  await sbPost("social_posts", {
    network: "tiktok",
    media_url: mediaUrl || null,
    source: "alertiva-video",
    status,
    post_id: publishId || null,
    published_at: status === "published" ? new Date().toISOString() : null,
  });
}
