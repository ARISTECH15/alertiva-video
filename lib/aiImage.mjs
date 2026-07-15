// Génération d'images d'illustration par IA (fal.ai FLUX / OpenAI gpt-image-1 / Google Imagen).
// Fournisseur + clés lus dans Supabase `settings`. Image générée puis uploadée dans le bucket
// public `videos` (dossier covers/). Prompt éditorial : jamais de texte ni de vrais visages.
const SB_URL = process.env.SB_URL || "https://yzszorqusxudeejunmsx.supabase.co";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const STYLE =
  "editorial news illustration, photojournalistic, cinematic lighting, realistic, high detail, " +
  "WIDE establishing shot, atmospheric mood, environment and scene focused, " +
  "no faces in foreground, no close-up portraits, people small or seen from behind or as a crowd, " +
  "no text, no letters, no words, no watermark, no logos, no captions, " +
  "not depicting any real identifiable person";

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

async function genBuf(prompt, c) {
  if (c.provider === "openai" && c.openai) return genOpenAI(prompt, c.openai);
  if (c.provider === "google" && c.google) return genGoogle(prompt, c.google);
  if (c.fal) return genFal(prompt, c.fal);
  if (c.openai) return genOpenAI(prompt, c.openai);
  if (c.google) return genGoogle(prompt, c.google);
  throw new Error("Aucune clé IA image configurée");
}

// Angles variés pour donner du rythme à la vidéo (mélange plan large / action / ambiance).
const ANGLES = [
  "wide aerial establishing shot of the scene",
  "the action seen from a distance, sense of motion",
  "atmosphere: crowd, flags and lights, mood shot",
  "symbolic environmental context, no people",
];

/** Génère n illustrations (angles variés) pour `subject`, les upload, renvoie les URLs. Résilient. */
export async function generateImages(subject, n = 3) {
  const c = await getConfig();
  const out = [];
  for (let i = 0; i < n; i++) {
    try {
      const prompt = `${subject}, ${ANGLES[i % ANGLES.length]}. ${STYLE}`;
      out.push(await uploadImage(await genBuf(prompt, c)));
    } catch (e) { console.log("   ⚠ image IA #" + (i + 1) + " : " + (e.message || e)); }
  }
  return out;
}

/** Une seule illustration (renvoie l'URL publique Supabase). */
export async function generateImage(subject) {
  const urls = await generateImages(subject, 1);
  if (!urls.length) throw new Error("génération image échouée");
  return urls[0];
}
