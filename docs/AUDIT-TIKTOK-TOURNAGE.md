# Kit de tournage — vidéo démo audit TikTok (@alertiva)

> But : filmer la démo que TikTok exige pour approuver le scope `video.publish` (Direct Post).
> **Toi tu filmes des captures brutes. Moi je monte le MP4 final (sous-titres EN + voix + trim 60-90 s, 1080p, ≤ 50 Mo).**
> Tu n'as PAS besoin de parler ni de soigner : filme juste les clics dans l'ordre.

---

## 0. AVANT de filmer (5 min, une seule fois)

**a) Portail TikTok** ([developers.tiktok.com](https://developers.tiktok.com) → ton app) :
1. App en **Production** (pas Sandbox).
2. Content Posting API → scope **`video.publish`** activé (+ `user.info.basic`).
3. Redirect URI présente : `https://alertivanews.com/api/tiktok/callback`.

**b) Côté site** : poser la variable d'env `TIKTOK_SCOPE=user.info.basic,video.publish`
puis redéployer (`sh deploy.sh`). → sans ça, l'écran de consentement montrera l'ancien scope.

**c) Prépare l'écran (propreté = crédibilité pour l'évaluateur)** :
- **Connecte-toi à `/admin` AVANT de lancer l'enregistrement** (pour ne pas filmer ton mot de passe).
- Ferme les onglets perso, notifications, extensions visibles.
- ⚠️ **Ne JAMAIS filmer** : Supabase, un `.env`, une clé/jeton, un App Secret. Rien de secret à l'écran.
- Navigateur en plein écran, zoom 100 %.

**d) Réglages capture** :
- **PC** : `Win + G` (Xbox Game Bar, natif Windows) → ⏺. Idéalement 1080p.
- **Téléphone** : enregistreur d'écran natif (iOS : Centre de contrôle ; Android : volet rapide).

---

## 1. TON tournage PC — une seule prise continue (scènes A → B → C)

Démarre l'enregistrement PC **sur la page d'accueil publique**, puis enchaîne sans couper.

### Scène A — Le média (≈ 8 s)
- Sur **`alertivanews.com`** : scrolle doucement l'accueil, **ouvre un article**, scrolle un peu dans l'article.
- *(sous-titre que J'AJOUTE : « Alertiva News is an automated French news media. We publish short video news summaries to our own TikTok account, @alertiva. »)*

### Scène B — L'autorisation OAuth (≈ 30 s) — **LA scène clé**
1. Va sur **`alertivanews.com/admin/integrations`** (tu es déjà connecté).
2. Repère la carte **« 🎵 TikTok »**.
3. Clique **« Connecter le compte → »**.
4. → Tu arrives sur **l'écran de consentement TikTok**. 🔴 **RESTE 3 SECONDES DESSUS, immobile**, pour qu'on lise bien :
   - le **nom du compte @alertiva**,
   - les permissions demandées : **`video.publish`** + **`user.info.basic`**.
5. Clique **« Authorize »** (Autoriser).
6. → Retour sur la page **« ✅ TikTok connecté »**. Reste 2 s dessus.
- *(sous-titre que J'AJOUTE : « The account owner signs in and authorizes our app via TikTok Login Kit, granting the video.publish and user.info.basic permissions. »)*

### Scène C — La publication par le backend (≈ 20 s)
1. Va sur **`alertivanews.com/admin/publier`**.
2. Sur **n'importe quelle vidéo déjà rendue**, clique le bouton noir **« TikTok »**.
3. Attends que le message apparaisse **sous la carte** : `✓ TikTok : SEND_TO_USER_INBOX`
   (ou `PUBLISH_COMPLETE`). 🔴 **Filme bien ce message de confirmation.**
- *(sous-titre que J'AJOUTE : « From our admin, our backend uploads an original MP4 to the authorized account using the Content Posting API. »)*

**➡️ Coupe l'enregistrement PC ici.** Fichier n° 1 = A + B + C.

---

## 2. TON tournage TÉLÉPHONE (scène D)

### Scène D — La vidéo arrive sur le compte (≈ 12 s)
1. Ouvre l'app **TikTok**, connecté en **@alertiva**.
2. Montre la **vidéo reçue** : soit la notification/l'inbox « vidéo prête à publier », soit — si `PUBLISH_COMPLETE` — la vidéo sur le **profil @alertiva**.
3. Le **nom @alertiva doit être visible** à l'écran (prouve que c'est TON compte).
- *(sous-titre que J'AJOUTE : « The video is delivered to the @alertiva account. We only post original content, to accounts we own, at a limited rate. »)*

**➡️ Fichier n° 2 = D.**

---

## 3. Règles d'or (sinon rejet)
- ✅ Montrer **chaque scope réellement utilisé** (video.publish + user.info.basic) sur l'écran de consentement.
- ✅ Montrer que tu publies sur **ton propre compte** (@alertiva visible en B et D).
- ❌ Ne montrer **aucun** produit/scope non utilisé.
- ❌ **Zéro secret** à l'écran (jeton, App Secret, `.env`, Supabase).
- ✅ Image **nette et lisible** (l'écran de consentement surtout).

---

## 4. M'envoyer les 2 clips
Dépose les 2 fichiers bruts dans : **`C:\Projects\alertiva-video\demo-raw\`**
(crée le dossier). Nomme-les `pc.mp4` et `phone.mp4`, puis dis-moi « c'est filmé ».

## 5. Ce que je fais ensuite (montage)
- Trim + assemblage des 4 scènes dans l'ordre, cible **60-90 s**.
- **Sous-titres EN** incrustés + **voix off EN** (ElevenLabs).
- Export **1080p, ≤ 50 Mo**, MP4 → prêt à uploader dans le formulaire d'audit.
- Je te redonne les **textes de soumission EN** (déjà dans `AUDIT-TIKTOK.md`).
