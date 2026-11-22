# HE30 Pro v0.26 USB, media and RGB sleep

[Firmware](Epomaker-HE30-EXPERIMENTAL-v0.26-USB-Media-Lighting.bin) · [Source, build dependency and factory defaults](HE30-v0.26-source.zip) · [Manifest](manifest.json) · [Model checks](verification-v026.json)

## Defaults

The image boots with the four profiles captured from the owner's H3K25 keyboard, including their Main/Fn1/Fn2 keymaps, Main effects, lightbar settings and eight Fn palettes. Profile 4 is selected on first boot. The factory record uses this board's standard scanner settings and leaves Xbox USB off. Sensor calibration and the device identity are excluded from the seed. Calibrate the keys after installing the image.

## USB regression

v0.25 initialized `0x4002346C`, the endpoint 5 TX DMA register, for mouse reports sent on endpoint 4. Native `upload()` uses `0x40023458 + 4 × endpoint`, which reads `0x40023468` for endpoint 4. With that pointer left at reset, the donor's copy path can target the start of SRAM before arming a transfer. This explains why a click can interfere with the vendor HID response even though the USB mouse appears in Windows. No trap register was captured at the freeze.

v0.26 initializes the correct DMA register and reserves eight bytes at `0x200036D8` for endpoint 4 IN. Endpoint 4 OUT still handles configuration. The Xbox interface returns to number 2 in the controller-enabled configuration, with the Microsoft compatible ID pointing at interface 2. The mouse and media interface occupies number 3 when Xbox is enabled. The visible mouse occupies number 2 when Xbox is disabled. The USB regression model checks both configurations and the endpoint initialization. Windows re-enumeration and the physical fix still need verification.

The pinned image uses a zero-filled sector at `0x08024000–0x08024FFF` for cold configuration handlers and USB descriptor data. The builder verifies the original padding before writing and retains the native recovery marker at `0x08020100`, the USB hooks and the settings journal addresses. [WCH CH32V305 datasheet](https://ch32-riscv-ug.github.io/CH32V307/datasheet_en/CH32V20x_30xDS0.PDF)

## Driver controls

- In **RGB Settings → Animation and sleep**, set speed from **0 to 100**. Zero holds the current animation frame. The default of 50 uses the normal animation pace. Set an idle interval in minutes and seconds, and choose whether the lightbar stays on. A key movement wakes the LEDs. Apply the section and save changes to store these settings per profile.
- In **Remap → Media and apps**, choose among playback, volume, display brightness, search, browser controls, calculator, Apps or Launchpad, and Mission Control. These send USB Consumer usages. App shortcuts and display controls depend on the host. Apple calls the equivalent launcher **Apps** on macOS Tahoe and **Launchpad** on earlier macOS versions. [Apple keyboard shortcuts](https://support.apple.com/en-us/102650) · [Apple HID usage definitions](https://github.com/apple-oss-distributions/IOHIDFamily/blob/main/IOHIDFamily/IOHIDUsageTables.h)

## Build

Use xPack RISC-V GCC 14.2.0. The extracted archive contains the pinned v0.3 donor and the sanitized v0.26 default data.

```powershell
python build.py --toolchain <toolchain-directory> --base donor-v0.3.bin --output build --usb-lighting-fix --factory-defaults v026-defaults.json
$env:HE30_BUILD_DIR = (Resolve-Path build).Path
python verify_v026.py
python verify.py
python verify_nkro.py
python verify_gamepad.py
python verify_fn_adc.py
python verify_settings.py
Remove-Item Env:HE30_BUILD_DIR
```
