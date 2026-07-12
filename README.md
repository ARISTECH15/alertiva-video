# Alertiva Video

Usine à **vidéos verticales** (9:16) pour Alertiva News, rendue **100 % gratuitement en ligne** via GitHub Actions — aucun besoin de garder un PC allumé.

Projet **totalement isolé de DDUNIT** : ne lit/écrit que le Supabase Alertiva (`yzszorqusxudeejunmsx`).

## Ce qui est produit

| Vidéo | Script | Déclenchement | Format |
|-------|--------|---------------|--------|
| **Par article** (la meilleure du moment) | `make-article.mjs` | ~8×/jour (heures de forte audience) + manuel | > 1 min, monétisable |
| **Le JT du soir** (récap du jour) | `make-jt.mjs` | chaque soir 22h Paris + manuel | 2-3 min |

Chaque vidéo : voix off **edge-tts gratuite** (Microsoft Neural, FR), sous-titres synchronisés
sous le titre (jamais dessus), image nette du sujet, **musique de fond légère** façon info,
et **CTA « abonne-toi + partage »** en clôture. Le MP4 est envoyé dans le bucket Supabase
Storage `videos` et enregistré dans la table `article_videos` (prêt pour la publication auto).

## Fonctionnement (cloud)

1. GitHub Actions lance le script à l'heure prévue (voir `.github/workflows/`).
2. Le script choisit le meilleur article récent **pas encore mis en vidéo** (variété des rubriques,
   articles sensibles exclus), rédige la narration (> 62 s garanties), génère la voix, la musique,
   rend la vidéo avec Remotion, mixe (ducking + normalisation −14 LUFS).
3. Upload → `videos/articles/<id>.mp4`, ligne dans `article_videos`.

### Secret requis (à ajouter dans GitHub → Settings → Secrets → Actions)

- `SUPABASE_SERVICE_ROLE_KEY` — clé *service_role* du projet Alertiva (Supabase → Settings → API).
  Sans elle, la vidéo est rendue mais **pas uploadée** (utile en test local).

La clé anon (lecture) et l'URL sont publiques par nature et déjà dans le code.

## Usage local (optionnel)

```bash
npm install
node make-article.mjs   # une vidéo par article
node make-jt.mjs         # le JT du soir
npm run studio           # prévisualiser dans Remotion Studio
```

## Personnaliser la musique

Déposez un fichier `assets/music.mp3` (libre de droits) : il remplacera la nappe générée
automatiquement. Il est bouclé/coupé à la bonne durée et mixé bas sous la voix.
