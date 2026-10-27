# BLE signatures

Rules live in `src/ble/signatures.ts`. Fusion: `1 - Π(1-c)`, ≥0.85 when ≥2 rule kinds agree, ×0.85 below -90 dBm. Android hardware scan filters are generated from the company-ID and 16-bit UUID rules.

SIG = Bluetooth SIG assigned numbers ([company IDs](https://bitbucket.org/bluetooth-SIG/public/src/main/assigned_numbers/company_identifiers/company_identifiers.yaml), [member UUIDs](https://bitbucket.org/bluetooth-SIG/public/src/main/assigned_numbers/uuids/member_uuids.yaml)), checked 2026-10-26.

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
| **Flock battery name** | `^Penguin-\d{10}$` | fixed | [flock-you](https://github.com/colonelpanichacks/flock-you) (firmware-derived) | 0.7 | low | No (new) |
| **Flock battery name** | `FS Ext Battery` | fixed | flock-you | 0.7 | low | No (new) |
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
| Flock Raven GATT services 0x3100–0x3500 | GATT-only (needs connect – not passive), not SIG-assigned |
| Flock WiFi OUIs / probe requests | WiFi, not visible to Web Bluetooth/BLE scan |
| MAC OUI matching | Police gear and most phones use random BLE addresses; Web Bluetooth never exposes the MAC. Our privacy design would allow an in-memory OUI prefix check on Android before hashing (never stored), but no credible BLE OUI list exists, so not added |
| `AB3-`, `Signal` name patterns | no public source; `Signal` matches the messaging app/consumer devices |

## Next field run
- Axon Signal / holster: expect 0x034D or 0x025F at the same scene as body cams.
- Motorola APX/V300: look for 0xFE04/0xFD8E near patrol cars; note any hits at stores/schools (FP).
- Flock: park near a known Champaign Flock pole (see [deflock.me](https://deflock.me)) for 2–3 min; a purple "Fixed" dot means the battery signature still works on current firmware.
