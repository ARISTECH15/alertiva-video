#!/usr/bin/env node
// Sonde temporaire : teste plusieurs voix Qwen sur l'endpoint TTS d'OpenRouter,
// pour trouver un nom de voix valide (le provider renvoyait 400 sur "Cherry").
const key = process.env.OPENROUTER_API_KEY;
if (!key) { console.error("OPENROUTER_API_KEY manquante"); process.exit(1); }

const models = ["qwen/qwen-audio-3.0-tts-plus", "qwen/qwen-audio-3.0-tts-flash"];
const voices = ["Cherry", "Ethan", "Serena", "Chelsie", "Dylan", "Sunny", "Jennifer", "Ryan", "Nofish", "Katerina", "alloy", ""];
const text = "Bonjour, ceci est un test de la voix pour Alertiva News.";

for (const model of models) {
  console.log(`\n===== ${model} =====`);
  for (const voice of voices) {
    try {
      const body = { model, input: text, response_format: "mp3" };
      if (voice) body.voice = voice;
      const r = await fetch("https://openrouter.ai/api/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const ct = r.headers.get("content-type") || "";
      if (r.ok && !ct.includes("json")) {
        const b = Buffer.from(await r.arrayBuffer());
        console.log(`  ✅ voix "${voice || "(défaut)"}" → ${b.length} octets (${ct})`);
      } else {
        const t = await r.text();
        console.log(`  ❌ voix "${voice || "(défaut)"}" → ${r.status} ${t.slice(0, 500)}`);
      }
    } catch (e) { console.log(`  ❌ voix "${voice}" → ${e.message}`); }
  }
}
