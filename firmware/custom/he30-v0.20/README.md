# HE30 Pro v0.20 profile keys

[H3K20 firmware image](Epomaker-HE30-EXPERIMENTAL-v0.20-Profile-Keys.bin) · [Build manifest](manifest.json) · [Firmware model verification](verification.json)

v0.20 adds direct physical shortcuts for all four onboard profiles. In **HE30 Pro → Remap**, choose Main, Fn1, or Fn2, select a physical key, and choose **Profile 1–4**. The shortcuts belong to the profile you are editing. Use the same Fn shortcuts in each profile to make switching back easy. Select **Save changes** to keep your mappings and the active profile across power cycles.

The firmware consumes the shortcut on the press edge, switches profiles in RAM, and releases keyboard and controller state. It waits for the keys to return to rest before resuming input. Switching itself leaves a pending save. It uses v0.19's flash writer and journal, and accepts earlier whole-percent dead zones as well as v0.20's tenth-percent values.

The web driver lets you edit distances in 0.01 mm, 0.005 mm, or 0.1% increments. Millimeters are inferred from the selected switch’s calibrated travel and stored as a fraction of full travel. For example, 0.1% corresponds to 0.004 mm on a 4 mm switch. Earlier firmware still stores dead zones in whole percentages.

Installing a full image clears the journal. Export each profile you want to keep before using **Recovery & firmware**. Use **My Profiles** to restore each exported slot after updating.

The compiled firmware passed model tests for profile shortcuts, releases, settings persistence, interrupted saves, and the advanced and gamepad engines. Physical startup, input, and Save still need a hardware test on v0.20.

Build with xPack RISC-V GCC 14.2.0 from the repository root.

```powershell
python firmware/custom/he30-v0.15/build.py --toolchain <toolchain-directory> --profile-keys
$env:HE30_BUILD_DIR = (Resolve-Path firmware/custom/he30-v0.20).Path
python firmware/custom/he30-v0.15/verify.py
python firmware/custom/he30-v0.15/verify_gamepad.py
python firmware/custom/he30-v0.15/verify_settings.py
Remove-Item Env:HE30_BUILD_DIR
```
