# Epomaker HE30 v0.6 — confirmed RGB wiring

Built for the owner's **Epomaker HE30**, CH32V305RBT6, with36 keys including F1–F6 and grave. v0.6 retains the v0.5 input/calibration features and adds RGB on the owner-confirmed data nets. Built and tested offline; **not flashed or physically validated in this task**.

## Confirmed wiring

| Connection | Physical evidence | Implementation |
| --- | --- | --- |
| PB15, MCU leg36 | Through a resistor to the first key LED;36 LEDs in series | SPI2 MOSI, DMA1 channel5 |
| PB5, MCU leg57 | Connected to RGB light bar; owner reports5 LEDs | Remapped SPI1 MOSI, DMA1 channel3 |
| PB10 / PC13 / PC14 | Hall Groups1 /2 /3, continuity confirmed previously | Same scanner and channel order as v0.5 |

The key LED chain order, starting at its first LED, is:

```text
Esc F1 F2 F3 F4 F5 F6 6 5 4 3 2 1 Grave
Tab Q W E R T G F D S A Caps LShift Z X C V B Space Alt Fn Ctrl
```

All36 names occur exactly once. This is **separate from the Hall scan order**. [wiring.json](wiring.json) stores the full order and LED-to-Hall permutation; the compiled-code verifier checks the actual firmware table against it. The page uses serial LED numbers1–36; internal indices are0–35.

Pin routing and counts are confirmed. The exact addressable LED model, its wire protocol, timing tolerance, color order and any independent power-enable circuitry are not identified. The key chain is confirmed serial. The bar driver assumes the same serial signaling based on its data connection and donor implementation; that still needs a live test.

## Flash and first RGB test

1. **Before reflashing v0.5 with useful calibration**, export the key profile from `/flasher/keyboard.html`. If updating a configured v0.6, export its lighting JSON too. A full-image flash initializes both custom journal pages as empty. Reading an old journal format is supported by the application, but this full-image flasher does not preserve those pages.
2. Open `/flasher/`, choose **Load v0.6 RGB foundation**, then use the existing review/flash flow. The image remains experimental. No development test automatically flashes a connected device.
3. After finalization/power-cycle, expect **19F5:FB4C**, product **H3K06**, firmware **0x0600**. The flasher reads H3K1 and H3L1 status; successful USB status does not prove LED behavior. If AF22/HE30 Upgrader returns, save the log: application startup has not been established.
4. Open `/flasher/keyboard.html`, connect H3K06. Fresh defaults send dim teal to the36 key LEDs. The light bar defaults to **five LEDs, disabled**. Connecting the page only reads; it does not change lighting.
5. Select a physical key card, then **Identify selected key LED**. Exactly its LED should show dim white for two seconds, then restore the configured lighting. This works without completed key calibration. Try Esc (LED1), F1 (LED2), A (LED25), Space (LED33), Fn (LED35) and Ctrl (LED36).
6. Set a solid red/green/blue color and **Apply lighting to RAM** to confirm physical colors. Enable the light bar, keep its count at5, choose its color and apply. If colors are swapped, try GRB/RGB. If dark or unstable, test the alternate waveform rate and record what changes. Completion counters confirm MCU transfers only; LEDs do not acknowledge data.
7. For a per-key color, select its card, edit Selected key color/strength, choose **Per-key colors**, then Apply lighting. Reactive mode lights keys while their calibrated actuation is active. It requires the normal key calibration/enable procedure.
8. **Save custom settings to keyboard** persists mappings, calibration, tuning and lighting together. Export key and lighting JSON separately. Power-cycle to test restoration. Turn both chains off and save if startup lighting is unwanted.

Key input still starts disabled on a fresh image. [v0.5's calibration and input instructions](../he30-v0.5/README.md) apply: confirm sensor cards, collect32 released frames, fully press/release all36 keys, finish with everything released, Enable typing, then Save. The key profile format remains compatible with v0.5; its import/export does not include RGB, which has its own profile.

## RGB implementation

- Fixed36-key chain on PB15 and independent bar on PB5. The confirmed bar default is5; its bounded0–64 advanced count exists for testing. Shrinking the count clears previously sent tail pixels. Only the known data nets are configured; no guessed power pin, I²C controller or debug pin is driven.
- Keyboard modes: off, solid, per-key palette, reactive while keys are actuated. The bar has separate enable/color. The temporary white identification overlay is not persisted. Remapping a keyboard binding does not change which physical LED belongs to its sensor.
- One shared896-byte waveform buffer remains unchanged while DMA owns it. Transfers are serialized between chains, alternating when both are pending so continuous key changes cannot starve the bar. The loop polls DMA completion and SPI drain without waiting in a spin loop or masking interrupts. Sensor scans and USB handling continue between polls. Static lighting is sent on changes rather than every scan; reactive mode queues updates when pressed states change.
- Both paths have a20ms timeout. A transfer error disables RGB scheduling and returns data low; typing is independent. Status distinguishes DMA vs SPI-drain timeout. Retry is explicit. A failed transfer may have partly changed LEDs; it cannot prove the physical LEDs are off.
- RGB components are limited to32/255 for initial testing. GRB is default, with RGB selectable. Donor waveform uses `88,8E,E8,EE`,12 encoded bytes per24-bit pixel, plus64 low prefix and suffix bytes.36 keys use560 transfer bytes; five bar LEDs use188. SPI2 divisor16 and remappedSPI1 divisor32 are the default; the alternate setting doubles each divisor. Based on the reported144MHz clock setup, nominal SPI rates are4.5Mbit/s and2.25Mbit/s; these are not physical timing measurements or proof of an exact LED model.
- Color options and palette commands are validated before each command mutates RAM. Applying a complete lighting profile uses several commands; a transport failure can leave a partially changed RAM palette. The page reports this and requires reading/reapplying before saving. It does not save partial changes automatically. Imports only change a page draft.

The original664-byte key configuration and H3K1 protocol remain unchanged. A separate `55/D1` extension exposes H3L1 status, lighting options, palette, identify/off/retry/defaults. [API.json](API.json) documents exact packets and fields. Keyboard and lighting requests share one serialized queue and filter responses by command, so polling cannot consume a lighting reply.

## Persistence and memory

The two journal pages stay at physical`0x0801E000` /`0x0801F000`,4096bytes each, with1024-byte records. Record v2 includes the664-byte key config plus128-byte lighting config in the previous padding. CRC covers both; the commit marker is last. v1 records are accepted and get v0.6 lighting defaults. Invalid/partial records are ignored as before. No read-protection, option-byte or ROM/RAM partition writes are added.

The pinned working v0.3 base and OEM USB/clock/reset machinery remain. New standard RV32IM code and the SRAM-writer load bytes occupy exactly the reserved12KiB at alias`0x1B000..0x1DFFF`. The build rejects any overflow into journal pages; this reservation has no spare room. Verification-only layout metadata is retained in a nonloaded ELF section instead of using target flash. State occupies4612bytes starting at`0x20004000`; the shared frame is within that state. The flash writer remains in its separate SRAM reservation at`0x20007000`. This is a deliberate donor-layout boundary, not a claim that the MCU cannot support more features.

The builder pins and checks the base hash, patch preconditions, changed ranges, code/storage limits and writer bounds. Exact output hash, compiler command, source hashes and sizes are in [manifest.json](manifest.json). Source, ELF, disassembly, map, symbols and layout are retained.

```powershell
python firmware/custom/he30-v0.6/build.py
python firmware/custom/he30-v0.6/verify.py
node --test flasher/*.test.mjs
node smoke-test.cjs
```

## Verification and remaining limits

The verifier executes the actual compiled RV32IM instructions against bounded peripheral models. It retains the v0.5 input/calibration/journal checks and adds both RGB paths, exact encoded pixels in the physical order, five-bar output, GRB/RGB and rates, palette mapping, identification expiry, reactive updates, clearing shortened tails, immutable DMA buffer ownership, DMA/SPI error cleanup and continued input. It checks v2 lighting persistence and v1 compatibility, and exports handler response fixtures for browser tests.

Browser tests cover compiled-response decoding, complete key/LED permutation, shared transaction serialization, invalid draft rejection, explicit lighting apply/identify, read-only connection/import and post-flash H3K1/H3L1 attestation. These are offline checks. They do not establish electrical signaling, actual LED colors/timing, physical Hall behavior, real flash operation, USB IRQ timing or inherited recovery success. No connected-device command or flash was sent during this build task.
