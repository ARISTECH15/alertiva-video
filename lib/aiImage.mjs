// Génération d'images d'illustration par IA (fal.ai FLUX / OpenAI gpt-image-1 / Google Imagen).
// Fournisseur + clés lus dans Supabase `settings`. Image générée puis uploadée dans le bucket
// public `videos` (dossier covers/). Prompt éditorial : jamais de texte ni de vrais visages.
const SB_URL = process.env.SB_URL || "https://yzszorqusxudeejunmsx.supabase.co";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const STYLE =
  "editorial news illustration, photojournalistic, cinematic lighting, realistic, high detail, " +
  "no text, no letters, no words, no watermark, no logos, no captions, " +
  "no close-up of identifiable real people faces";

async function getConfig() {
  const r = await fetch(
    `${SB_URL}/rest/v1/settings?key=in.(img_provider,img_key_fal,img_key_openai,img_key_google)&select=key,value`,
    { headers: { apikey: SR, Authorization: `Bearer ${SR}` } }
  );
  const rows = await r.json();
  const S = Object.fromEntries((rows || []).map((x) => [x.key, x.value]));
  return { provider: S.img_provider || "fal", fal: S.img_key_fal, openai: S.img_key_openai, google: S.img_key_google };
}

export async function haveImageKey() {
  const c = await getConfig();
  return !!(c.fal || c.openai || c.google);
}

async function uploadImage(buf) {
  const path = `covers/ai-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e7).toString(36)}.jpg`;
  const res = await fetch(`${SB_URL}/storage/v1/object/videos/${path}`, {
    method: "POST",
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: buf,
  });
  if (!res.ok) throw new Error("upload image → " + res.status + " " + (await res.text()));
  return `${SB_URL}/storage/v1/object/public/videos/${path}`;
}

async function genFal(prompt, key) {
  const r = await fetch("https://fal.run/fal-ai/flux/dev", {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, image_size: "portrait_16_9", num_images: 1, num_inference_steps: 28, enable_safety_checker: true }),
  });
  const j = await r.json();
  const url = j?.images?.[0]?.url;
  if (!url) throw new Error("fal → " + JSON.stringify(j));
  return Buffer.from(await (await fetch(url)).arrayBuffer());
}

async function genOpenAI(prompt, key) {
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1024x1536", n: 1 }),
  });
  const j = await r.json();
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new Error("openai → " + JSON.stringify(j));
  return Buffer.from(b64, "base64");
}

async function genGoogle(prompt, key) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: "9:16" } }),
  });
  const j = await r.json();
  const b64 = j?.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error("google → " + JSON.stringify(j));
  return Buffer.from(b64, "base64");
}

/** Génère une illustration pour `subject`, l'upload, renvoie l'URL publique Supabase. */
export async function generateImage(subject) {
  const c = await getConfig();
  const prompt = `${subject}. ${STYLE}`;
  let buf;
  if (c.provider === "openai" && c.openai) buf = await genOpenAI(prompt, c.openai);
  else if (c.provider === "google" && c.google) buf = await genGoogle(prompt, c.google);
  else if (c.fal) buf = await genFal(prompt, c.fal);
  else if (c.openai) buf = await genOpenAI(prompt, c.openai);
  else if (c.google) buf = await genGoogle(prompt, c.google);
  else throw new Error("Aucune clé IA image configurée");
  return uploadImage(buf);
}
