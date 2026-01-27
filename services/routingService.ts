
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
