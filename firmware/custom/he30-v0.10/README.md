# Epomaker HE30 Pro v0.10

Use **Load v0.10 HE30 Pro** in the [flasher](../../../flasher/) to select the [experimental firmware](Epomaker-HE30-EXPERIMENTAL-v0.10-Pro.bin). The application identifies itself as H3K10 at `19F5:FB4C`. A full-image update clears the two settings journal pages. Export any profiles you want to restore through the [HE30 Pro workspace](../../../pro/).

On factory settings, typing starts when the board collects 32 stable scan frames near the measured released positions. Leave all keys released at startup. The firmware estimates travel using a 1,600-count span until you run full-travel calibration. These startup measurements stay in RAM, and the driver reports them separately from saved calibration. A saved **Disable typing** preference persists across power cycles.

All four factory profiles share the same Main map. Fn1 and Fn2 are transparent at every position. The physical Fn key opens Fn1 while held. Assign any other Main-layer key to Fn2 to use that layer.

| Sensor group | Main map in ADC scan order |
| --- | --- |
| 1 | F1, F2, F3, F4, F5, F6, Grave, Space, Fn, Alt, Ctrl, B |
| 2 | 6, Tab, Q, W, E, R, 5, 4, 2, 3, 1, Esc |
| 3 | G, Left Shift, Z, X, C, V, F, D, A, S, Caps Lock, T |

This build retains the [v0.9 features and hardware assumptions](../he30-v0.9/README.md). The [manifest](manifest.json) records the exact image hash and memory layout. Rebuild with `python build.py --toolchain <xPack RISC-V GCC directory>` from this directory, using GCC 14.2.0. Run `python verify.py` to test the compiled code against modeled peripherals.

The [verification report](verification.json) covers first-boot typing, a key held through startup, all four maps, persisted preferences, and the existing profile, action, RGB and gamepad paths. Entry into recovery and flashing were tested with simulated WebHID events. Physical scan timing, startup behavior and USB recovery on this build remain unverified.
