package io.github.missionaryj.patrolradar;

/** Main-thread, aggregate-only native health. No device data or Android dependencies. */
final class ScanHealth {
    long callbacks, lastCallbackAt = -1, retryAt;
    int failures, silentRestarts, failureCode;
    String state = "stopped", reason = "none", result = "none";
    boolean pendingRestart;

    static boolean canStart(java.util.Deque<Long> starts, long now) {
        while (!starts.isEmpty() && now - starts.peekFirst() > 30_000L) starts.pollFirst();
        return starts.size() < 3;
    }
    static boolean filtered(boolean requested, boolean screenOn, int sdk, boolean hasFilters) {
        return hasFilters && (requested || (!screenOn && sdk >= 27));
    }
    void started(String why) {
        state = "starting";
        if (!"initial".equals(why)) {
            reason = why; result = "pending"; pendingRestart = true;
            if ("stall".equals(why) || "periodic".equals(why)) silentRestarts++;
        }
    }
    boolean callback(long now) {
        callbacks++; lastCallbackAt = now;
        boolean recovered = pendingRestart;
        if (recovered) result = "recovered";
        pendingRestart = false; failures = 0; silentRestarts = 0; retryAt = 0;
        state = "receiving";
        return recovered;
    }
    void failed(int code, long now) {
        state = "failed"; failureCode = code; failures++;
        if (pendingRestart) result = "failed";
        pendingRestart = false;
        // Only transient stack/resource/start-frequency errors are retried. Three retries per outage.
        retryAt = (code == 2 || code == 3 || code == 5 || code == 6) && failures <= 3
            ? now + 31_000L * failures : 0;
    }
    boolean retryDue(long now) { return "failed".equals(state) && retryAt > 0 && now >= retryAt; }
    boolean canRestartSilent() { return silentRestarts < 3 && !"failed".equals(state); }
    void stopped() { state = "stopped"; retryAt = 0; pendingRestart = false; }
}
