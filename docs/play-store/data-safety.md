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

## City chat additions (v1.0.16)
Overview answers stay **Yes / Yes (encrypted in transit) / Yes (deletion)**. Add these data types:

| Data type | Collected | Shared | Ephemeral | Required/optional | Purposes |
|---|---|---|---|---|---|
| Messages → **Other in-app messages** | **Yes** | No (Supabase is a service provider) | No (kept 24 h; reported ones up to 7 days) | **Optional** (chat is opt-in) | App functionality; Fraud prevention, security & compliance (moderation) |
| App info & performance / App activity → **Other user-generated content** | No (messages already declared above) | – | – | – | – |
| Device or other IDs | **Yes** – the anonymous Supabase account ID | No | No | Optional | App functionality; Fraud prevention, security & compliance (rate limits, bans) |
| Personal info (name, email, phone, address, user IDs tied to identity) | No | – | – | – | – |
| Location (approximate) for chat | No (only a city room name like US-IL-champaign is sent; Play counts it under the existing Approximate location answer at most – keep that answer as is) | – | – | – | – |

- Is data processed ephemerally? **No** for messages (stored up to 24 h).
- Encrypted in transit: **Yes** (HTTPS/WSS to supabase.co).
- Users can request deletion: **Yes** – Delete button on their own messages, automatic 24 h deletion, and account deletion on request via percolatorbiz@gmail.com or GitHub issues. Link: https://missionaryj.github.io/patrol-radar/privacy/
- Messages are "linked" to the user only through the anonymous account ID; in the Play form, answer the data as collected and note it is not linked to identity (no sign-up, no personal info).
- Also complete **App content → User-generated content**: users can report messages and users and block users, terms must be accepted before posting, reports are acted on by a moderator.
