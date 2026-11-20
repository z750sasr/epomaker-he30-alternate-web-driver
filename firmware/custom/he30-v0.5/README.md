# Epomaker HE30 v0.5 — keyboard foundation

Experimental functional build for the owner's **36-key Epomaker HE30**, CH32V305RBT6. This is not the Zuoya HE30 board. The working v0.3 USB/clock/reset implementation is retained; the Hall scanner, calibration, key engine, settings protocol and persistence are new code built for the continuity-traced Epomaker matrix. No v0.5 physical result has been recorded yet. No keyboard was flashed while building or validating this version.

## Flash and first test

1. Open `/flasher/` in Chrome/Edge on localhost. Close other keyboard configuration tabs. Choose this directory's v0.5 `.bin` manually, review its hash, and use the existing review/flash procedure. The load button now selects the newer v0.6 RGB build; v0.5 remains available for comparison without RGB.
2. After finalization, connect the application. Its expected USB identity is **19F5:FB4C**, product **H3K05**, firmware **0x0500**. If necessary unplug its USB for three seconds and reconnect. Remaining **HE30 Upgrader / AF22** means application startup has not been established; save the flasher log.
3. Navigate to `/flasher/keyboard.html`, then **Connect v0.5**. Connection only reads settings and status. The original stock settings page and v0.4 hardware page use different protocols and cannot configure this build.
4. Check the raw cards: pressing one physical key should primarily change its matching card. The defaults already use Group1 PB10, Group2 PC13, Group3 PC14. If readings stay constant, change together or show an ADC error, stop here and export the raw status. Do not compensate for a routing problem by blindly remapping keys.
5. Release every key. Choose **Begin calibration**. Wait for the released baseline to finish (32 full scan frames). Then fully press and release every physical key, including Fn and modifiers. The page shows the learned count and individual ranges. All36 ranges must be valid.
6. Release every key, choose **Finish calibration**, then **Enable typing**. Release keys again to clear the input interlock. Test individual keys, modifiers, W+A, S+D and Fn combinations in a text/key tester.
7. Choose **Save custom settings to keyboard** to persist calibration, mappings, tuning and the enabled-at-startup flag. This is an explicit save; Apply and calibration alone change RAM. Also **Export profile JSON** for a separate backup. Power-cycle and confirm normal input and calibration restore.

If no saved valid configuration exists, startup scans sensors but **typing is disabled** until calibration and explicit enable. A saved enabled configuration restores typing after the release interlock. The v0.5 full-image flash replaces its journal with an empty one; export a profile before any future reflash. Disabling typing and saving keeps it disabled on subsequent startup.

## Confirmed physical wiring

The owner traced these connections with a multimeter. Key names refer to physical PCB locations. Their order is intentionally different from a visual keyboard row.

| ADC | MCU GPIO | MCU leg | Group1 · PB10 | Group2 · PC13 | Group3 · PC14 |
| --- | --- | --- | --- | --- | --- |
| 6 | PA6 | 22 | F1 | 6 | G |
| 7 | PA7 | 23 | F2 | Tab | LShift |
| 14 | PC4 | 24 | F3 | Q | Z |
| 15 | PC5 | 25 | F4 | W | X |
| 8 | PB0 | 26 | F5 | E | C |
| 9 | PB1 | 27 | F6 | R | V |
| 5 | PA5 | 21 | Grave / ~ | 5 | F |
| 4 | PA4 | 20 | Space | 4 | D |
| 12 | PC2 | 10 | Fn | 2 | A |
| 13 | PC3 | 11 | Alt | 3 | S |
| 11 | PC1 | 9 | Ctrl | 1 | Caps |
| 10 | PC0 | 8 | B | Esc | T |

Group outputs are selected **active low**, with every group deasserted between selections and after a frame. Polarity and settling behavior are inherited from the donor and still require physical confirmation. The configurable default16000 settling-loop iterations is conservative and is not a measured time guarantee. ADC startup/calibration and conversion waits are bounded. Scanner errors suppress typing, deassert the groups and wait for an explicit retry.

## Implemented behavior

- All36 mapped physical keys, modifiers, simultaneous presses and a momentary Fn layer. Default normal bindings match the table; Fn+physicalF1–F6 emits F7–F12, Fn+number1–6 emits F1–F6, other Fn bindings are transparent. Bindings latch on physical actuation and remain until that key releases, so releasing Fn does not strand a different output.
- Standard8-byte USB keyboard reports through the donor's known interface0/endpoint1. Six ordinary simultaneous key codes plus an independent modifier bitmap (**6KRO, not NKRO**). Duplicate source bindings produce one held output; more than six ordinary codes report HID rollover and recover when the count falls.
- Released baseline and full-press endpoint calibration, either sensor polarity, with minimum span/noise checks. Per-key actuation, release hysteresis, Rapid Trigger press/release movement, top/bottom dead zones and disabled output. Defaults:50% actuation,5% hysteresis,4% RT movements; RT starts disabled. Two-frame filtering/debounce applies.
- Positions and tuning use **linear percentages of the learned raw sensor range**, not measured millimeters. This build does not copy a stock switch's nonlinear magnetic travel curve or claim stock four-switch calibration compatibility.
- Fresh report composition plus retry of all-zero release reports when the native USB endpoint is busy. Calibration, settings changes, save, disable and USB reconnect/suspend force releases and an eight-quiet-frame interlock. HID idle requests are honored. Both native configured flags must be set; configuration0 cannot send reports. Remote wake is not advertised or implemented.
- CRC-checked staged configuration apply; no partial configuration becomes live. Bounded read/control protocol and separate v0.5 page. JSON import loads a page draft, Apply changes RAM, Save persists to the device.
- Dedicated two-page journal, CRC and commit-last records. A new record is appended rather than overwriting the current valid record. Page rotation erases the other page while retaining the last committed one. Incomplete records are ignored. The writer runs from SRAM with interrupts masked only during flash access; no option-byte or read-protection changes.

RGB is deliberately **not initialized**. No SPI/DMA/RGB test runs. DKS, SOCD, gamepad/XInput, macros, stock profile compatibility and a measured scan/polling-rate target are outside this foundation. USB endpoint interval1ms is not a measurement of full scan or end-to-end latency.

## Build and memory boundaries

`build.py` pins the v0.3 base SHA-256 `efaad04ebbed9a32d9d11545f182338e29a5ed6d41fa89c95dd4e8c0ca55103f`, validates every patch precondition and permits differences only within declared ranges. It retains the OEM reset, low-level USB/interrupt and reduced clock machinery. Main jumps to new standard RV32IM code at alias`0x1B000`; no compressed or proprietary instruction is generated in new application code.

| Region | Reservation |
| --- | --- |
| New code, constants and writer load bytes | alias`0x1B000` to below`0x1E000` |
| App state | SRAM`0x20004000`; current compiler layout3556bytes, hard limit`0x20006C00` |
| Flash writer | SRAM`0x20007000`, maximum1024bytes; explicitly retained by the linker |
| Initial stack | `0x20008000` |
| Custom journal | physical`0x0801E000` and`0x0801F000`,4096bytes each |
| Record | 1024bytes;664-byte configuration, version/sequence/CRC and final commit marker |

The build checks that the code/storage source regions were padding in the pinned base, code cannot overlap either storage page, SRAM code is nonempty and fits, and scratch storage is aligned. The source guard confines the flash writer to the two journal pages. The native inherited recovery routine is a separate explicit boot-entry command and remains unvalidated on this custom application; it is not called during scans, reads or settings saves. Original firmware remains unavailable; this is not a restored manufacturer image.

Compiler: official portable xPack RISC-V GCC14.2.0-3, target`rv32im_zicsr_zifencei`, ABI`ilp32`, no standard library, no small-data/relaxation assumptions. The default toolchain path is the local lab copy; `--toolchain` can select another installation of the same compiler. No system installation is required.

```powershell
python firmware/custom/he30-v0.5/build.py
python firmware/custom/he30-v0.5/verify.py
node --test flasher/*.test.mjs
node smoke-test.cjs
```

The exact binary name, hash, compiler invocation, sizes and edits are in [manifest.json](manifest.json). The ELF, disassembly, linker map, actual compiled layout and symbols are retained alongside source. [API.json](API.json) defines packet/config/status layouts.

## Verification and remaining hardware work

`verify.py` executes the **compiled RV32IM instructions**, including the SRAM flash writer, against bounded USB/GPIO/ADC/timer/flash models. It checks startup and scan order, ADC timeouts, both calibration polarities, Fn/rollover/duplicate/modifier behavior, Rapid Trigger, USB busy/reconnect/suspend handling, staged configuration guards, journal rotation and interrupted-write recovery. It also emits handler response fixtures used by browser tests, so C and JavaScript packet layouts are checked against each other.

The browser tests exercise read-only connect, edit validation, apply/import behavior, flasher transitions and shared transport filtering. Native USB/clock/reset calls are stubbed in the instruction model. These tests do **not** prove physical sensor polarity, settling, real flash behavior, interrupt timing, recovery success or actual key input. First hardware results must establish those. RGB needs the owner's next wiring trace: supply/enable, first LED DIN, and the controller or MCU pin driving it.
