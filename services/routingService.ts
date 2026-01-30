
import { getDistanceFromLatLonInM } from '../constants';

interface LatLng {
  lat: number;
  lng: number;
}

export const fetchRouteSegment = async (start: LatLng, end: LatLng): Promise<{ path: LatLng[], distance: number } | null> => {
  try {
    // Using OSRM public demo server (Foot profile for walking/running)
    const url = `https://router.project-osrm.org/route/v1/foot/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      // Convert [lon, lat] to {lat, lng}
      const path = route.geometry.coordinates.map((c: number[]) => ({ lat: c[1], lng: c[0] }));
      return {
        path,
        distance: route.distance // meters
      };
    }
  } catch (error) {
    console.warn("Routing failed, falling back to straight line:", error);
  }
  return null;
};

/**
 * Finds the index of the point in the path closest to the user's current location.
 * This allows "Mid-Run" joining.
 */
export const getNearestPointIndex = (currentPos: LatLng, path: LatLng[]): { index: number, distance: number } => {
  if (!path || path.length === 0) return { index: -1, distance: Infinity };

  let minDistance = Infinity;
  let minIndex = -1;

  for (let i = 0; i < path.length; i++) {
    const dist = getDistanceFromLatLonInM(currentPos.lat, currentPos.lng, path[i].lat, path[i].lng);
    if (dist < minDistance) {
      minDistance = dist;
      minIndex = i;
    }
  }

  return { index: minIndex, distance: minDistance };
};

/**
 * Calculates the distance of the path remaining from a specific index.
 */
export const calculateRemainingPathDistance = (path: LatLng[], fromIndex: number): number => {
  if (!path || fromIndex < 0 || fromIndex >= path.length - 1) return 0;
  
  let remainingDist = 0;
  // We start summing distance from the current index to the end
  for (let i = fromIndex; i < path.length - 1; i++) {
    remainingDist += getDistanceFromLatLonInM(path[i].lat, path[i].lng, path[i+1].lat, path[i+1].lng);
  }
  return remainingDist;
};
