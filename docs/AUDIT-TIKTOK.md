# Audit TikTok — Content Posting API (publication auto publique)

## Pré-requis (portail TikTok, à faire avant)
1. Passer l'app **Sandbox → Production**.
2. Content Posting API → ajouter le scope **`video.publish`** (public direct).
3. Redirect URI en Production : `https://alertivanews.com/api/tiktok/callback`.
4. Retirer tout produit/scope non utilisé.

---

## DOCUMENT 1 — Script de la vidéo démo
Format : **1 vidéo**, écran enregistré (OBS / enregistreur d'écran), **60–90 s**, **≤ 50 Mo**, MP4, 1080p.
👉 Ajoute une **voix off OU des sous-titres en ANGLAIS** (les évaluateurs TikTok sont anglophones).

| Temps | À l'écran | Sous-titre EN (à afficher) |
|---|---|---|
| 0:00–0:08 | Page d'accueil **alertivanews.com** + un article | "Alertiva News is an automated news media that publishes video summaries to our TikTok account." |
| 0:08–0:30 | **/admin → Intégrations → Connecter TikTok** → l'**écran de consentement TikTok** (bien montrer les permissions **video.publish** + user.info.basic) → Authorize en **@alertiva** → « connecté » | "The account owner authorizes our app via Login Kit and grants the video.publish permission." |
| 0:30–1:00 | Dans l'admin, clic **« Publier sur TikTok »** sur une vidéo → confirmation (publish_id / statut) | "Using the Content Posting API (video.publish), our backend uploads the video to the authorized account." |
| 1:00–1:15 | App TikTok **@alertiva** → la vidéo publiée (ou le brouillon reçu) | "The video appears on the @alertiva TikTok account." |

Règles : montrer **chaque** scope réellement utilisé ; ne montrer **aucun** produit/scope inutilisé ; image lisible.

---

## DOCUMENT 2 — Texte de soumission (à coller, EN)

**App description**
> Alertiva News (alertivanews.com) is an automated French news media. Our backend generates short vertical video summaries of news articles and a daily video news bulletin, and publishes them to our own TikTok account (@alertiva). We only post to the account we own and control.

**Login Kit — scope `user.info.basic`**
> Used so the owner of the @alertiva account can authorize our application via OAuth. We use the returned open_id to identify the authorized account and securely store the access/refresh tokens to post on its behalf. We do not display, sell or share any user data.

**Content Posting API — scope `video.publish`**
> Used to publish our own original MP4 videos to the authorized @alertiva account via Direct Post. Before each post we call `/v2/post/publish/creator_info/query` to retrieve the allowed privacy options, then call `/v2/post/publish/video/init/` with the chosen privacy level. All content is original and produced by us, with sources cited. Publishing is triggered by our backend, for our own account only, at a limited rate.

**End-to-end flow**
> 1) The account owner authorizes via Login Kit. 2) Our backend generates a vertical MP4 news video. 3) We query creator_info, then Direct Post the video to the account. 4) The video appears on @alertiva.

**Compliance**
> Original content only; we post exclusively to accounts we own; no spam; rate-limited; sources credited in each article.
