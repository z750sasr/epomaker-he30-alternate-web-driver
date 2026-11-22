# HE30 Pro v0.23

Use Windows and xPack RISC-V GCC 14.2.0.

```powershell
python build.py --toolchain <toolchain-directory> --base donor-v0.3.bin --output build --adc-rgb-fix
$env:HE30_BUILD_DIR = (Resolve-Path build).Path
python verify.py
python verify_fn_adc.py
python verify_settings.py
python verify_nkro.py
python verify_gamepad.py
```

The donor provides the inherited USB startup and OEM recovery code. All custom firmware C and assembly sources are in this archive. The build verifies the donor hash and the addresses it modifies.
