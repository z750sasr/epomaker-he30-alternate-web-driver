# HE30 Pro v0.28 Input Controls

[Firmware](Epomaker-HE30-EXPERIMENTAL-v0.28-Input-Controls.bin) · [Source and build dependencies](HE30-v0.28-source.zip) · [Manifest](manifest.json) · [Firmware tests](verification-v028.json)

## USB input and scanner workload

**Settings → Enable USB mouse** controls whether the HID pointer collection is exposed to the host. The keyboard reconnects briefly after a change. Media and app keys retain their HID Consumer collection. **Gamepad → Setup** controls Xbox visibility independently. **Save changes** stores either choice across a power cycle.

v0.27 recalculated the gamepad response and encoded a report on every service pass while Xbox mode was enabled. v0.28 checks the depths of mapped keys, reuses the computed response when those depths stay the same, and skips encoding before the report is due. The idle mouse path returns before doing the USB and pacing checks.

| Controller and mouse service workload | v0.27 | v0.28 |
| --- | ---: | ---: |
| Idle with four stick bindings | 1,745 instructions per loop | 539 |
| Held diagonal | 1,832 instructions per loop | 565 |

These are instruction counts from the compiled-image model with fixed sensor positions. Windows enumeration and actual scans per second still need to be measured on the keyboard. To compare hardware, use the same scanner and polling settings, then record the measured scan rate in **Settings** with both devices off, mouse only, Xbox only, and both enabled. Repeat with an idle board and with mapped inputs held.

## Advanced slots and saved data

Each profile now has ten advanced slots. The two additions consume 112 bytes across the four profiles in the already reserved 768-byte companion record. The mouse setting uses one byte in that same record. Both the companion record and its matching profile journal are checked before a new save is accepted. The tests exercised the extra rules, profile isolation, and recovery from an interrupted save. v0.28 reads older saved layouts and treats the new slots as empty. Export profiles before a full flash. The bundled image installs the v0.26 factory profiles and clears calibration.

## Webdriver

**Magnetic Switches → Show raw ADC on keys** displays live counts over the keyboard while editing nominal travel and Hall curve coefficients. The lightbar preview appears only in RGB Settings. Gamepad, Remap and RGB Settings use layouts from AE64 Pro Reloaded. The Gamepad Tester reads the axes and buttons Windows exposes to the browser. [W3C Gamepad API](https://www.w3.org/TR/gamepad/#dom-navigator-getgamepads)

## Rebuild

The source archive includes the pinned native USB donor, factory defaults and verification scripts. Extract it and use xPack RISC-V GCC 14.2.0.

```powershell
python build.py --toolchain <toolchain-directory> --base donor-v0.3.bin --output build --input-budget --factory-defaults v026-defaults.json
$env:HE30_BUILD_DIR = (Resolve-Path build).Path
python verify_input_controls.py
python verify_gamepad_clock.py
python verify_gamepad.py
python verify.py
python verify_v026.py
python verify_nkro.py
python verify_fn_adc.py
python verify_settings.py
Remove-Item Env:HE30_BUILD_DIR
```
