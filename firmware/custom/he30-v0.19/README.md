# HE30 Pro v0.19 onboard Save

[H3K19 firmware image](Epomaker-HE30-EXPERIMENTAL-v0.19-Onboard-Save.bin) · [Build manifest](manifest.json)

On a physical HE30, v0.16 trapped on `csrrc mstatus` at `0x2000713a`. The native startup runs application code in RISC-V user mode. v0.18 uses the QingKe `GINTENR` register, which permits user-mode access to the interrupt enable bits. The same keyboard reached the flash writer and returned an error instead of freezing. [QingKe V4 manual, section 8.3](https://ch32-riscv-ug.github.io/WCH-common/datasheet_en/QingKeV4_Processor_Manual.PDF)

The v0.18 probe capture recorded a page-buffer timeout at `0x0801E000`. `FLASH_STATR` was `0x21` and `FLASH_CTLR` was `0x10000`. v0.19 runs the fast writer from zero-wait flash and uses `WRBSY` to pace buffer writes. It waits for `BSY` at erase and program completion. This follows the CH32V305 requirements for fast programming and retains the board's read protection. [WCH CH32FV2x/V3x manual, sections 32.2 and 32.5.6](https://static.chipdip.ru/lib/820/DOC059820997.pdf)

The physical HE30 acknowledged the onboard Save command in 321 ms. After a full power cycle it loaded the same journal record and ran with the 8,000 Hz polling cap and Fastest scan mode. **Save changes** is enabled in the web driver for H3K19. See the [physical verification handoff](../../../docs/onboard-save-handoff.md).

The image preserves the journal format and commits the inactive sector only after the preceding pages verify. Installing a full firmware image replaces the existing journal, including profiles and calibration.

Build with xPack RISC-V GCC 14.2.0 from the repository root.

```powershell
python firmware/custom/he30-v0.15/build.py --toolchain <toolchain-directory> --flash-resident-save
$env:HE30_BUILD_DIR = (Resolve-Path firmware/custom/he30-v0.19).Path
python firmware/custom/he30-v0.15/verify.py
python firmware/custom/he30-v0.15/verify_gamepad.py
python firmware/custom/he30-v0.15/verify_settings.py
Remove-Item Env:HE30_BUILD_DIR
```
