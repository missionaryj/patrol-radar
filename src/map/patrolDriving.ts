/** Visual-only camera policy. The scan engine and detections are never changed. */
export const DRIVING_SPEED_MPS = 4.5;
export const DRIVING_GPS_ACCURACY_M = 35;
export const DRIVING_HOLD_MS = 12_000;
export const PATROL_DRIVE_ZOOM = 16.6;
export const MAX_PATROL_ZOOM = 18;

export class PatrolMotion {
  private lastReliableMove = -Infinity;
  /** Hold the moving presentation at traffic lights and between GPS fixes. */
  update(speed: number | null | undefined, accuracy: number, timestamp: number): boolean {
    if (Number.isFinite(timestamp) && Number.isFinite(accuracy) && accuracy <= DRIVING_GPS_ACCURACY_M &&
      speed != null && Number.isFinite(speed) && speed >= DRIVING_SPEED_MPS && speed < 75) {
      this.lastReliableMove = timestamp;
    }
    return Number.isFinite(timestamp) && timestamp - this.lastReliableMove <= DRIVING_HOLD_MS &&
      timestamp >= this.lastReliableMove;
  }
  reset() { this.lastReliableMove = -Infinity; }
}
/** Readable context over overscaled buildings / huge signal rings while in motion. */
export function patrolZoom(zoom: number, moving: boolean): number {
  if (!Number.isFinite(zoom)) return PATROL_DRIVE_ZOOM;
  return moving ? Math.min(zoom, PATROL_DRIVE_ZOOM) : Math.min(zoom, MAX_PATROL_ZOOM);
}
/** Smooth across 0/360 rather than rotating the map the long way. */
export function headingStep(previous: number | undefined, next: number | null | undefined, weight = 0.22): number | undefined {
  if (next == null || !Number.isFinite(next) || next < 0 || next >= 360) return previous;
  if (previous == null || !Number.isFinite(previous)) return next;
  const delta = ((next - previous + 540) % 360) - 180;
  return (previous + delta * weight + 360) % 360;
}
