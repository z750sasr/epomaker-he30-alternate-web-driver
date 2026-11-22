# HE30 Pro v0.17 live-save test

[H3K17](Epomaker-HE30-EXPERIMENTAL-v0.17-Live-Save-Test.bin) is a candidate repair for the normal onboard **Save changes** operation. One firmware installation supplies the corrected save routine. The routine is designed to persist subsequent changes through the existing onboard journal. The driver's regular Save action stays gated until a physical save and power-cycle test passes.

The H3K16 flash writer tried to exit enhanced read mode while the flash control register was locked. On a controller with enhanced read mode active and both locks set, the model rejects that write and reaches the first erase with enhanced read mode still active. WCH requires both unlocks for the mode control bit and the normal unlock for the exit command. It also documents a separate active-mode status bit in `FLASH_ACTLR`. H3K17 unlocks first, checks both locks and the active mode, and restores the mode before relocking. [WCH reference manual, sections 32.3 and 32.4](https://static.chipdip.ru/lib/820/DOC059820997.pdf)

The instruction model passed the save with both locks and enhanced read mode active. The same image passed the three firmware suites, including prior-sector retention after a simulated failed write. The subsequent H3K16 debugger capture identified an earlier illegal instruction before the flash controller was touched. See the [onboard save handoff](../../../docs/onboard-save-handoff.md) for the current repair.

Build with xPack RISC-V GCC 14.2.0 from the repository root:

```powershell
python firmware/custom/he30-v0.15/build.py --toolchain <toolchain-directory> --live-save-fix
$env:HE30_BUILD_DIR = (Resolve-Path firmware/custom/he30-v0.17).Path
python firmware/custom/he30-v0.15/verify.py
python firmware/custom/he30-v0.15/verify_gamepad.py
python firmware/custom/he30-v0.15/verify_settings.py
Remove-Item Env:HE30_BUILD_DIR
```

The [manifest](manifest.json) records the exact image hash. The [handoff](../../../docs/onboard-save-handoff.md) describes the physical save and power-cycle test. The H3K16 debugger trace format and addresses are shared by H3K17.
