# Data safety form answers
- Does the app collect or share any required user data types? **Yes** (because of the optional crowd map).
- Is all user data encrypted in transit? **Yes** (HTTPS only, mixed content disabled).
- Do you provide a way for users to request data deletion? **Yes**: on-device data is cleared in the app or by uninstall; shared reports auto-delete after ~2 h and are not linked to a person. Point to the privacy policy.

| Data type | Collected | Shared | Ephemeral | Required/optional | Purpose |
|---|---|---|---|---|---|
| Location → Approximate location | Yes | No (sent only to our own API, a service provider) | No (kept ~2 h) | **Optional** (crowd map opt-in) | App functionality |
| Location → Precise location | **No** (used on-device only, never leaves the device → not "collected" under Play definitions) | No | – | – | – |
| Device or other IDs | No (rotating random session token is not tied to the device; declare "No"; if a reviewer objects, declare Device or other IDs, optional, app functionality) | No | – | – | – |
| App activity / App info & performance / Personal info / Financial / Messages / Photos / Audio / Contacts / Calendar / Health / Web history | No | No | – | – | – |

Notes: Bluetooth scan results are processed on device and are not a Play "data type". The hourly-salted IP hash on the server is used only for rate limiting (fraud prevention / security) and is not retained beyond the counter window. Map tiles come from OpenStreetMap, which sees the requester's IP like any website; this is disclosed in the privacy policy.
