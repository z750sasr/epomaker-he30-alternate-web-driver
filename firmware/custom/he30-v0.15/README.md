# HE30 Pro v0.15

Choose **Load v0.15 HE30 Pro** in [Recovery & firmware](../../../flasher/) to load [H3K15](Epomaker-HE30-EXPERIMENTAL-v0.15-Pro.bin). Export profiles before flashing. A full flash clears onboard profiles and Hall calibration.

## Polling and scan settings

- **Apply polling rate** changes firmware report pacing immediately. The keyboard stays connected and preserves held keys. The selected rate is a cap on keyboard and controller reports. USB link speed, host scheduling and available key transitions affect observed report frequency.
- **Apply scan mode** reinitializes the Hall scanner and resumes scanning after release. It retains the USB connection. If ADC initialization fails, the driver attempts to restore the previous mode. The driver reports both the active mode and measured full scans per second.
- **Remember active rates** keeps the current polling and scan rates in browser storage. The driver reapplies them when this browser connects to an H3K15. **Forget remembered rates** removes that preference.
- **Install startup rates via recovery** stores the rates on the keyboard by installing a full image with those startup settings. This replaces onboard profiles and calibration.

The physical H3K15 accepted changes to the polling rate, but its Save command timed out at `0xD0` operation 8. The driver uses profile export and browser rate storage on this firmware. The firmware's page writer passed the simulated journal tests. Live onboard saving remains unresolved.

## Zuoya V115 evidence

Input [Zuoya FD50 V115](../../reference/Zuoya-HE30-FD50-V115-20250707.bin), SHA-256 `535cf2b0d2ff5f6e696da48659bbb249a2d7dd74df243eb5ee69baa2efe368d5`. Addresses are execution addresses. Subtract `0x5000` for file offsets.

| Address | Observation |
| --- | --- |
| `0x16DDC + 6*4`, `0x759C` | Configuration bank write command 6 dispatches to `0x67B0`. |
| `0x67B0–0x68DC` | The code copies incoming configuration into RAM and saves it through `0x14FE0`. It compares the old and updated low nibble of configuration byte 4. A changed nibble branches to the reset request at `0x68CE–0x68DC`. |
| `0x77EE–0x786C` | The USB startup code takes the low three bits of that field, sets the endpoint descriptor intervals, then enables USB. |
| `0xBA52`, `0xBAB6`, `0xBB1E` | The donor unlocks standard and fast flash mode. Its writer erases 256-byte pages, loads each page as 64 words, then commits it. v0.15 implements this sequence with bounded waits and journal range checks. |

This static trace establishes the V115 settings-bank path. Other donor builds and entry points were outside the trace. The REA CLI diagnosed the installation and reported that firmware-region inspection requires Linux with Binwalk. The address trace was completed with RISC-V disassembly and the firmware bytes. WCH documents the page size, fast-programming constraint and status bits in chapter 32 of the [reference manual](https://static.chipdip.ru/lib/820/DOC059820997.pdf).

See the [build manifest](manifest.json) and [verification report](verification.json). Build with `python build.py --toolchain <xPack RISC-V GCC 14.2.0 directory>`. Run `verify.py`, `verify_gamepad.py` and `verify_settings.py` with Python from this directory.
