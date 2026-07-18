# Vidéo depuis ma narration (ma vraie voix)

Chaîne complète : **tu enregistres ta voix → tu déposes tes visuels → la vidéo se monte
toute seule dans le cloud → elle arrive dans `/studio`, prête à télécharger.**

Pourquoi c'est le pivot : les plateformes (TikTok en tête) pénalisent la voix synthétique
sur template et récompensent explicitement « ajouter vos propres voix off ». C'est le seul
levier qui transforme une vue en abonné — et le seul qui peut débrider le compte.

## 1. Enregistrer (gratuit, chez toi)

| Besoin | Outil |
|---|---|
| Micro | **Ton téléphone** — meilleur qu'un USB à 30 €. N'achète rien. |
| Enregistrer + nettoyer | **Audacity** (libre) |
| Sous-titres | Rien à faire : générés automatiquement par Whisper au montage |

**Réglages Audacity (2 min, une fois)**
1. Enregistre 2 s de silence au début → `Effet → Réduction du bruit` → *Prendre le profil du bruit*, puis sélectionne tout → appliquer.
2. `Effet → Normalisation du volume` → cible **-16 LUFS** (standard réseaux sociaux).
3. `Fichier → Exporter → Exporter en MP3`.

**Prise de son** : micro à 15-20 cm, légèrement de côté (évite les plosives). Pièce avec du
tissu (rideaux, canapé) — jamais une pièce vide et carrelée. Parle **10-15 % plus
énergiquement** que ta voix naturelle : au micro, le naturel sonne plat.

**Écriture** : la **conséquence** dans les 2 premières secondes, jamais le contexte.
« Ça va coûter X à Y » plutôt que « Aujourd'hui, l'Assemblée a voté… ». Vise **40-50 s**.

## 2. Déposer

`/admin` → **🎙️ Ma narration**
- Titre (= le texte affiché à l'écran → écris la conséquence)
- Le MP3
- Les images/clips, réordonnables avec ↑ ↓

Limites : 25 Mo par fichier, 90 Mo au total (Cloudflare coupe au-delà de ~100 Mo).
Formats vidéo acceptés : `mp4`, `mov`, `webm`, `m4v` (joués **muets** — ta voix est la piste audio).

## 3. Ce qui se passe ensuite

1. L'API dépose les fichiers dans le bucket `videos` (`narration/<id>/…`) et crée un job.
2. Elle déclenche le workflow GitHub **Alertiva — Vidéo depuis ma narration** (PC éteint).
3. Le workflow : `faster-whisper` transcrit **ta voix** → VTT → sous-titres ; Remotion monte
   (habillage Alertiva, tes médias dans l'ordre, CTA final) ; ffmpeg mixe voix + musique
   avec ducking et normalise à -14 LUFS.
4. La vidéo est uploadée et apparaît dans **`/studio`** avec le badge vert **🎙️ Ma voix**.

**Pas de publication automatique** : tu télécharges et tu publies à la main sur TikTok.
C'est volontaire — l'automatisation TikTok exige un audit d'app, et le manuel reste la
seule voie viable (c'est déjà ce que tu fais).

**Pas de carte d'intro** : la vidéo démarre directement sur ton contenu. Un générique de
marque en ouverture gâcherait les 2 secondes qui décident de la distribution.

## 4. Configuration requise (une fois)

**Sur GitHub (repo `alertiva-video`)**
- Secret `SUPABASE_SERVICE_ROLE_KEY` — *déjà présent* (utilisé par les autres workflows).
- Variable optionnelle `WHISPER_MODEL` : `small` (défaut, rapide) ou `medium` (plus précis, plus lent).

**Sur le site (`.env` du conteneur `alertiva-news`, conservé entre déploiements)**
```
GH_DISPATCH_TOKEN=<PAT GitHub avec la permission Actions: write sur alertiva-video>
GH_REPO=<compte>/alertiva-video
```
Sans ces deux variables, tout fonctionne quand même : le job reste en file et tu lances le
workflow à la main (GitHub → Actions → *Alertiva — Vidéo depuis ma narration* → *Run workflow*,
en laissant `job_id` vide pour prendre le plus ancien en attente).

## 5. État des tests

| Élément | Testé |
|---|---|
| Compilation Remotion (support vidéo ajouté) | ✅ les 3 compositions se bundlent |
| Format VTT Whisper ↔ `parseVtt()` | ✅ testé, cues et timings corrects |
| Build Next (page admin + API) | ✅ |
| Contrainte SQL `kind='narration'` | ✅ étendue |
| **Rendu de bout en bout** | ❌ **jamais exécuté** — pas de clé service_role ni de Whisper en local |

→ **Premier essai à faire par toi** : dépose une narration courte (~20 s) avec 2 images, et
regarde le run GitHub Actions. Si ça casse, le job passe en `error` avec le message dans
`/admin/narration`.
