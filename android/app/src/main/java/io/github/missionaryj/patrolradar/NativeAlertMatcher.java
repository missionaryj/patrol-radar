package io.github.missionaryj.patrolradar;

import java.nio.charset.StandardCharsets;

/**
 * Deliberately narrow native fallback while the WebView is suspended.
 * Mirrors the strongest supported Axon evidence in src/signatures/axon.ts:
 * BWCDEVICE in either byte order, or shaped Axon manufacturer data plus an Axon service UUID.
 * Does not treat a bare company ID, name or OUI as a police detection.
 */
final class NativeAlertMatcher {
    private static final byte[] TAG = "BWCDEVICE".getBytes(StandardCharsets.US_ASCII);
    private static final String LABEL = "Possible Axon body camera nearby";

    static String match(byte[] axonManufacturer, boolean axonService, Iterable<byte[]> data) {
        for (byte[] payload : data) if (containsTag(payload)) return LABEL;
        return axonService && serialShape(axonManufacturer) ? LABEL : null;
    }

    static boolean serialShape(byte[] data) {
        if (data == null || data.length != 10 || data[0] != 0x02) return false;
        for (int i = 1; i < 10; i++) {
            int b = data[i] & 0xff;
            if (!(b >= '0' && b <= '9' || b >= 'A' && b <= 'Z')) return false;
        }
        return true;
    }

    static boolean containsTag(byte[] payload) {
        if (payload == null || payload.length < TAG.length) return false;
        for (int i = 0; i <= payload.length - TAG.length; i++) {
            boolean forward = true, backward = true;
            for (int j = 0; j < TAG.length; j++) {
                if (payload[i + j] != TAG[j]) forward = false;
                if (payload[i + j] != TAG[TAG.length - 1 - j]) backward = false;
            }
            if (forward || backward) return true;
        }
        return false;
    }

    /** Pure cooldown rule for independently issued background notifications. */
    static boolean canAlert(long now, long lastGlobal, Long lastDevice) {
        return now - lastGlobal >= 45_000L && (lastDevice == null || now - lastDevice >= 600_000L);
    }
}
