// Spec 5.2, which gym he is standing in. One reading, compared against the gyms the
// app knows, and nothing is watched or followed: the location is asked for once and
// the answer is a gym id.

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

/**
 * The nearest gym whose own radius contains the reading, or null when he is at
 * neither. A gym without coordinates cannot be matched and is skipped rather than
 * treated as being at distance zero.
 */
export function gymAt(gyms: readonly GymLocation[], position: Coordinates): GymFix | null {
  let best: GymFix | null = null;

  for (const gym of gyms) {
    if (gym.lat === null || gym.lng === null) continue;
    const distanceM = distanceMetres(position, { lat: gym.lat, lng: gym.lng });
    if (distanceM > gym.radiusM) continue;
    if (!best || distanceM < best.distanceM) best = { gym, distanceM };
  }

  return best;
}
