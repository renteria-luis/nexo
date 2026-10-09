// Spec 5.2, which gym he is standing in. One reading, compared against the gyms the
// app knows, and nothing is watched or followed: each reading is asked for once, when
// he opens Entreno or taps the arrow, and the answer is a gym id.

export type Coordinates = { lat: number; lng: number };

export type GymLocation = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  radiusM: number;
};

const EARTH_RADIUS_M = 6_371_000;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great circle distance in metres. Haversine: exact enough at street scale. */
export function distanceMetres(from: Coordinates, to: Coordinates): number {
  const dLat = radians(to.lat - from.lat);
  const dLng = radians(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type GymFix = {
  gym: GymLocation;
  distanceM: number;
};

export type GymReading =
  { kind: 'match'; fix: GymFix } | { kind: 'elsewhere' } | { kind: 'unsure' };

/**
 * El error mas grande con el que una lectura todavia dice algo. Mas que eso es un barrio,
 * no un gimnasio: en la plaza de Fit4Less el radio entero es 150 m.
 */
export const READING_MAX_ERROR_M = 100;

/**
 * Que gimnasio dice una lectura, con su error en metros.
 *
 * Dentro del radio de uno es ese, el mas cercano si hubiera dos. Fuera de todos solo
 * cuenta como "en otro sitio" si ni con el error podria estar dentro de alguno; si
 * podria, o el error no se sabe o es demasiado, la lectura no decide nada. Un gimnasio
 * sin coordenadas no se puede encontrar y se salta, en vez de contar como a cero metros.
 */
export function readGym(
  gyms: readonly GymLocation[],
  position: Coordinates,
  errorM: number | null,
): GymReading {
  if (errorM === null || !Number.isFinite(errorM) || errorM > READING_MAX_ERROR_M) {
    return { kind: 'unsure' };
  }

  let best: GymFix | null = null;
  let maybe = false;
  for (const gym of gyms) {
    if (gym.lat === null || gym.lng === null) continue;
    const distanceM = distanceMetres(position, { lat: gym.lat, lng: gym.lng });
    if (distanceM <= gym.radiusM) {
      if (!best || distanceM < best.distanceM) best = { gym, distanceM };
    } else if (distanceM - errorM <= gym.radiusM) {
      maybe = true;
    }
  }

  if (best) return { kind: 'match', fix: best };
  return maybe ? { kind: 'unsure' } : { kind: 'elsewhere' };
}
