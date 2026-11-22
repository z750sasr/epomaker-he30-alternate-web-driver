# HE30 Pro v0.16 save diagnostics

H3K16 is a test build for the onboard Save freeze on H3K13–H3K15. It uses the same two journal sectors and reads the same profile format. The physical H3K16 accepted live rate changes and timed out on the explicit onboard Save request. The Pro driver uses **Export profile** and session-only Apply. **Remember active rates** restores the rates when this browser connects to an H3K16.

The [firmware image](Epomaker-HE30-EXPERIMENTAL-v0.16-Save-Diagnostics.bin) is a local-file option in Recovery & firmware. Its product name, USB ID, size, and SHA-256 are recorded in the [build manifest](manifest.json).

The [8,000 Hz / fastest scan startup image](Epomaker-HE30-EXPERIMENTAL-v0.16-8000Hz-Fastest-Startup.bin) contains the same H3K16 application with a prebuilt, checksum-verified factory journal. Its SHA-256 is `e0f5f05a89b28478b345632fc711e01039f873f3c66c898d992b8690cfcc1df2`. Installing it through recovery replaces the existing profiles and calibration. The fastest mode's measured scan rate varies with device activity.

The flash writer, its status polling, and its journal encoder execute from SRAM. The writer verifies each 256-byte page before proceeding and programs the page containing the commit marker last. It checks the full journal before acknowledging Save. Modeled power loss and page verification errors leave the preceding journal available. The physical freeze has yet to be localized.

## Build and test

From the repository root, run with xPack RISC-V GCC 14.2.0:

```powershell
python firmware/custom/he30-v0.15/build.py --toolchain <toolchain-directory> --save-diagnostics
$env:HE30_BUILD_DIR = (Resolve-Path firmware/custom/he30-v0.16).Path
python firmware/custom/he30-v0.15/verify.py
python firmware/custom/he30-v0.15/verify_gamepad.py
python firmware/custom/he30-v0.15/verify_settings.py
Remove-Item Env:HE30_BUILD_DIR
```

The builder can read the pinned v0.3 donor from Git history or from a copy supplied with `--base`. It verifies the donor SHA-256 before assembling the image. The ordinary v0.15 build still reproduces the H3K15 binary.

## Capture an onboard save

Back up the keyboard before installing the test image. Use one explicit Save request (`D0` operation 8) on H3K16. Confirm the reply, saved sequence, and status before removing power. The physical validation checklist is in the [onboard-save handoff](../../../docs/onboard-save-handoff.md).

If Save stalls, attach or halt the debugger while the keyboard stays powered. Read seven 32-bit words starting at `0x20007400` and capture the PC, `mcause`, `mepc`, and `mtval` if available. The trace words are signature (`0x31533348`), stage, flash page address, flash status snapshot, flash control snapshot, result, and failed stage. For an in-progress stall also read `FLASH_STATR` at `0x4002200C`, `FLASH_CTLR` at `0x40022010`, and `RCC_CFGR0` at `0x40021004` directly. The snapshots are taken on exit from the writer. A power cycle can erase the trace.

| Stage | Recorded before |
| --- | --- |
| 1 | releasing keyboard reports |
| 2 | preparing the writer, choosing the inactive sector, and encoding the profile |
| 3 | masking interrupts |
| 4 | dividing HCLK |
| 5 | unlocking flash and waiting for idle |
| 6 | erasing the current page |
| 7 | loading data into the flash page buffer |
| 8 | committing the page buffer |
| 9 | verifying the page |
| 10 | restoring flash settings, HCLK, and interrupts |
| 11 | returning success after full journal validation |
