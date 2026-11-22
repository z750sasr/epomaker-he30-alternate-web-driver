# HE30 Pro v0.22 Fn RGB and ADC tuning

[Firmware image](Epomaker-HE30-EXPERIMENTAL-v0.22-Fn-RGB-DMA.bin) · [Firmware source and donor image](HE30-v0.22-source.zip) · [Build manifest](manifest.json) · [ADC analysis and hardware tests](../../../docs/he30-v022-adc-fn-rgb.md)

In **HE30 Pro → Lighting**, choose Fn1 or Fn2 in **Lighting layer**, enable its palette, select keys on the virtual keyboard, and set their color. Use **Apply Fn lighting**, then **Save changes**. Repeat for each layer and profile you want to customize. When a mapped Fn key is held, its configured palette takes effect. Releasing Fn returns to Main lighting. Each palette uses the profile's keyboard brightness and leaves the lightbar independent.

**Diagnostics** offers six temporary ADC experiments and displays the measured complete scan rate, ADC frame duration, and raw counts for all 36 sensors. **Settings** offers three persistent scanner modes. DMA stability is the default on a fresh image. DMA fast uses experiment F. Scan rate and analog accuracy still require hardware measurements.

Export every profile you want to retain before using [Recovery & firmware](../../../flasher/) to install the image. A full-image flash clears the journal and calibration. v0.22 still uses the v0.21 USB report layouts and the existing recovery route. [Main firmware model results](verification.json) · [Fn RGB and ADC model results](verification-fn-adc.json)

Build from the repo root with xPack RISC-V GCC 14.2.0. The source archive also includes the pinned v0.3 donor as `donor-v0.3.bin`. Pass `--base donor-v0.3.bin` when building from the extracted source archive.

```powershell
python firmware/custom/he30-v0.15/build.py --toolchain <toolchain-directory> --fn-rgb
$env:HE30_BUILD_DIR = (Resolve-Path firmware/custom/he30-v0.22).Path
python firmware/custom/he30-v0.15/verify.py
python firmware/custom/he30-v0.15/verify_fn_adc.py
python firmware/custom/he30-v0.15/verify_settings.py
python firmware/custom/he30-v0.15/verify_nkro.py
python firmware/custom/he30-v0.15/verify_gamepad.py
Remove-Item Env:HE30_BUILD_DIR
```
