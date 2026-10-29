/** Follow-me state: recenter on each fix while following; a manual pan pauses until the user taps recenter. */
export class FollowController {
  following: boolean;
  constructor(initial = true, private onChange?: (following: boolean) => void) { this.following = initial; }
  /** Returns true when the map should recenter on this fix. */
  onFix(): boolean { return this.following; }
  userPanned() { if (this.following) { this.following = false; this.onChange?.(false); } }
  resume() { if (!this.following) { this.following = true; this.onChange?.(true); } }
  set(on: boolean) { on ? this.resume() : this.userPanned(); }
}
