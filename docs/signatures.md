# BLE and Wi-Fi signatures

**Code layout (1.0.18):** one module per vendor in `src/signatures/<vendor>.ts` (`axon`, `utility`, `motorola`, `yardarm`, `flock`, `generic`), collected by the registry in `src/signatures/index.ts`. `src/ble/signatures.ts` re-exports it for old imports. To add a vendor, create a module exporting a `Signature[]` and add it to `VENDORS`. Each signature has `id`, `vendor`, `category`, a `rule`, `baseConfidence`, `status` (the existing tiers: `unverified` / `field-validated`), and optional `addedIn` / `changedIn`, `source` and `group`. `matchRule()` returns a reason string, which never contains payload bytes. `tierOf()` derives a display grade: strong ≥ 0.85, likely ≥ 0.5, hint below that. Android hardware filters (company IDs, service UUIDs, OUIs) and the Web Bluetooth picker filters come from the registry. Wi-Fi rules live in `src/wifi/rules.ts` and are mirrored by `WifiWatcher.java`.

**Fusion:** `1 - Π(1-c)`. The result is at least 0.85 when two or more rule kinds agree, and is multiplied by 0.85 below -90 dBm. Signatures that share a `group` are the same evidence, so only the strongest one counts and they never corroborate each other (`axon-cid`/`axon-cid-any`, `axon-fe6b-svcdata`/`taser-fe6b`). `flock-xuntong-cid` never corroborates except with a Flock name.

**Registries re-checked 2026-10-31:** [SIG company IDs](https://bitbucket.org/bluetooth-SIG/public/src/main/assigned_numbers/company_identifiers/company_identifiers.yaml) list 0x034D as "TASER International, Inc.". [SIG member UUIDs](https://bitbucket.org/bluetooth-SIG/public/src/main/assigned_numbers/uuids/member_uuids.yaml) list 0xFE6B and 0xFE6C as "TASER International, Inc." and 0xFC81 as "Axon Enterprise, Inc.". The [IEEE OUI list](https://standards-oui.ieee.org/oui/oui.txt) has 00-25-DF as "Axon Enterprise, Inc.".

**Field evidence sources:**
- [all-cameras-are-beacons](https://github.com/soyboi1312/all-cameras-are-beacons) (ACAB), files `docs/signatures.md` and `docs/axon.md`
- [AXEOFF](https://github.com/colonelpanichacks/axeoff) and [oui-spy-unified-blue](https://github.com/colonelpanichacks/oui-spy-unified-blue)
- [flock-you](https://github.com/colonelpanichacks/flock-you)
- [flock-you-esp32](https://github.com/simeononsecurity/flock-you-esp32)
- [deflock.me](https://deflock.me), which is a map of camera locations, not a signature source. It is useful for planning not-present and Flock test drives.

## Current table (1.0.18)

| id | Rule | Category | Conf. | Grade | Status | Added/changed | Source |
|---|---|---|---|---|---|---|---|
| `bwc-tag` | ASCII `BWCDEVICE` in service or mfr data, either byte order, MAC-independent | body-camera | **0.90** (was 0.85) | strong | unverified | changed 1.0.18 | ACAB: field-validated 2026-07-19 at conf 90. On the wire it is reversed `AXJANUSBWCDEVICE`. No space. |
| `axon-metropolis-tag` | ASCII `METROPOLISDEVICE`, either byte order | body-camera | 0.70 | likely | unverified | **new 1.0.18** | ACAB 2026-10-21: two adverts on 00:25:DF devices, with police confirmed on scene. Product not yet identified. |
| `axon-cid` | CID 0x034D **with payload `0x02` + 9 uppercase A-Z/0-9** (serial shape, checked in memory only) | body-camera | 0.75 (was 0.6) | likely | unverified | changed 1.0.18 | SIG; serial gate from ACAB (2026-10-21). An ungated 0x034D was seen reused on a random address. |
| `axon-cid-any` | CID 0x034D, any payload (fallback, same group) | body-camera | 0.45 | hint | unverified | **new 1.0.18** | SIG; our own Champaign capture (5 devices, payload shape not recorded) |
| `axon-fe6b-svcdata` | Service data under 0xFE6B with ≥ 1 byte | body-camera | 0.75 | likely | unverified | **new 1.0.18** | SIG; ACAB: 7 devices, serial-shaped payloads, owner-confirmed body cam on 2026-10-21 |
| `taser-fe6b` | 0xFE6B in the UUID list or service data | cew | 0.6 | likely | unverified | | SIG (verified); AXEOFF |
| `taser-fe6c` | 0xFE6C | cew | 0.6 | likely | unverified | | SIG (verified); AXEOFF. No public field sighting yet; ACAB keeps it capture-only. |
| `axon-fc81` | 0xFC81 | body-camera | 0.6 | likely | unverified | | SIG (verified); AXEOFF. Our own Champaign capture corroborated it with the CID. |
| `axon-oui-ble` | BLE **public** address starts with 00:25:DF (Android only, checked natively) | body-camera | 0.5 (low weight) | likely | unverified | **new 1.0.18** | IEEE; AXEOFF; ACAB (3 owner-confirmed untagged hits; ACAB uses 75) |
| `axon-oui-wifi` | Wi-Fi BSSID starts with 00:25:DF (Android scan results, checked natively) | body-camera | 0.6 | likely | unverified | **new 1.0.18** | IEEE; AXEOFF (beacons and probes); ACAB Wi-Fi path at conf 65 with 8 field hits |
| `axon-name` | name `^(Axon\|TASER)` | body-camera | 0.5 | likely | unverified | | guess |
| `bwc-name` | name `^BWC` | body-camera | 0.5 | likely | unverified | | guess |
| `utility-bodyworn` | name `BodyWorn Remote` | body-camera | 0.7 | likely | unverified | | ACAB (nite-oui-collection, 2025-08) |
| `yardarm-cid` | CID 0x025F | other (holster) | 0.6 | likely | unverified | | SIG |
| `moto-cid` / `moto-fe04` / `moto-fd8e` | CID 0x04EC, UUIDs 0xFE04, 0xFD8E | radio | 0.35 / 0.4 / 0.4 | hint | unverified | | SIG |
| `flock-*` | Penguin / FS Ext Battery / FS-hex names; Raven 0x3100–0x3500 (exact values); CID 0x09C8 | fixed | 0.3–0.5 | hint/likely | unverified | | flock-you, ACAB, flock-you-esp32 |

### Privacy notes for the new rules
- **Axon serial (0x034D):** checked inside `axonSerialShape()` on the in-memory `DataView` and never returned. The match reason says only "serial shape". The recorder still masks the payload, so the 9-character run shows as `**` in debug exports. A test asserts that the serial text and its hex never appear in an export.
- **BLE OUI:** `ScanService.ouiOf()` compares the address prefix in memory before hashing and forwards only the listed OUI string (`"00:25:DF"`), never the address. Only public addresses count:
  - On API 35+ the address type is read.
  - Below API 35, static (top bits 11) and resolvable (01) random addresses are rejected.
  - A non-resolvable random address (00) cannot be told apart from a public one there. The chance that it matches by accident is 1 in 2^22.
  - With "Police gear only" on, Android hardware filters cannot match a MAC prefix, so a device that shows *only* the OUI is seen only in "All devices" mode.
- **Wi-Fi OUI:** `WifiWatcher.match()` compares the BSSID prefix in memory. Only the rule id, RSSI and a per-session salted hash cross the bridge. The recorder stores the rule id only, with no SSID, BSSID or hash. Android scan results list access points only, so this catches a camera or Fleet hub in AP mode, not client probes.

## Rejected or unconfirmed (1.0.18 research)
| Candidate | Why not added |
|---|---|
| OUI `D8:1F:65` (field-attributed to Axon by ACAB) | The IEEE registry lists the holder as "Private". The attribution comes from one project's captures only. It is likely real and should be re-checked once our own labeled sessions exist. |
| Motorola Solutions OUIs (`4C:CC:34`, `00:04:7D`, `00:18:85`, `00:1F:92`, `10:74:6F`, `B8:E2:8C`, `9C:86:2B`) and WatchGuard `00:1D:96` | These are whole corporate blocks. ACAB measured 0/27 precision for Motorola Wi-Fi OUI hits (airport, 2026-07-23) and turned the rule off by default. |
| Utility Inc. OUIs `00:09:BC` / `00:16:ED` | Weak fallback in ACAB with no confirmed field hits |
| i-PRO, Getac identifiers | Capture-only candidates in ACAB with no confirmed sighting |
| Sierra Wireless AirLink, Cradlepoint routers (as police evidence) | ACAB rejected them because they are on buses, utilities and fleets. We keep `cradlepoint-*` at 0.3 as a weak vehicle hint only. |
| Motorola Solutions SIG IDs as capture-only extras, PCAM | No public field confirmation |
| Flock Wi-Fi probe-request fingerprint | Needs monitor mode, which phones cannot do |

## Field-test labeling and evaluation (1.0.18)
- In the recorder panel, the **Field test** dropdown offers police present, not present, unsure or no label. You can set or change it at any time, during or after the session. It is kept with the session and cleared by Clear.
- Debug export **schema v3** adds two things:
  - `header.fieldLabel` = `{value, setAt, updatedAt, setDuringSession}`
  - `signatureHits` = `[{id, radio, tier, status, baseConfidence, records, devices, bestRuleRecords, maxConfidence}]`
- Devices are still only per-session salted hashes, and cells are 150 m.
- `node scripts/field-eval.mjs <folder> [--json]` reports, per signature and for any signature: the hit rate and miss rate over police-present sessions, the false-positive rate over not-present sessions, and how many sessions fired per label. Older v1/v2 files count as "unlabeled".

## Earlier table (pre-1.0.18, kept for history)
| Signature | Rule | Category | Source | Conf. | FP risk | Field verified |
|---|---|---|---|---|---|---|
| Axon/TASER company ID | CID 0x034D | body-camera | SIG "TASER International" | 0.6 | low | **Yes**: 5 devices, Champaign traffic stop, -91…-97 dBm |
| Axon service UUID | 0xFC81 | body-camera | SIG "Axon Enterprise" | 0.6 | low | **Yes** (same run, corroborated with CID) |
| TASER service UUIDs | 0xFE6B, 0xFE6C | cew | SIG "TASER International" | 0.6 | low | No |
| BWCDEVICE payload tag | ASCII in data | body-camera | RF Sentinel prior art | 0.85 | low | No |
| BodyWorn remote | name `BodyWorn Remote` | body-camera | prior art | 0.7 | low | No |
| Axon / TASER / BWC names | name prefix | body-camera | guess | 0.5 | low-med | No |
| Motorola Solutions CID | CID 0x04EC | radio | SIG | 0.35 | medium (business radios) | No |
| **Yardarm holster sensor** | CID 0x025F | other | SIG "Yardarm Technologies" | 0.6 | low | No (new) |
| **Motorola Solutions UUID** | 0xFE04 | radio | SIG | 0.4 | medium | No (new) |
| **Motorola Solutions UUID** | 0xFD8E | radio | SIG | 0.4 | medium | No (new) |
| **Flock battery name** | `^Penguin-\d{10}$` | fixed | [flock-you](https://github.com/colonelpanichacks/flock-you) (firmware-derived) | 0.5 (was 0.7; unreliable since spring 2026) | low | No (new) |
| **Flock battery name** | `FS Ext Battery` | fixed | flock-you | 0.5 (legacy) | low | No (new) |
| **Flock-type CID** | CID 0x09C8 (XUNTONG) | fixed | flock-you + SIG | 0.3 | medium (generic OEM) | No (new) |

## Rejected
| Candidate | Why |
|---|---|
| Motorola 0x0008, Motorola Mobility 0xFC7C | consumer phones |
| Zebra 0x01F1 / 0xFE79 / 0xFD66 | retail/warehouse scanners & printers everywhere |
| Brother 0x0755 | consumer printers |
| Panasonic 0x003A / 0x0E9B | consumer electronics / car audio |
| WatchGuard, Digital Ally, Getac, L3Harris, Wolfcom, Coban, Kustom, Stalker, Federal Signal, Whelen, Code 3, Havis, Cradlepoint, Sierra Wireless | no SIG company ID or member UUID found; no credible public BLE signature |
| Flock bare 10-digit name, `DfuTarg`, Nordic DFU UUID | too generic |
| Flock WiFi OUIs / probe requests | WiFi, not visible to Web Bluetooth/BLE scan |
| MAC OUI matching | *Superseded in 1.0.18:* Axon 00:25:DF is now matched in memory on Android (see above). |
| `AB3-`, `Signal` name patterns | no public source; `Signal` matches the messaging app/consumer devices |

## Next field run
- Axon Signal / holster: expect 0x034D or 0x025F at the same scene as body cams.
- Motorola APX/V300: look for 0xFE04/0xFD8E near patrol cars; note any hits at stores/schools (FP).
- Flock: park near a known Champaign Flock pole (see [deflock.me](https://deflock.me)) for 2–3 min; a purple "Fixed" dot means the battery signature still works on current firmware.

## Flock update (2026-10-27)

Status: Flock's management WiFi AP was turned off around Dec 2025 and BLE beaconing became unreliable by spring 2026 (flock-you issue #20; [SimeonOnSecurity, 2026-09-10](https://simeononsecurity.com/articles/flock-camera-detection-arms-race-2026/)). The method that works now is **WiFi wildcard probe-request sniffing + Flock OUI list + IE fingerprint** (11/12 known cameras in a DeFlockJoplin field test). It needs monitor mode (ESP32 etc.), so a **phone cannot do it**. Neither Web Bluetooth nor Android apps can see probe requests. A camera on 5 GHz (issue #43, May 2026) is also missed by that method.

Changes:
- Penguin / FS Ext Battery names: 0.7 → 0.5 (legacy).
- Added `^FS-[0-9A-F]{4,}$` name at 0.4 (single 2026-06 field capture, [all-cameras-are-beacons](https://git.xszz.org/soyboi1312/all-cameras-are-beacons/blob/main/docs/signatures.md); `FS-` is a generic white-label prefix).
- Added Flock Raven (gunshot sensor) advertised services 0x3100/0x3200/0x3300/0x3400/0x3500 at 0.5, exact values only. Other values in the unassigned range caused a proven false positive ([flock-you-esp32](https://github.com/simeononsecurity/flock-you-esp32)).
- 0x09C8 stays at 0.3 alone, and 0.85 with a matching name.

Not adopted: OUI/MAC matching (MACs are never read, and component OUIs are noisy), the bare 10-digit name (phone false positive), and generic SIG services (0x180A, 0x1809, 0x1819). Possible future option, Android only: a WiFi scan for a `Flock-<hex>` / `Flock Camera net.` hotspot SSID. Most hotspots are off since Dec 2025.
