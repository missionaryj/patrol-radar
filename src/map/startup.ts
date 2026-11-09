/** Pick the first viewport once, without storing the user's location. */
export class InitialMapView {
  private settled = false;
  private timer: ReturnType<typeof setTimeout>;
  constructor(private show: (lat: number, lng: number, zoom: number) => void, waitMs = 4000) {
    this.timer = setTimeout(() => this.fallback(), waitMs);
  }
  locate(lat: number, lng: number) { this.finish(lat, lng, 16); }
  // A neutral US overview, not a street-level location that looks like the user's.
  fallback() { this.finish(39, -98, 4); }
  private finish(lat: number, lng: number, zoom: number) {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer);
    this.show(lat, lng, zoom);
  }
}
