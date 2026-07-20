# Factory profile and onboard-storage findings

## Factory profile schema

`src/factory_config.json` is a Profile 1 configuration template rather than a complete dump of every device setting.

| Field | Shape | Meaning |
| --- | --- | --- |
| `userKeys` | Layers `0`–`3`, 128 entries each | Four mapping banks. Each mapping carries the firmware `type`, `code1`, and `code2` triplet plus display metadata. |
| `travelKeys` | 128 records | Hall-effect actuation, Rapid Trigger, precision, and dead-zone values. |
| `advancedKeys` | Empty array | The factory template has no DKS, Mod-Tap, Toggle, SOCD, Rappy Snappy, combination, or macro actions. Restoring it clears those banks. |
| `light` | Object | Main-key lighting effect, brightness, speed, direction, and color options. |
| `logoLight` | Object | Light-strip effect, brightness, speed, and color options. |
| `colorKeys` | Empty array | No factory per-key RGB bank is supplied. The reset flow preserves the bank already on the target profile. |
| `active`, `name` | Scalar metadata | Backup metadata; neither is an arbitrary flash payload. |

The file does not include `deviceSettings` or the raw 64-byte profile configuration. The reset flow therefore reads each target profile first, preserves its performance/OS/lock settings and per-key color bank, overlays the supplied factory data, writes only the supplied sections, and verifies every write by reading it back.

Profile 1 uses global layer targets `0`–`3`. When the template is applied elsewhere, Fn targets are translated as follows:

| Factory target | Profile 1 | Profile 2 | Profile 3 |
| --- | ---: | ---: | ---: |
| FN / local layer 0 | 0 | 4 | 8 |
| FN1 / local layer 1 | 1 | 5 | 9 |
| FN2 / local layer 2 | 2 | 6 | 10 |
| FN3 / local layer 3 | 3 | 7 | 11 |

## Fn1 special mappings

- Fn1 + Space is special mapping `type 240, code1 87, code2 0`. The observed firmware behavior opens Windows Run, types the original EPOMAKER driver URL, and presses Enter. The alternate driver labels it **Open EPOMAKER web driver**.
- Fn1 + Escape is special mapping `type 240, code1 8, code2 0`. The HE30 manual identifies Fn + Escape as **restore factory settings (hold 3 seconds)**. It is a destructive internal firmware shortcut rather than a normal host HID key, so the alternate driver labels it **Factory reset (hold 3s)**.

Both actions are available in the alternate driver's **Keyboard functions** bind list.

## Logical onboard-storage map

These are command-specific address spaces inferred from the original web driver and the working protocol implementation. They are not physical MCU flash addresses.

| Logical region | Size/stride | Notes |
| --- | ---: | --- |
| Profile configuration | 64 bytes/profile | Device settings plus main and strip lighting. |
| Current key mappings | 512 bytes/layer | Only 384 bytes are decoded as 128 three-byte mappings. The remaining 128-byte tail is reserved/unknown. |
| Default key mappings | 512 bytes/layer | Separate read command used for factory/default mappings; not user storage. |
| Hall settings | 1,024 bytes/profile | 128 eight-byte records. Fully owned by the Hall parser. |
| DKS | 1,024 bytes/profile | Advanced-action data. Parser-owned. |
| Mod-Tap/pair actions | 256 bytes/profile | Advanced-action data. Parser-owned. |
| Toggle | 128 bytes/profile | Advanced-action data. Parser-owned. |
| Macros | 2,048 bytes/profile | Macro records; unused records are still owned and rewritten by the macro format. |
| Per-key RGB | 512 bytes/profile | Only 384 bytes are decoded as 128 RGB triples. The remaining 128-byte tail is reserved/unknown. |

## Free-space conclusion

No region is currently proven safe for arbitrary user data.

The 128-byte tails in each mapping-layer stride and per-key RGB stride are readable candidates for investigation, but alignment, checksums, future firmware fields, or internal firmware use could explain them. Unused macro or advanced-action records are not free space because normal edits rewrite their entire banks. The default-mapping bank is factory data and must not be repurposed.

The safe next step is read-only: capture the full 512-byte mapping and RGB strides from all profiles, compare the tails before and after ordinary edits, reset, power cycles, profile changes, and firmware updates, and confirm whether the values are stable. Writing test bytes should wait until those comparisons establish a candidate region and a recovery procedure exists.
