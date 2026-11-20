# HE30 v0.3 — USB startup diagnostic

**Hardware result, November 19:** the owner flashed v0.3 and supplied an **H3B03 / H3B1** response at **stage 0x30**, with 234,808,716 loop iterations, 8 processed requests and no recorded exception. Basic custom-application startup and the diagnostic USB loop now work in this test. See [the retained capture and evidence limits](hardware-result.json). Scanning, RGB, calibration and recovery entry remain unvalidated.

**Purpose:** isolate the failure that left v0.2/v0.2b in HE30 Upgrader. This remains a diagnostic experiment, not a usable keyboard firmware or a proven full repair.

Image: `Epomaker-HE30-EXPERIMENTAL-v0.3-USB-startup.bin`, **155,056 bytes**.

SHA-256: `efaad04ebbed9a32d9d11545f182338e29a5ed6d41fa89c95dd4e8c0ca55103f`.

The binary and its build/verification manifests are unchanged by this result update. Their offline-build provenance describes the build operation; `hardware-result.json` separately records the subsequent owner-performed flash and USB test.

Application identity defined by this image: **19F5:FB4C**, product **H3B03**, USB release and version reply **0x0300**. The owner's status capture confirms product H3B03, signature H3B1 and diagnostic-loop stage. That capture does not independently attest every image byte or the USB descriptor/version fields.

## What changed and why

The previous build kept the donor's entire startup. Its main routine initializes scan-related GPIO/ADC, timers and settings before enabling USB. A failure there could prevent the diagnostic endpoint from ever becoming available. v0.3 replaces that main routine with a USB-only loop, retaining the supplied Zuoya V115 USBHS implementation and clock configuration. It does not start the scan, RGB, key-reporting, calibration or persistent-settings initialization paths. No key mappings or calibration tables are patched.

The reset entry first initializes a 64-byte record at **RAM 0x20004000**, outside the donor's statically established data/BSS range and below its initial stack at 0x20008000. It records a signature, startup stage and reset flags before returning to the donor's reset initialization. The location is a static allocation choice; it is not physical RAM validation.

The existing SystemInit call is wrapped with before/after stage markers. Two previously indefinite waits—PLL ready and clock-source selection—now have a limit of 1,000,000 iterations. Their original clock selection and register masks are retained. A timeout records its own stage and parks; it does not select an unverified fallback clock.

NMI and HardFault vector entries now record machine cause, exception PC, machine status and the preceding stage, then park. The USBHS interrupt vector is unchanged. The generated additions use standard RV32I instructions; the inherited donor routines retain their original WCH instructions.

The full donor file length and storage layout are retained. There is no assumed fix for flash capacity, image placement, loader validation or a persistent recovery flag. Arbitrary truncation would introduce another unverified change.

## Diagnostic command and limits

The dedicated command is **55/DC**, not v0.2's raw ADC command. It reads a bounded 64-byte status record, at most 56 bytes per request, with checked offset/length and a response checksum. The status contains stage, loop/request counters, reset flags, clock registers, USB control, reported core clock and exception fields. It does not accept arbitrary memory addresses or status writes.

Startup and status reads do not write flash. The main loop uploads only vendor endpoint 2 reports; it never sends keyboard, mouse or consumer input reports.

There is one explicit flash-writing exception: the exact existing 64-byte recovery packet, prefix **5F 06 00 52 01 00 00 00 51**, followed by zeros, calls the donor's unchanged boot-flag writer/reset routine at 0x67B0. That inherited routine accesses configuration/boot-flag storage around execution aliases 0x20100 and 0x1A100. **Recovery entry from this build remains unverified on Epomaker.** It is not used by the startup status page. Other settings/calibration/write commands and any mutated recovery packet are rejected. If the donor routine returns instead of resetting, the diagnostic records stage 0xE4 and restores its call frame before replying with failure.

No unprotect, option-byte, ROM/RAM-split or security configuration operation was added.

## Test procedure

1. Open the project's `/flasher/` page. Choose **Load v0.3 startup diagnostic**. Confirm the file, length and hash above, select the experimental-image option, then use the existing review/flash flow. This build task has prepared the file only; it has not initiated that update.
2. Observe the re-enumerated device. A successful loader acknowledgement alone is insufficient. The desired application is **FB4C / H3B03**. It may need fresh browser authorization.
3. If that application appears, close the flasher's connection/tab, open **`/flasher/startup.html`**, and connect H3B03. The page first checks the H3B1 signature, then reads status. Read again and save the report. Stage **0x30** and an increasing loop counter establish that this diagnostic USB loop is responding. The counter is iterations, not time or scan/polling rate.
4. If only **AF22 / HE30 Upgrader** returns, save the update log and stop repeating the same image. That outcome still does not distinguish loader rejection from a failure before USB. Later probe inspection can look for the SRAM signature/stage, subject to actual reset retention and debug access. Absence of a signature is not proof of loader rejection: a reset/power cycle or unexecuted/inaccessible RAM can erase or hide it.
5. If USB enumerates but status fails, preserve the exact identity, version and error. Enumeration proves less than a valid diagnostic response.

This build intentionally cannot type, provide raw Hall values, calibrate switches or light the keys. A successful startup test would justify adding one subsystem at a time in later builds. The original Epomaker image has not been extracted; this is not a factory restoration image.

## RAM record

All multibyte fields are little-endian. A status read is not an atomic hardware-wide snapshot; the firmware loop can progress between separate host requests.

| Offset | Size | Meaning |
| --- | --- | --- |
| 0 | 4 | H3B1 |
| 4 | 1 | Format version 1 |
| 5 | 1 | Current stage |
| 6 | 1 | Flags 0x0F: diagnostic/retained clock/scan off/RGB off |
| 7 | 1 | Last received command byte |
| 8 | 4 | Loop iterations |
| 12 | 4 | Accepted-for-processing request count, including rejected commands |
| 16 | 4 | RCC reset flags sampled at reset trampoline |
| 20 | 4 | RCC clock-control register at last status read |
| 24 | 4 | RCC clock-configuration register at last status read |
| 28 | 4 | USBHS control word at last status read |
| 32 | 4 | Donor SystemCoreClock variable |
| 36 | 4 | Exception mcause, zero unless captured |
| 40 | 4 | Exception mepc, zero unless captured |
| 44 | 4 | Exception mstatus, zero unless captured |
| 48 | 4 | Stage immediately before exception |
| 52 | 12 | Reserved zeros |

| Stage | Meaning |
| --- | --- |
| 0x01 | Reset breadcrumb written |
| 0x02 / 0x03 | Before / after donor SystemInit |
| 0x10 | Diagnostic main entered |
| 0x11 | Clock-variable and delay-factor setup returned |
| 0x12 | USB clock setup returned |
| 0x13 | USB enable returned |
| 0x30 | Diagnostic loop running |
| 0x40 | Exact recovery request accepted |
| 0xE0 | Exception captured; parked |
| 0xE2 / 0xE3 | PLL-ready / clock-selection wait timed out; parked |
| 0xE4 | Donor recovery routine returned unexpectedly |

## Rebuild and verification

Run `python build.py` and `python verify.py` in this directory. The build pins donor SHA-256 `535cf2b0d2ff5f6e696da48659bbb249a2d7dd74df243eb5ee69baa2efe368d5`, checks patch preconditions and limits differences to the manifest's ranges. Generated code occupies 1,872 bytes in the donor's checked zero padding at file 0x14000 / execution alias 0x19000.

The verifier executes the actual generated instruction bytes, checks valid/invalid status windows, reply clearing/checksums, ABI/stack preservation, recovery matching, startup/exception records and both ready/timeout branches. Native callees are explicit stubs. It emits reply fixtures consumed by the web protocol tests, linking those tests to the generated firmware's response format. None of these tests validates the physical MCU, donor USB/clock compatibility, flash writer or bootloader acceptance.

## Source boundary

Base firmware remains the resource extracted from the user-supplied `HE30_FIRMWARE_DKS_20250707.exe`, not a newly identified Epomaker image.

The [live Zuoya page script](https://zuoya.keybord.net.cn/_next/static/chunks/app/page-baa36ee09bbadde6.js), retrieved November 19, targets **19F5:A020 / 8F0F / 8A19**, not this reference's FD50 or the Epomaker's FB4C. Its host updater uses erase 0x81, write 0x80, compare 0x82, end 0x83 and success 0x84; its referenced `/update_HE30.bin` returned HTTP 404 during this check. Shared commands do not establish identical firmware or PCB compatibility.

The bounded downloaded-source inventory, hashes and disassembly windows are retained in the workspace under `he30-lab/startup-diagnostic-2026-11-19/`. Previous failed tests are documented in [the failure report](../../../docs/failed-flash-2026-11-19.md).
