package io.github.missionaryj.patrolradar;

import org.junit.Test;
import static org.junit.Assert.*;

public class ScanHealthTest {
    @Test public void startsAreLimitedIncludingExactBoundary() {
        java.util.Deque<Long> starts = new java.util.ArrayDeque<>();
        for (long t : new long[]{0, 10, 20}) { assertTrue(ScanHealth.canStart(starts, t)); starts.addLast(t); }
        assertFalse(ScanHealth.canStart(starts, 30_000));
        assertTrue(ScanHealth.canStart(starts, 30_001));
    }
    @Test public void deferredScreenTransitionsUseLatestModeAndActualFilters() {
        assertFalse(ScanHealth.filtered(false, true, 30, true));
        assertTrue(ScanHealth.filtered(false, false, 30, true));
        // Back on before the start budget becomes available: no stale fallback.
        assertFalse(ScanHealth.filtered(false, true, 30, true));
        assertTrue(ScanHealth.filtered(true, true, 30, true));
        assertFalse(ScanHealth.filtered(false, false, 26, true));
        assertFalse(ScanHealth.filtered(true, false, 30, false));
    }
    @Test public void callbacksNeedNoUiAndConfirmRecoveryOnlyAfterAttempt() {
        ScanHealth h = new ScanHealth();
        h.started("initial");
        assertEquals("starting", h.state);
        assertEquals(-1, h.lastCallbackAt);
        assertFalse(h.callback(100));
        assertEquals(1, h.callbacks);
        h.started("stall");
        assertEquals("pending", h.result);
        assertTrue(h.callback(200));
        assertEquals("recovered", h.result);
        assertEquals("receiving", h.state);
        assertEquals(2, h.callbacks);
        assertFalse(h.callback(300));
    }
    @Test public void failureSixRetriesAreBoundedAndDelayed() {
        ScanHealth h = new ScanHealth();
        h.started("initial");
        long now = 0;
        for (int i = 1; i <= 4; i++) {
            h.failed(6, now);
            assertEquals("failed", h.state);
            assertEquals(6, h.failureCode);
            if (i <= 3) {
                assertFalse(h.retryDue(now + 30_000));
                now = h.retryAt;
                assertTrue(h.retryDue(now));
                h.started("failure");
                assertEquals("pending", h.result);
            } else assertEquals(0, h.retryAt);
        }
        assertEquals("failed", h.result);
    }
    @Test public void permanentErrorsAndStopCancelRetry() {
        for (int code : new int[]{0, 1, 4}) {
            ScanHealth h = new ScanHealth(); h.started("screen"); h.failed(code, 1);
            assertEquals("failed", h.result); assertFalse(h.retryDue(999999));
        }
        ScanHealth h = new ScanHealth(); h.failed(2, 1); h.stopped();
        assertFalse(h.retryDue(999999)); assertEquals("stopped", h.state);
    }
    @Test public void silenceBudgetCoversPeriodicAndStallAndResetsOnlyOnCallback() {
        ScanHealth h = new ScanHealth(); h.started("initial");
        for (int i = 0; i < 3; i++) { assertTrue(h.canRestartSilent()); h.started(i == 0 ? "periodic" : "stall"); }
        assertFalse(h.canRestartSilent());
        h.started("screen"); assertFalse(h.canRestartSilent());
        h.callback(42); assertTrue(h.canRestartSilent()); assertEquals(0, h.failures);
    }
}
