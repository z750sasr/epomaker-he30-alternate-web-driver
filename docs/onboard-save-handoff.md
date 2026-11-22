# HE30 Pro onboard save handoff

## Objective

Restore reliable **Save changes** on the physical Epomaker HE30. A single verified onboard save should retain polling rate, scan mode, RGB and brightness, key mappings, Rapid Trigger, Hall tuning and calibration across power loss. Polling changes should apply immediately without USB re-enumeration. Scan-mode changes already have a dedicated Hall scanner restart. Keep Apply independent of flash programming.

## Diagnostic candidate

[H3K16 / v0.16](../firmware/custom/he30-v0.16/README.md) runs the flash writer and journal encoder from SRAM, verifies each page, and records save progress for a debugger at `0x20007400`. The normal Pro driver keeps its export fallback until a physical save and power-cycle test passes.

The physical H3K16 accepted the 8,000 Hz polling cap and fastest scan mode. It timed out on the explicit onboard Save request. A powered debugger capture recorded stage 3 (mask interrupts), `mcause=2`, `mepc=0x2000713a`, and `mstatus=0x6088`. Exact disassembly at the trap address shows `csrrc s2,mstatus,s2`. Application code runs in user mode, where access to `mstatus` is illegal. The trap occurred before the flash clock change or unlock.

[H3K17 / v0.17](../firmware/custom/he30-v0.17/README.md) corrects a separate flash register ordering bug. It unlocks before exiting enhanced read mode and restores the mode before relocking. H3K16's physical failure occurred earlier, with enhanced read mode off. [WCH reference manual, sections 32.3 and 32.4](https://static.chipdip.ru/lib/820/DOC059820997.pdf)

H3K18 / v0.18 masks and restores interrupts using the QingKe user-mode `GINTENR` register. On the physical HE30 this cleared the freeze. Save returned status 9 and the powered probe capture recorded failed stage 7 (load page buffer), address `0x0801E000`, status `0x21` (`BSY` and `EOP`), and control `0x10000` (`FTPG`). [QingKe V4 manual, section 8.3](https://ch32-riscv-ug.github.io/WCH-common/datasheet_en/QingKeV4_Processor_Manual.PDF)

[H3K19 / v0.19](../firmware/custom/he30-v0.19/README.md) keeps the interrupt and unlock fixes, puts the writer in zero-wait flash, and waits on `WRBSY` between page buffer writes. Erase and program still wait for `BSY` to clear. Read protection remains enabled. [WCH reference manual, sections 32.2 and 32.5.6](https://static.chipdip.ru/lib/820/DOC059820997.pdf)

On the physical HE30, v0.19 acknowledged Save in 321 ms and committed journal sequence 1. After the keyboard was unplugged and reconnected, sequence 1 remained valid and clean, with the 8,000 Hz polling cap and Fastest scanner both active. The firmware reported 8,561 complete scans per second after reconnecting. The driver enables **Save changes** for H3K19. Physical testing covered rate persistence. The compiled firmware tests cover additional profile settings and interrupted-write recovery.

## What was verified on hardware

- The Epomaker HE30 uses the CH32V305RBT6. Confirm the USB product, revision and version response before each physical test. The keyboard may have been reflashed since the previous test.
- A Windows HID test and an Edge test bridged to the physical HID interface successfully switched among 500, 1,000, 4,000 and 8,000 Hz polling caps on v0.15. The scanner continued reporting about 480 complete scans per second in conservative mode. The original 1,000 Hz cap was restored in RAM. These tests read the firmware's active cap, which is separate from measuring the USB report cadence at the host.
- The user's exact failure was `No acknowledgement for command 0x55/0xD0 (operation 8, offset 0).` The trigger was **Save changes**. Typing stopped and USB power cycling restored operation. Startup then reported no valid saved record. v0.13 and v0.14 also timed out on the live save path.
- A v0.14 image with a prebuilt journal record installed through recovery successfully booted and retained an 8,000 Hz cap and fastest scanner mode after unplugging. The board reported about 8,577 complete scans per second. This establishes that recovery can write and the application can read that record.
- The v0.15 model passed journal, interrupted-write, reboot, controller, RGB and scan tests. It models flash and USB peripherals. The physical failure remains unresolved.

## Current driver behavior

[HE30 Pro v0.15](../firmware/custom/he30-v0.15/README.md) and H3K16 through H3K19 expose **Apply polling rate** and **Apply scan mode** separately. In [pro/app.mjs](../pro/app.mjs), `recoverySave` keeps the failing save command out of the normal driver paths on H3K13 through H3K18. The global action becomes **Export profile**, and automatic flash saving is disabled for those versions.

On H3K15 and H3K16, **Remember active rates** stores the active polling cap and scan mode in this browser. The driver reapplies them when it connects to that firmware version. Other profile changes remain active for the current session and can be exported. H3K15's **Install startup rates via recovery** and the local H3K16 startup-rate image use a prebuilt journal with factory profiles. A full flash replaces existing profiles and calibration.

## Firmware investigation

1. Start with `D0` operation 8 in [firmware.c](../firmware/custom/he30-v0.15/firmware.c). It calls `save_settings` in [profiles.c](../firmware/custom/he30-v0.15/profiles.c). That routine releases reports, chooses the inactive 4 KiB settings sector, captures the profile, computes the record CRC, pauses active RGB DMA, and calls `flash_writer`. [persistence.c](../firmware/custom/he30-v0.15/persistence.c) encodes and loads the journal.
2. Locate the first failing stage before changing the save strategy again. Capture progress immediately before and after the release wait, IRQ masking, HCLK change, flash unlock, first erase, first page program, final verification, and clock and IRQ restoration. Record flash status and control registers, the target address, and fault cause and PC where observable. Use a channel that can survive the particular failure being diagnosed, such as RAM breadcrumbs read with a debugger or retained across a controlled warm reset. A full power cycle can erase RAM evidence.
3. Compare the failing stage with [Zuoya V115 evidence](../firmware/custom/he30-v0.15/README.md#zuoya-v115-evidence) and [WCH chapter 32](https://static.chipdip.ru/lib/820/DOC059820997.pdf). The v0.15 writer is at execution address `0x1DE0C` and writes to `0x0801E000` or `0x0801F000`. It masks interrupts, divides HCLK by four, exits enhanced read mode if active, and uses 256-byte fast flash pages. Verify the clock and unlock conditions, executable flash region, erase and program status, and eventual restoration of USB service on this board. The timeout does not identify the instruction that stalled. Earlier attempts using an SRAM writer, a flash-resident writer, and fast page programming all left the physical failure unresolved.
4. Preserve the previous valid sector throughout a new save. Verify the inactive record, write the commit marker last within the hardware's supported programming sequence, and validate the final record before reporting success. Keep journal reads compatible with existing valid profiles. If the save requires a controlled USB pause, have the driver reconnect and verify the saved record. Apply should remain live and independent.

## Proof of completion

- Run `verify.py`, `verify_gamepad.py`, and `verify_settings.py` in the new firmware directory. Run `node --test flasher/*.test.mjs pro/*.test.mjs` and `node smoke-test.cjs` from the repository root. The v0.15 build uses xPack RISC-V GCC 14.2.0 and documents its build command in the firmware README.
- On the physical board, save distinguishable values for polling, scan mode, RGB, a key mapping, Rapid Trigger and Hall settings. Verify calibration retention too. Confirm the save reply and journal readback, completely remove USB power, then reconnect and compare with the applied values. Check that typing and configuration traffic recover after Save and that the preceding valid record still loads after an interrupted write.
- Enable onboard **Save changes** for a new firmware version only after it passes the physical test. Leave the current browser fallback available for affected releases. The prior full-flash authorizations covered specific v0.14 installations. Back up readable settings and obtain authorization before another full flash on the user's keyboard.
