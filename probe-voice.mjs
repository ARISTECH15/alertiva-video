#!/usr/bin/env node
// Génère des échantillons de voix Qwen pour choisir un ton "info".
import fs from "node:fs";
const key = process.env.OPENROUTER_API_KEY;
if (!key) { console.error("OPENROUTER_API_KEY manquante"); process.exit(1); }
const model = "qwen/qwen-audio-3.0-tts-plus";
const text = "Bonjour et bienvenue dans le journal Alertiva. Ce soir, un accord historique vient d'être signé, et ses conséquences vont toucher votre quotidien dès demain matin.";

async function gen(name, extra) {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text, response_format: "mp3", ...extra }),
    });
    const ct = r.headers.get("content-type") || "";
    if (r.ok && !ct.includes("json")) {
      const b = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(name, b);
      console.log(`✅ ${name} → ${b.length} octets`);
    } else {
      console.log(`❌ ${name} → ${r.status} ${(await r.text()).slice(0, 300)}`);
    }
  } catch (e) { console.log(`❌ ${name} → ${e.message}`); }
}

await gen("voix-homme.mp3", { voice: "longanlufeng" });
await gen("voix-homme-news.mp3", {
  voice: "longanlufeng",
  instructions: "Ton grave et sérieux de présentateur de journal télévisé, débit posé et autoritaire, articulation nette.",
});
await gen("voix-femme-news.mp3", {
  voice: "longanlingxin",
  instructions: "Ton sérieux et posé de présentatrice de journal télévisé, autorité et neutralité, débit maîtrisé.",
});
