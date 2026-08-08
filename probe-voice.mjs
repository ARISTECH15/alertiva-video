#!/usr/bin/env node
// Génère une sélection de voix "info" à comparer (OpenAI gpt-audio-mini via OpenRouter).
import fs from "node:fs";
const key = process.env.OPENROUTER_API_KEY;
if (!key) { console.error("OPENROUTER_API_KEY manquante"); process.exit(1); }

const text =
  "Bonjour et bienvenue dans le journal Alertiva. Ce soir, un accord historique vient d'être signé, " +
  "et ses conséquences vont toucher votre quotidien dès demain matin.";
const instructions =
  "Ton grave, sérieux et posé de présentateur de journal télévisé français. Débit maîtrisé, articulation nette, autorité, neutralité.";

const model = "openai/gpt-audio-mini";
const voices = ["ash", "ballad", "echo", "verse", "onyx", "sage", "alloy", "coral"];

for (const voice of voices) {
  const name = `voix-${voice}.mp3`;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text, response_format: "mp3", voice, instructions }),
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
