# HE30 recovery and firmware page

Use **Load v0.15 HE30 Pro** for the [current experimental firmware](../firmware/custom/he30-v0.15/README.md). After H3K15 reconnects, open [HE30 Pro](../pro/). Leave all keys released at startup so the firmware can learn the idle positions. A full image clears onboard settings. Export profiles you want to keep and restore them from **My Profiles** after updating.

To install startup rates via recovery, select the polling and scan rates before choosing **Load v0.15 HE30 Pro**, then review and flash. The flasher verifies the original image, adds a factory settings record, and displays the hash of the resulting image. Current profiles and calibration are replaced.

If the firmware version query (0x55/0x03) times out, select **Enter recovery only** or **Connect & enter recovery**. When AF22 appears, authorize it if needed and review the retained image. Use **Check connected devices** to repeat application verification after reconnecting.

**Latest build (November20,2026):** [v0.6 RGB foundation](../firmware/custom/he30-v0.6/README.md) supersedes the v0.5-current notes below. The load button now selects H3K06/0600. Confirmed hardware:PB15 to36 key LEDs in `wiring.json` order, PB5 to5 bar LEDs. New nonblocking SPI/DMA lighting includes solid/per-key/reactive keys, independent bar, LED identification and persisted colors. Dim key lighting starts on boot, bar defaults off. `/flasher/keyboard.html` accepts H3K05/H3K06 and shows RGB controls only for H3K06.30 browser tests, compiled-instruction/model checks and smoke pass; no v0.6 physical result or flash in development. Export key and lighting profiles before reflashing:the full image clears journal pages. Electrical protocol/timing/colors remain unverified despite confirmed wiring.

**Sensor-page automation:** connecting H3M04 on `/flasher/hardware.html` now runs passive ADC, starts banked sampling and takes a five-frame released baseline automatically. The guided sequence records each prompted physical key on press/release without assignment clicks. It saves/restores results in browser storage. Errors and disconnects stop automation; RGB remains manual. This is a browser-only change using the same v0.4 firmware.

**Current build (November 19, 2026):** [v0.5 keyboard foundation](../firmware/custom/he30-v0.5/README.md) uses the owner's confirmed analog matrix and PB10/PC13/PC14 group controls. The custom-load button selects v0.5. After flashing, open `/flasher/keyboard.html`, connect H3K05, calibrate all36 keys, finish with keys released, enable typing and explicitly save. It adds keyboard input, momentary Fn, normalized actuation/Rapid Trigger/dead zones and a two-page settings journal. RGB remains disabled. v0.5 has compiled-instruction/model and browser tests, but has not been flashed or physically validated in this work. Polarity/settling, real flash behavior and recovery entry remain unvalidated. The owner's v0.3 H3B03/H3B1 stage0x30 capture remains the demonstrated custom USB baseline. v0.2/v0.2b failed startup; [their investigation](failed-flash-2026-11-19.md) is retained.

Open `flasher/` on HTTPS or localhost in desktop Chrome/Edge. This page is separate from profile editing and uses no application configuration writes. Close other keyboard-driver tabs before connecting.

**Connection/recovery button fix (November20,2026):** discovery and the device picker now require the configuration/recovery report shape, rather than counting every interface sharing the keyboard's USB ID. A composite H3K05 can expose keyboard/media entries alongside its configuration interface; those input entries no longer prevent automatic connection. Distinct configuration-capable keyboards remain a deliberate selection. When disconnected, **Connect & enter recovery** opens the application-interface picker and sends recovery only after the selected keyboard connects successfully. It does not require a firmware image, experimental-image checkbox or flash approval, and cannot erase/write/finalize. Cancelling the picker sends nothing. Once connected, the label becomes **Enter recovery only**; in AF22 it shows **Already in recovery** and is disabled.36 browser tests plus smoke passed; no real recovery command or firmware flash was sent while applying this page-only fix.

## Workflow

1. Connect the Epomaker HE30 (`19F5:FB4C`) or its recovery interface (`19F5:AF22`). The optional FD50 application filter is for an Epomaker already running an experimental Zuoya-derived image.
2. Select an extracted raw `.bin`. The page displays its size, SHA-256, image convention and embedded USB identity. `.exe` updaters are not firmware payloads and are rejected.
3. For a donor/unrecognized image, explicitly select the experimental-image option. Review the exact file/hash and target, then choose Flash this image.
4. In normal mode the page requests recovery and retains the image. The approved flash can continue automatically after the application disconnects and an authorized AF22 updater appears. If Chrome asks for access, select **Authorize recovery device** within one minute to continue. If either USB event is missing or the wait expires, review the retained image again with AF22 selected.
5. The page erases, writes, requests comparison, finalizes, and waits for application enumeration. It reports identity/version confirmation separately from device comparison. Test typing and physical calibration afterward.

**Enter recovery only** sends the observed boot-entry command without starting an update. The HE30 lab capture recorded one 64-byte output report on the FB4C configuration interface, followed by the FB4C disconnect and AF22 enumeration. The browser keeps watching for AF22 if the USB reset interrupts the report transfer. To leave standalone recovery, unplug USB for three seconds and reconnect. Remove probe connections as well for a complete power cycle.

## OEM sequence and sources

The native Zuoya/VTER updater family and inspected Epomaker/DrunkDeer host implementations use the same ordered update operations:

| Operation | Payload before report padding |
| --- | --- |
| Normal version | `55 03 00 20 20` |
| Normal to recovery | `5F 06 00 52 01 00 00 00 51` |
| Erase for Epomaker recovery | `81 07 F5 19 22 AF 00` |
| Write | `80 length offsetLE32 data`, maximum32 data bytes |
| Compare | `82 length offsetLE32 expectedData`, maximum32 data bytes |
| End | `83 01 00 00 00` |
| Finish | `84 01 00 00 00` |

Report ID0 is passed separately to WebHID. Output length is read from the selected HID descriptor: the observed HE30 application uses64 bytes, recovery may use512 bytes. Each report is zero-padded to that declared length. The boot interface must be vendor pageFF00/usage1; normal configuration is page1/usage0.

Native updater evidence checks two zero status bytes. The page accepts that status and rejects nonzero/empty replies; it does not copy the weaker generic host behavior that treats an AA header as sufficient. These status rules still require a complete live validation on this HE30 bootloader. A timeout/error stops immediately with no automatic erase/write retry. Finalization is sequential, rather than overlapping `endRom()` and `succRom()`.

Sources: [Epomaker OEM bundle](https://epomaker.keybord.net.cn/_next/static/chunks/app/page-b76fdf994b403df1.js), [DrunkDeer OEM bundle](https://drunkdeer.keybord.net.cn/_next/static/chunks/app/page-52b5fcb1a59083bb.js), and offline inspection of the supplied native Zuoya/VTER updaters. The implementation is an adaptation of their protocol, not vendor source code or a vendor-approved flasher.

## Boundaries

- Only recovery `19F5:AF22` receives erase/write commands. This is not a generic Zuoya or DrunkDeer flasher.
- The file size limit512KiB and RISC-V/USB descriptor checks are transport/format checks, not proof of installed flash capacity or image compatibility. Known ARM-vector images, padding-only files and non-word-aligned images are rejected.
- The user may deliberately select experimental/cross-model raw images. No physical GPIO/ADC/RGB compatibility, bootloader boundary, signature/checksum acceptance or restore path is inferred from a matching USB ID.
- The compare operation sends expected bytes to the device and receives status. It is not an independent flash readout or firmware backup. A previous bounded one-byte comparison experiment did not establish comparison semantics; this page requires word-aligned images and does not claim hardware verification from offline tests.
- No unprotect, option-byte, MCU ROM/RAM split or debug-probe command exists in this page. A vendor erase operation is still destructive to whichever region the loader implements; its exact boundaries remain unverified.
- If the image is incompatible, typing and USB configuration can stop. Clearing MCU read protection can erase the original main-flash application. The page has not backed it up.
- The new `HE30_FIRMWARE_DKS_20250707.exe` contains a155,056-byte FD50 image with release0115; it is not established as an Epomaker factory image. Extract it offline before selection; do not send the EXE.

The selected bytes and last stage are cached in IndexedDB when available. Reload restores the file and recomputes its hash, but never automatically restarts an erase or resumes a partial write. Review again to restart the whole sequence. After a failure reconnect deliberately; the old transport is closed to discard late responses. Save the session log before retrying.

## Validation

Run `node --test flasher/*.test.mjs` and `node smoke-test.cjs`. Tests use simulated HID devices to check exact packets,512-byte padding, block boundaries, strict status handling, failure stops and final-disconnect races. A simulated page flow checks that approving in application mode retains the image through disconnect, waits for recovery permission, flashes exactly once and ignores duplicate reconnect events. These checks do not establish that a real firmware flash is successful. No live erase/write is part of development validation.

The supplied updater's extracted reference image and provenance are in `firmware/reference/`. Its SHA-256 is `535cf2b0d2ff5f6e696da48659bbb249a2d7dd74df243eb5ee69baa2efe368d5`. Static strings identify build July7,2025; USB release0115. The updater executable was not run.

## Custom startup and scan experiments

`firmware/custom/he30-v0.5/` contains the current functional experiment. **Load v0.5 keyboard foundation** stages its hash-checked image without approving a flash. `/flasher/keyboard.html` is the dedicated settings/calibration page; it checks H3K1 before operations. Full procedure, confirmed matrix and evidence limits are in its README. Stock settings codecs are incompatible and blocked for H3K05.

`firmware/custom/he30-v0.4/` retains the earlier mapping/RGB experiment. Select its downloaded image manually if needed. `/flasher/hardware.html` provides passive ADC, three-bank capture, local physical labels and two dim SPI/DMA RGB hypotheses for H3M04 only. It saves a report and never sends stock calibration/settings writes. Hardware tests do not run at firmware boot. Do not use this page with H3K05.

`firmware/custom/he30-v0.3/` retains the demonstrated USB-only baseline. `/flasher/startup.html` accepts H3B03 or H3M04 and attests H3B1 before reading stages/counters. Native recovery entry remains unverified and explicitly invokes a donor flash-writing routine; diagnostic reads never call it.

`firmware/custom/he30-v0.2/` retains the earlier raw-scan build and its verification. v0.2 and v0.2b both returned to AF22 in physical tests. `/flasher/diagnostics.html` remains available for that H3D02/H3D1 endpoint, but no successful hardware raw-scan read has occurred. v0.3 does not expose that endpoint.
