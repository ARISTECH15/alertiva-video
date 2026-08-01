#!/usr/bin/env node
/**
 * DESTRUCTIF — supprime TOUS les objets du bucket Supabase `videos` (Alertiva) via l'API Storage.
 * Déclenché manuellement (workflow_dispatch) avec CONFIRM=SUPPRIMER. Les vidéos sont déjà
 * publiées sur les réseaux ; la copie Supabase est jetable. Ne touche PAS aux autres buckets.
 *   CONFIRM=SUPPRIMER SUPABASE_SERVICE_ROLE_KEY=... node cleanup-videos.mjs
 */
const SB_URL = process.env.SB_URL || "https://yzszorqusxudeejunmsx.supabase.co";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "videos";

if (process.env.CONFIRM !== "SUPPRIMER") {
  console.error("❌ Confirmation manquante (CONFIRM=SUPPRIMER requis). Rien supprimé.");
  process.exit(1);
}
if (!SR) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY manquante.");
  process.exit(1);
}

const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };

/** Liste récursivement tous les chemins de fichiers du bucket (gère les sous-dossiers). */
async function listAll(prefix = "") {
  let out = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const r = await fetch(`${SB_URL}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ prefix, limit, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!r.ok) throw new Error(`list "${prefix}" → ${r.status} ${await r.text()}`);
    const items = await r.json();
    if (!items.length) break;
    for (const it of items) {
      const full = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id === null || it.metadata === null) out = out.concat(await listAll(full)); // dossier
      else out.push(full);
    }
    if (items.length < limit) break;
    offset += limit;
  }
  return out;
}

async function removeBatch(paths) {
  const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: H,
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!r.ok) throw new Error(`delete → ${r.status} ${await r.text()}`);
  return (await r.json()).length;
}

async function main() {
  console.log(`🔎 Listing du bucket "${BUCKET}"…`);
  const all = await listAll("");
  console.log(`📦 ${all.length} fichiers trouvés.`);
  let done = 0;
  for (let i = 0; i < all.length; i += 100) {
    const batch = all.slice(i, i + 100);
    await removeBatch(batch);
    done += batch.length;
    console.log(`   supprimés ${done}/${all.length}`);
  }
  console.log(`✅ ${done} objets supprimés du bucket "${BUCKET}".`);
}
main().catch((e) => {
  console.error("❌", e.stack || String(e));
  process.exit(1);
});
