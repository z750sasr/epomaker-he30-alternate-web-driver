# HE30 Pro v0.21 NKRO

[Firmware image](Epomaker-HE30-EXPERIMENTAL-v0.21-NKRO.bin) · [Build manifest](manifest.json) · [libhmk comparison](../../../docs/libhmk-comparison.md)

H3K21 reports all distinct held keyboard usages in a bitmap under USB HID Report Protocol. The host can request Boot Protocol to receive the standard eight-byte keyboard report with six ordinary key slots and eight modifier bits. USB reset restores Report Protocol. Device Overview shows the active rollover mode when connected to the Pro workspace.

The build retains the v0.20 profile keys, enhanced dead zones and onboard journal. A full-image flash clears both journal sectors. Export each profile you want to keep, then select the v0.21 image in **Recovery & firmware**. The v0.20 image remains available.

The compiled-instruction model exercises the native protocol requests, both composite descriptor configurations, all 36 remapped physical keys at once, and release retries. Physical Windows enumeration, BIOS typing and concurrent XInput operation still need verification.

Build and verify from the repository root with xPack RISC-V GCC 14.2.0.

```powershell
python firmware/custom/he30-v0.15/build.py --toolchain <toolchain-directory> --nkro
$env:HE30_BUILD_DIR = (Resolve-Path firmware/custom/he30-v0.21).Path
python firmware/custom/he30-v0.15/verify.py
python firmware/custom/he30-v0.15/verify_nkro.py
python firmware/custom/he30-v0.15/verify_gamepad.py
python firmware/custom/he30-v0.15/verify_settings.py
Remove-Item Env:HE30_BUILD_DIR
```
