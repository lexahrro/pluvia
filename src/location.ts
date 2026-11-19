export interface Position {
  lat: number;
  lon: number;
  /** 'gps' = position de l'appareil, 'default' = position de secours (Paris) */
  source: 'gps' | 'default';
  /** Raison du repli sur la position par défaut (si source === 'default') */
  reason?: string;
}

const DEFAULT_POSITION = { lat: 48.8566, lon: 2.3522 }; // Paris

function describeError(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Accès à la position refusé.';
    case err.POSITION_UNAVAILABLE:
      return 'Position indisponible.';
    case err.TIMEOUT:
      return 'La localisation a pris trop de temps.';
    default:
      return 'Localisation impossible.';
  }
}

/**
 * Demande la position de l'appareil. Ne rejette jamais :
 * en cas d'échec, renvoie Paris avec la raison de l'échec.
 */
export function getPosition(): Promise<Position> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve({ ...DEFAULT_POSITION, source: 'default', reason: 'Géolocalisation non supportée.' });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          source: 'gps',
        }),
      (err) => resolve({ ...DEFAULT_POSITION, source: 'default', reason: describeError(err) }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  });
}
