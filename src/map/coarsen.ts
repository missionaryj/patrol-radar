/** Snap to a ~150 m grid (0.0015° lat ≈ 167 m; lng scaled by latitude). */
export function coarsen(lat: number, lng: number, meters = 150) {
  const dLat = meters / 111_320;
  const dLng = meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lat: Math.round(lat / dLat) * dLat, lng: Math.round(lng / dLng) * dLng };
}
