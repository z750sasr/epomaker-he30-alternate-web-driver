# HE30 Pro v0.23 scanner and RGB fix

[Firmware image](Epomaker-HE30-EXPERIMENTAL-v0.23-Scanner-RGB-Fix.bin) · [Firmware source and pinned donor](HE30-v0.23-source.zip) · [Manifest](manifest.json) · [Model verification](verification-fn-adc.json)

The connected v0.22 keyboard reported ADC value 4207 on all 36 keys while the frame counter advanced. An unfinished calibration kept the rate controls locked. Stopping that session and restarting the scanner in RAM restored distinct sensor values without sending a Save command. On the bench, v0.22 with its scanner restarted reported about 10,237 complete scans per second in DMA Fast. That reading covers idle frame throughput. Travel accuracy and scan rate under load still require measurement.

v0.22 wrote the ADC DMA peripheral address before enabling the DMA1 clock on cold startup. v0.23 enables the clock first, programs the ADC data register address, and verifies the address before starting the scanner. The driver reports invalid ADC samples and provides **Restart scanner** in Quick Settings and Diagnostics. **Keyboard Settings** and **Diagnostics** show **Stop calibration** during a calibration session, so the rates can be changed without navigating back to Quick Settings.

The last four keyboard LEDs, Ctrl, Fn, Alt and Space, showed wrong colors at the Original setting on the physical v0.22 board. On v0.23, the full key chain uses the existing Half rate signal for Main, Fn1, and Fn2. The **Lightbar data rate** setting still adjusts the separate lightbar. The compiled model verifies both SPI timing selections and the full key-chain payload. The physical LED output on v0.23 still needs verification.

Export any profiles you want to keep before installing v0.23 through [Recovery & firmware](../../../flasher/). Full-image installation clears the onboard journal and calibration. The firmware keeps the v0.22 journal format, GPIO bank mapping, ADC scan experiments, NKRO and boot protocol, and USB recovery path.

Build with xPack RISC-V GCC 14.2.0. Add `--base donor-v0.3.bin` when rebuilding from the extracted source archive.

```powershell
python firmware/custom/he30-v0.15/build.py --toolchain <toolchain-directory> --adc-rgb-fix
$env:HE30_BUILD_DIR = (Resolve-Path firmware/custom/he30-v0.23).Path
python firmware/custom/he30-v0.15/verify.py
python firmware/custom/he30-v0.15/verify_fn_adc.py
python firmware/custom/he30-v0.15/verify_settings.py
python firmware/custom/he30-v0.15/verify_nkro.py
python firmware/custom/he30-v0.15/verify_gamepad.py
Remove-Item Env:HE30_BUILD_DIR
```
