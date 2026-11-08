package io.github.missionaryj.patrolradar;

/**
 * Pure Wi-Fi observation checks. No Android types, so unit tests can run on the JVM.
 * A cached scan result is one whose timestamp (microseconds since boot) is older than this watcher start.
 * The session hash shape matches ScanService.hash: "n" plus 16 lowercase hex chars. A MAC is not a hash.
 */
final class WifiObs {
    private WifiObs() {}

    static boolean cached(long resultTimestampUs, long watchStartElapsedUs) {
        return resultTimestampUs > 0 && watchStartElapsedUs > 0 && resultTimestampUs < watchStartElapsedUs;
    }

    static boolean sessionHash(String id) {
        return id != null && id.matches("n[0-9a-f]{16}");
    }
}
