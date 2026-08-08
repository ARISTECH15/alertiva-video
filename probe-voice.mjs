#!/usr/bin/env node
// Génère une sélection de voix "info" à comparer, depuis plusieurs modèles TTS d'OpenRouter.
import fs from "node:fs";
const key = process.env.OPENROUTER_API_KEY;
if (!key) { console.error("OPENROUTER_API_KEY manquante"); process.exit(1); }

const text =
  "Bonjour et bienvenue dans le journal Alertiva. Ce soir, un accord historique vient d'être signé, " +
  "et ses conséquences vont toucher votre quotidien dès demain matin.";

// Voix masculines / posées candidates pour l'info.
const trials = [
  { model: "x-ai/grok-voice-tts-1.0", voices: ["Rex", "Leo", "Sal", "Ara"] },
  { model: "google/gemini-3.1-flash-tts-preview", voices: ["Orus", "Charon", "Iapetus", "Fenrir"] },
];

for (const { model, voices } of trials) {
  const short = model.split("/")[1].split("-")[0];
  for (const voice of voices) {
    const name = `voix-${short}-${voice}.mp3`;
    try {
      const r = await fetch("https://openrouter.ai/api/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: text, response_format: "mp3", voice }),
      });
      const ct = r.headers.get("content-type") || "";
      if (r.ok && !ct.includes("json")) {
        const b = Buffer.from(await r.arrayBuffer());
        fs.writeFileSync(name, b);
        console.log(`✅ ${name} → ${b.length} octets`);
      } else {
        console.log(`❌ ${name} → ${r.status} ${(await r.text()).slice(0, 200)}`);
      }
    } catch (e) { console.log(`❌ ${name} → ${e.message}`); }
  }
}
