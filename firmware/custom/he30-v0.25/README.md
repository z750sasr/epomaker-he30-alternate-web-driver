# HE30 Pro v0.25 lighting and mouse mappings

[Firmware](Epomaker-HE30-EXPERIMENTAL-v0.25-Lighting-Mouse.bin) · [Source and pinned build dependency](HE30-v0.25-source.zip) · [Build manifest](manifest.json)

- In **Remap**, select a key and layer, then choose **Assign Next profile in all four profiles**. The shortcut advances 1 → 2 → 3 → 4 → 1 once per press. You can also choose **Next profile** in the picker for the current profile alone.
- In the mapping picker, **Firmware layers** contains the two brightness bindings. Each press changes the keyboard LEDs by one percentage point. The active profile retains the change after **Save changes**. The lightbar brightness is separate.
- The keyboard plays a short teal sweep at power-on and flashes twice when the active profile changes. Those cues temporarily take priority over the keyboard effect. The established v0.24 calibration colors take priority during calibration.
- The **Mouse** category includes left, right and middle click, Back and Forward, wheel up and down, and four held pointer directions. **Keyboard Settings → Pointer speed** sets 1–32 relative counts per report. This is movement speed for keyboard-driven input. The device has no optical DPI sensor.
- **RGB Settings** uses the same Main/Fn1/Fn2 tabs as Remap. The separate **Lightbar** section offers Static, solid-color or rainbow Breathing, Rainbow wave in either direction, and Spectrum. Spectrum advances through a 24-bit RGB sequence of 16,777,216 values at full brightness. Reducing brightness scales that output.

The keyboard and vendor interface retain their USB descriptors. The mouse is a separate HID interface using EP4 IN, while vendor traffic continues to use EP4 OUT. XInput remains optional on EP3 and moves to interface 3 when enabled. The compiled model checks both configurations, the mouse descriptor, the EP4 completion path, and all mouse outputs. Confirm Windows HID/XInput enumeration and physical LED direction after installation.

Export profiles before a full-image installation. The flasher clears the onboard journal and calibration during a full update. The inherited calibration, Hall scan modes, USB recovery path and onboard save format remain available. Use v0.25 firmware with the updated driver for the new mappings and lightbar settings.

## Build

Use xPack RISC-V GCC 14.2.0. From the extracted source archive, pass `--base donor-v0.3.bin`.

```powershell
python firmware/custom/he30-v0.15/build.py --toolchain <toolchain-directory> --desktop-keys
$env:HE30_BUILD_DIR = (Resolve-Path firmware/custom/he30-v0.25).Path
python firmware/custom/he30-v0.15/verify.py
python firmware/custom/he30-v0.15/verify_desktop.py
python firmware/custom/he30-v0.15/verify_fn_adc.py
python firmware/custom/he30-v0.15/verify_settings.py
python firmware/custom/he30-v0.15/verify_nkro.py
python firmware/custom/he30-v0.15/verify_gamepad.py
Remove-Item Env:HE30_BUILD_DIR
```
