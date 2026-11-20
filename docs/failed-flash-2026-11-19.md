# Epomaker HE30 failed-startup investigation — November 19, 2026

**Subsequent result:** the owner flashed v0.3 and supplied H3B03/H3B1 status at stage 0x30. The reduced USB-only application now runs. This supersedes the earlier current-state statement below; v0.2/v0.2b still failed as recorded. See [v0.3 hardware evidence](../firmware/custom/he30-v0.3/hardware-result.json). The cause of the older failures and the skipped scan/RGB/settings paths remain unresolved.

## Result

The keyboard remains accessible as **19F5:AF22, HE30 Upgrader**, but no custom application has enumerated. The owner's v0.2 flash and one subsequent controlled v0.2b test both returned to recovery. Typing and raw scan diagnostics are unavailable in this state. Further speculative flashes have stopped. The WCH-LinkE is unavailable to the owner at present.

Recovery enumeration means the USB loader is still alive. It does not prove the original application remains recoverable: no valid original Epomaker flash backup was obtained before the custom flash. A power cycle cannot repair a rejected or non-starting application.

## Evidence and controlled test

The supplied native Zuoya updater was inspected statically, not executed. Its host sequence is erase `81`, block writes `80`, comparisons `82`, then `83` and `84`. The implemented order matches. This establishes host ordering only; the Epomaker loader implementation, actual image placement and target acceptance checks are still unknown.

The original v0.2 image is 155,056 bytes, SHA-256 `e918651f5a81bd487bf61566d94a12e4cbc8a93a6e44ac13ddd5d962825f5e70`. The owner's saved log shows all update phases and AF22 returning immediately after finalization. No FD50/H3D02 application was observed.

v0.2b tested whether USB/native identity mismatches alone explained the failure. Relative to v0.2, it changes exactly four bytes:

| File offsets | Before | After | Record |
| --- | --- | --- | --- |
| 0x122CE–0x122CF | 50 FD | 4C FB | USB PID |
| 0x1B002–0x1B003 | 50 FD | 4C FB | Native onboard PID |

The USB product remains `H3D02`; release remains 0x0115. Executable instructions, startup, ADC, RGB and diagnostic hook are unchanged. Its SHA-256 is `baf22420e19d735bcbae7cd19cc77356272131ecf4f8cb985cd2fb1f8441c901`.

The one-shot native-HID harness pinned both hashes, checked all four differences and exact target identity, and used the project's same updater implementation. It sent the full image without retry. There were 9,695 command acknowledgements: one erase, 4,846 write blocks, 4,846 compare blocks and two finalization commands. Update phases ran from 22:10:03 to 22:10:23 UTC. Across 20 subsequent USB inventories, the only observed target was AF22; no H3D02 application appeared. No second test or additional image was flashed.

A separate comparison-only control sent correct, deliberately incorrect, then correct first-block data outside the active update session. All received identical 512-byte zero replies. Consequently generic zero acknowledgements do not independently establish actual flash equality or application acceptance. This control does not establish whether comparison works differently inside an active update session.

## What this does and does not establish

- Changing those two PID records is insufficient to make this donor-derived application start.
- The failure could involve image acceptance, placement/size, persistent boot state, or early startup/peripheral initialization. Present evidence cannot distinguish them.
- The donor's compatible instruction set and similar layout do not prove compatible GPIO, clocks, flash layout or bootloader contract.
- The bounded instruction-model tests validate the diagnostic hook in isolation, not the board, loader or startup.
- No protection removal, option-byte update, probe write, security change or vendor executable launch occurred during this diagnosis.

## Changes to the web driver

- A post-finalization return to AF22 now reports failed/unconfirmed application startup explicitly and never automatically reflashes.
- The firmware page and build notes identify the failed hardware tests.
- The stock configuration codec refuses product `H3D02` even if it uses stock FB4C PID, preventing incompatible settings writes.
- Raw diagnostics accept FB4C/H3D02 in addition to FD50 and still require the `H3D1` diagnostic signature. Stock FB4C is rejected before sending diagnostic requests.
- Ten simulated transport/flow tests and the repository smoke test pass. No successful hardware diagnostic read has occurred.

## Next useful work

When the probe becomes available, inspect the confirmed CH32V305RBT6 in recovery: identification/protection status, CPU state and permitted registers/SRAM. Determine whether the loader refuses to branch or whether the application traps/resets during startup. Establish access limits before attempting any instruction-level stepping or execution changes. Do not remove flash read protection: that can erase flash. Existing read-protected flash output is not a backup.

An exact **Epomaker FB4C** factory recovery image would provide a separate restoration route. Zuoya FD50 and DrunkDeer images are not substitutes. No exact factory image is currently available in the investigation.

Local detailed evidence is retained under `C:\Users\Fat Dogggo\Documents\ChatGPT\AE64 Pro R2\he30-lab\failed-flash-2026-11-19\`: `identity-variant-result.json`, its one-shot harness/marker, comparison controls and native-updater disassembly. The owner's first flash log is `C:\Users\Fat Dogggo\Downloads\he30-flash-2026-11-19T21-56-55-158Z.json`.
