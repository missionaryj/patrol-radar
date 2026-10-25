/** Raw advertisement counters, so field tests can distinguish "nothing nearby" from "scanning broken". */
export class ScanStats {
  raw = 0; matched = 0; unmatched = 0; lastAt = 0;
  record(isMatch: boolean, now = Date.now()) { this.raw++; isMatch ? this.matched++ : this.unmatched++; this.lastAt = now; }
  reset() { this.raw = this.matched = this.unmatched = this.lastAt = 0; }
}
