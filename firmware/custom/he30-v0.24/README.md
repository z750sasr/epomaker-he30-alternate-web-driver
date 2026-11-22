# HE30 Pro v0.24 ADC and per-key calibration

[Firmware](Epomaker-HE30-EXPERIMENTAL-v0.24-Primed-ADC-Calibration.bin) · [Source and pinned build dependency](HE30-v0.24-source.zip) · [Build manifest](manifest.json) · [Compiled model checks](verification-fn-adc.json)

## Calibrate individual keys

1. Open **Quick Settings → Begin calibration** with all keys released.
2. Fully press and release each key you want to calibrate. **Red** marks keys without a previous calibration, **green** marks keys with one, and **blue** marks keys captured in this session. Firmware recognizes a press and release from the Hall signal. Press each switch to its physical stop to supply an accurate endpoint.
3. Click **Finish calibration**, then **Save changes** to store the blue keys. Other keys keep their calibration and a canceled session leaves the previous endpoints intact. When calibration ends, the normal lighting returns.

The web driver suggests calibration when keys are missing endpoints, you change a switch preset, or the same key's readings stay well outside its saved range for at least 1.5 seconds. The excursion check uses a margin of 96 ADC counts or 25% of the calibrated span, whichever is larger. The prompt opens the calibration page and lets you begin the session when all keys are released. An actual switch replacement is inferred from readings or a preset change.

## ADC changes

When the error moves to whichever channel or bank is sampled first, the timing at the start of acquisition is the leading suspect. The Zuoya V110 donor trace at `0x14CE0` enables its next bank before processing the previous bank and rearming DMA. This lets the new bank settle during useful work. The trace establishes bank-switch ordering and cannot establish an exact settling time for this board.

All three configured v0.24 scanner modes retain the physical bank and key mapping and discard the first conversion of each bank. DMA collects 13 results per bank, beginning with a repeated rank, and delivers the last 12. The first bank also gets 2 µs of extra settling. Default Fast uses the same acquisition time on every channel. The prior A–F experiments in **Diagnostics** remain available, including **F** for direct comparison with v0.23's tuned Fast settings. [Scanner implementation](../he30-v0.15/scan.c)

At the nominal 12 MHz ADC clock, the three dummy conversions add 5 µs of ADC time to Fast. The first bank adds 2 µs of settling. Removing the previous ADC6-only acquisition extension saves 1.5 µs. The net ADC and settling cost versus v0.23 Fast is approximately 5.5 µs per frame, plus the DMA buffer copy. The compiled test injects a bad first conversion into every bank and verifies that none reaches the 36 physical slots. Actual scan rate and analog settling still require testing on the board. Compare the configured Fast mode with F at release, mid-travel and bottom-out, including the keys that became inaccurate after reordering.

Export profiles you want to keep before a full-image install. The flasher reinstalls the application image and clears onboard settings and calibration. The storage format, USB behavior and existing recovery route are unchanged in this release.

## Build

Use xPack RISC-V GCC 14.2.0. From the extracted source archive, add `--base donor-v0.3.bin`.

```powershell
python firmware/custom/he30-v0.15/build.py --toolchain <toolchain-directory> --calibration-qol
$env:HE30_BUILD_DIR = (Resolve-Path firmware/custom/he30-v0.24).Path
python firmware/custom/he30-v0.15/verify.py
python firmware/custom/he30-v0.15/verify_fn_adc.py
python firmware/custom/he30-v0.15/verify_settings.py
python firmware/custom/he30-v0.15/verify_nkro.py
python firmware/custom/he30-v0.15/verify_gamepad.py
Remove-Item Env:HE30_BUILD_DIR
```
