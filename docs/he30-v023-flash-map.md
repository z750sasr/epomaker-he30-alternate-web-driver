# HE30 v0.23 flash map

This map combines the v0.23 build, the pinned donor image, the web updater and the connected keyboard's USB responses. It identifies known uses and ranges that need further verification before they can hold RGB presets.

## Device evidence

On November 22, the connected keyboard answered `H3K23` and firmware version `0x2300`. It reported a valid saved record at sequence 5, no pending settings changes, and no ADC error. After the requested switch to recovery, it enumerated as **HE30 Upgrader**, `19F5:AF22`, release `0x0301`. It was left in recovery.

The first WCH-LinkE v3.7 attempts returned `0x55` with a lead on the wrong probe pin. After the owner corrected the wiring, the probe attached in recovery at 400 kHz and identified a **CH32V305RBT6**, chip ID `0x30500598`, with an ESIG flash size field of **128 KiB** and **read protection enabled**. This agrees with the earlier hardware capture. After the status check halted the MCU, the recovery USB interface disappeared. Probe resume and reset-and-run attempts did not restore USB enumeration. Candidate flash sectors remain unverified. The updater erase, image write and protection commands were not sent. [Earlier hardware investigation](failed-flash-2026-11-19.md)

## Address map

Addresses use the `0x08000000` flash mapping. WCH specifies 128 KiB of zero-wait flash for the CH32V305RB and documents the remainder of the 480 KiB flash capacity as non-zero-wait flash. The upper limit below follows that documentation. This check did not read those addresses out of the target. [WCH datasheet, Table 2-1 and note 1](https://www.jc-net.co.jp/pdf/CH32V307DS0-EN.pdf)

| Address range | Evidence and status |
| --- | --- |
| `0x08000000–0x08004FFF` | Prefix preceding the v0.23 update image. Preserve this region for the existing startup and recovery implementation. |
| `0x08005000–0x0801DFFF` | Fast flash occupied by the application image, including native code, tables and custom code. The build reserves several specific subregions below. |
| `0x0800F900–0x0800FEFF` | Two 768-byte Fn RGB journal slots, starting at `0x0800F900` and `0x0800FC00`. |
| `0x0801A000–0x0801A1FF` | A native writer range kept outside the custom `.extra` section, which starts at `0x0801A200`. |
| `0x0801E000–0x0801FFFF` | Two 4 KiB profile and calibration journal sectors. These are initialized to `0xFF` in the plain release image and receive live settings after a save. |
| `0x08020000–0x0802AFFF` | Slower flash sectors with bytes in the v0.23 image. The file ends at `0x0802ADAF` inclusive. The image portion in slower flash is byte-for-byte identical to the pinned donor. |
| `0x0802B000–0x0803FFFF` | Beyond the supplied image. The inherited application writer accepts addresses in this range. Leave it reserved until the callers and actual board contents are accounted for. |
| `0x08040000–0x08077FFF` | Beyond the supplied image and outside the inherited writer bound found in the donor. This is a candidate range only. Its contents and the OEM bootloader's erase coverage are unverified. |

[Published binary and manifest](../firmware/custom/he30-v0.23/README.md) · [Custom code sections](../firmware/custom/he30-v0.15/link.ld) · [Onboard writes](../firmware/custom/he30-v0.15/profiles.c)

## What the updater can overwrite

The 155,056-byte image begins at `0x08005000` and ends at `0x0802ADB0` exclusive. The web flasher sends offsets and lengths for the write and compare loops, so an ordinary v0.23 full-image update can overwrite the journal and all in-image padding. Its initial erase request carries no start address or length. The browser code therefore establishes the write extent, while the OEM bootloader controls the erase extent. The archive image excludes that bootloader. [Web flash sequence](../flasher/protocol.mjs)

The retained donor writer at execution alias `0x14FE0` bounds a write by its length and destination. The checks at `0x14FF8–0x15034` accept requests inside either `0x0801A000–0x0801A1FF` or `0x08020000–0x0803FFFF`. The shipped application calls inherited code at `0x67B0` to enter recovery. That routine contains an explicit reference to `0x08020100` and calls this writer. This is a concrete retained reference in slower flash, even though the new settings writer uses only the Fn RGB and main journal addresses. The wider address check does not establish that the application writes every sector it accepts. [Pinned donor and application source](../firmware/custom/he30-v0.23/HE30-v0.23-source.zip)

The shipped image contains three consecutive 4 KiB sectors of zero bytes at `0x08024000`, `0x08025000`, and `0x08026000`. Those sectors illustrate why visual padding alone is insufficient. They are inside the full-image update range and the inherited writer's accepted range.

**No additional sector is verified for allocation by this map.** A read-only firmware diagnostic could check a small set of candidate sectors at or above `0x08040000` for existing contents. An updater preservation test on a recoverable unit would separately establish whether those sectors survive recovery and full-image updates.
