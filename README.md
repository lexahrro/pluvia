# Pluvia

Application web (PWA) de prévision de pluie : prévision à 15 minutes, prévisions horaires sur 48 h et radar animé des 2 dernières heures. Gratuite, sans compte, sans serveur.

## Développement

```bash
npm install
npm run dev       # serveur de développement (service worker désactivé)
npm run build     # compilation
npm run preview   # teste la version compilée, PWA comprise
```

## Sources de données

- Prévisions : [Open-Meteo](https://open-meteo.com/) (CC BY 4.0, usage non commercial)
- Radar : [RainViewer](https://www.rainviewer.com/api.html) (usage personnel et éducatif)
- Fond de carte : © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
