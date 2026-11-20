# pluvia-alerts

Petite fonction Cloudflare Workers (plan gratuit) qui envoie les alertes de pluie de Pluvia.

- `POST /subscribe` : enregistre un abonnement push et la position surveillée (arrondie à ~1 km).
- `POST /unsubscribe` : supprime l'abonnement et la position.
- `POST /test` : envoie une notification de test à l'abonnement donné.
- Toutes les 10 minutes (cron), pour chaque abonné : interroge Open-Meteo et envoie une notification si la pluie commence bientôt (délai 15 min, 30 min ou 1 h, intensité minimale et plage « ne pas déranger » réglables dans l’application ; une seule alerte par épisode de pluie).

Déploiement : voir les étapes données dans la conversation (clés VAPID, KV, `wrangler deploy`).
Les clés privées ne sont jamais commitées (`vapid-private.jwk.json` est ignoré par git).
