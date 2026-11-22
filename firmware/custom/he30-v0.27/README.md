# HE30 Pro v0.27 Xbox reconnect

[Firmware](Epomaker-HE30-EXPERIMENTAL-v0.27-Gamepad-Reconnect.bin) · [Source and build dependency](HE30-v0.27-source.zip) · [Manifest](manifest.json) · [Reconnect test results](verification-gamepad-clock.json)

On a connected v0.26 keyboard, the firmware acknowledged the Xbox enable command and disconnected from Windows. The keyboard never came back until it was unplugged and reconnected. The reproduction used a temporary setting in RAM and performed no onboard save.

The USB reconfiguration routine at `0x5412` calls a native delay at `0x15EBC`. The delay reprograms SysTick and clears its enable bit at `0x15F36`. The custom firmware then waits for its next USB step using the stopped counter. v0.27 preserves the counter across each native call and restores free-running SysTick before setting the 250 ms reconnect deadline.

The compiled-image test reproduced the stalled v0.26 transition with these SysTick side effects and verified repeated Xbox enable and disable on v0.27, including deadlines that cross the 32-bit counter wrap. The USB descriptor and controller report tests also ran against v0.27. Windows verified the v0.26 failure. Physical verification of v0.27 is pending.

## Installation

Export your current profiles before flashing. **Recovery & firmware → Load v0.27 HE30 Pro** loads the bundled image. A full flash restores the v0.26 factory profiles and clears learned sensor calibration. After flashing and recalibrating, enable Xbox mode under **HE30 Pro → Gamepad Mode**. Keep Device Manager open while toggling Xbox mode on and off, then test a mapped input with `joy.cpl`. Save changes to retain the selected mode after a power cycle.

## Build from the source archive

Use xPack RISC-V GCC 14.2.0. The archive includes the pinned native USB donor and the v0.26 factory profile data. Extract it before running the following from its directory.

```powershell
python build.py --toolchain <toolchain-directory> --base donor-v0.3.bin --output build --gamepad-clock-fix --factory-defaults v026-defaults.json
$env:HE30_BUILD_DIR = (Resolve-Path build).Path
python verify_gamepad_clock.py
python verify_gamepad.py
python verify.py
python verify_v026.py
python verify_nkro.py
python verify_fn_adc.py
python verify_settings.py
Remove-Item Env:HE30_BUILD_DIR
```
