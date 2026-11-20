# Experimental Epomaker HE30 v0.2

**Hardware result, November 19, 2026: does not start on the tested Epomaker HE30.** Both v0.2 and the four-byte FB4C identity variant v0.2b return to recovery **19F5:AF22** after finalization. Do not repeat these images as a recovery fix. The raw diagnostics application has never enumerated on this target. See [investigation report](../../../docs/failed-flash-2026-11-19.md). The first-test instructions below describe the intended workflow, not a demonstrated successful startup.

Base: the supplied `HE30_FIRMWARE_DKS_20250707.exe`'s Zuoya FD50 V115 resource. This is a first hardware bring-up image, not a validated factory replacement. No target was flashed while building it.

## What changed

- Grave and F1–F6 assigned to logical slots29–35 in seven main/default mapping banks. Profile-specific Fn assignments remain intact.
- USB product string is **H3D02**, so the experimental application is recognizable.
- New read-only vendor subcommand **55/DB** exposes an80-byte bounded logical region:8-byte H3D1 header, followed by36 unsigned little-endian ADC words.
- A160-byte hook is placed in donor padding at file0x14000 / inferred execution alias0x19000. The previously default DB dispatch entry now points there. It rejoins the existing OEM reply/checksum path at0x7634.
- The raw ADC address is **0x200032CC**, from V115's DMA configuration. The V110 buffer address was different and was not reused.

The output is155,056bytes and differs from the donor at195 byte positions. `manifest.json` records every patch and the full SHA-256.

## What remains donor behavior

USB ID **19F5:FD50** and release0115; clocks, GPIO/ADC/DMA setup, RGB routing, physical switch calibration, switch selection, settings layout, advanced actions and boot-entry behavior. Keeping FD50 avoids presenting the incompatible Zuoya Hall format as stock Epomaker FB4C. The normal Epomaker configuration app has not been adapted to this firmware.

The new physical-key assignments do not establish correct sensor wiring or add seven RGB pixels. Added positions may require routing/pixel-table changes after measurement. The inherited fourth-profile selector inconsistency is also unchanged. Extra Fn-layer assignments remain donor defaults.

## Build and verification

Run from this directory:

```text
python build.py
python verify.py
```

The build is pinned to donor SHA-256 `535cf2b0d2ff5f6e696da48659bbb249a2d7dd74df243eb5ee69baa2efe368d5`. No compiler or external package is needed for the small standard-RV32I hook.

Verification executes the actual hook instruction bytes in a bounded RV32I instruction model. It checks4,771 request cases, exact source/output hashes, bounds, response-only writes, return control flow and preserved ABI registers/stack. This is not a model of the physical MCU, bootloader, ADC or LED timing.

## First hardware test

1. Open `/flasher/`, connect the Epomaker, and choose **Load custom HE30 v0.2**. Select the experimental-image option and review the exact image/hash before starting.
2. The new application is expected to enumerate as **19F5:FD50**, product **H3D02**. Browser authorization for the new application may be needed. A successful flash sequence does not establish working key/RGB routing.
3. Open `/flasher/diagnostics.html` and connect that application. It first requires the H3D1 signature; it will not silently interpret the stock donor as this custom diagnostic.
4. Start monitoring. Release all keys, reset ranges, then press one physical key at a time. Save samples. The names shown are candidate assignments, not established physical routing.
5. Establish raw response/routing before trusting typed keys, millimeter readings, calibration or RGB order. The diagnostic values are raw ADC words, and a read can span several scan phases; this is not an atomic frame or calibrated distance.

Use the existing retained calibration mode only after routing is understood. Profile JSON does not contain an identified backup of learned calibration coefficients. Flash placement/acceptance, erase boundaries, physical PCB compatibility and recovery after an application failure remain unverified. No debug-protection change or MCU unprotect operation was added.

The new command accepts a maximum56-byte read and rejects any range beyond80bytes. It cannot select arbitrary addresses or perform writes. The diagnostic page only uses this read command; it does not change mappings, calibration, RGB or persistent settings.
