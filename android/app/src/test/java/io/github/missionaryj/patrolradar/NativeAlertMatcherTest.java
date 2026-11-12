package io.github.missionaryj.patrolradar;

import org.junit.Test;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import static org.junit.Assert.*;

public class NativeAlertMatcherTest {
    private static byte[] bytes(String s) { return s.getBytes(StandardCharsets.US_ASCII); }

    @Test public void exactAndReversedBodyCameraTagsMatch() {
        assertNotNull(NativeAlertMatcher.match(null, false, Arrays.asList(bytes("AXJANUSBWCDEVICE"), bytes("noise"))));
        assertNotNull(NativeAlertMatcher.match(null, false, Collections.singletonList(bytes("xxECIVEDCWBzz"))));
        assertNull(NativeAlertMatcher.match(null, false, Collections.singletonList(bytes("BWCDEVI"))));
        assertNull(NativeAlertMatcher.match(null, false, Collections.singletonList(bytes("METROPOLISDEVICE"))));
    }

    @Test public void shapedManufacturerRequiresIndependentAxonService() {
        byte[] serial = bytes("2X870054FW"); serial[0] = 0x02;
        assertTrue(NativeAlertMatcher.serialShape(serial));
        assertNotNull(NativeAlertMatcher.match(serial, true, Collections.emptyList()));
        assertNull(NativeAlertMatcher.match(serial, false, Collections.emptyList()));
        assertNull(NativeAlertMatcher.match(bytes("random-data"), true, Collections.emptyList()));
        byte[] bad = serial.clone(); bad[3] = (byte) 'a';
        assertNull(NativeAlertMatcher.match(bad, true, Collections.emptyList()));
    }

    @Test public void cooldownSuppressesRepeatedOrClusteredNotifications() {
        assertTrue(NativeAlertMatcher.canAlert(100_000L, 0, null));
        assertFalse(NativeAlertMatcher.canAlert(144_999L, 100_000L, null));
        assertFalse(NativeAlertMatcher.canAlert(160_000L, 100_000L, 100_000L));
        assertTrue(NativeAlertMatcher.canAlert(700_000L, 100_000L, 100_000L));
    }
}
