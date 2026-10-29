# Play Console Data safety: Wi-Fi scanning (draft, not submitted)

**Data types → Location → Approximate location**: collected: Yes (already declared). Shared: No. Processed ephemerally: No (coarse ~150 m cells may be kept in the on-device session log the user exports). Required/optional: optional (scanning is user-started). Purpose: App functionality.

**Data types → App info and performance / Device or other IDs**: No change. Nearby Wi-Fi network names (SSIDs) and hardware addresses (BSSIDs) are *not collected*: they are read on the device, compared against a fixed list of patterns, and discarded immediately. Only the matched rule ID (e.g. `axon-fleet-ssid`) is kept, on the device.

Suggested "data handling" wording for the store listing / privacy policy:

> Patrol Radar can read the list of nearby Wi-Fi networks that Android already scans for (Android app only). It never connects to or probes any network. Network names and addresses are checked on your phone against a short list of public patterns used by police in-car systems (Axon Fleet, Cradlepoint vehicle routers) and Flock cameras, then discarded. Only the name of the matched rule is kept, with a ~150 m area, and nothing leaves your phone unless you export or share it.

Permissions: ACCESS_WIFI_STATE and CHANGE_WIFI_STATE (normal, granted at install, no prompt; CHANGE_WIFI_STATE is needed only to request a scan). Wi-Fi scan results also require the location permission the app already requests.
