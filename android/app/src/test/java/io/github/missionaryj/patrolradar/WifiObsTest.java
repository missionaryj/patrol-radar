package io.github.missionaryj.patrolradar;

import org.junit.Test;
import static org.junit.Assert.*;

public class WifiObsTest {
    @Test public void cacheIsOnlyAResultFromBeforeThisWatcher() {
        assertFalse(WifiObs.cached(0, 1_000));
        assertFalse(WifiObs.cached(5_000, 0));
        assertTrue(WifiObs.cached(1_000, 5_000));
        assertFalse(WifiObs.cached(5_000, 5_000));
        assertFalse(WifiObs.cached(6_000, 5_000));
    }

    @Test public void sessionHashAcceptsNativeShapeAndRejectsMacsAndRuleIds() {
        assertTrue(WifiObs.sessionHash("n0123456789abcdef"));
        assertFalse(WifiObs.sessionHash("00:25:DF:11:22:33"));
        assertFalse(WifiObs.sessionHash("00-25-DF-11-22-33"));
        assertFalse(WifiObs.sessionHash("axon-oui-wifi"));
        assertFalse(WifiObs.sessionHash("Axon-5g"));
        assertFalse(WifiObs.sessionHash("n0123456789abcde")); // 15 hex chars
        assertFalse(WifiObs.sessionHash("n0123456789abcdef0")); // 17
        assertFalse(WifiObs.sessionHash("N0123456789abcdef"));
        assertFalse(WifiObs.sessionHash(null));
    }
}
