# HE30 v0.4 — mapping and RGB tests

v0.4 retains the owner's working v0.3 USB startup and adds explicitly started hardware tests. **Built and tested offline; not flashed or physically validated.** Normal typing, calibrated travel, saved profiles and lighting effects remain disabled.

| Artifact | Value |
| --- | --- |
| Image | Epomaker-HE30-EXPERIMENTAL-v0.4-Mapping-RGB.bin |
| Size | 155,056 bytes |
| SHA-256 | 78afacd0b9527f4f29f6e999fdc8533538400556f08e1903e156d0814a6a63b9 |
| Application | 19F5:FB4C / H3M04 |
| USB release/version reply | 0x0400 |
| Signatures | H3B1 startup; H3M1 hardware snapshot, format1 |

## Flash and connect

1. Open `/flasher/` and select **Load v0.4 mapping/RGB tests**. A cached v0.3 file is not silently replaced. Review this image/hash, select the experimental-image option, then use the existing review/flash flow.
2. Entering recovery from H3B03 uses the exact existing recovery request. The inherited donor boot-flag/reset path remains unverified on Epomaker. If AF22 does not appear, save the log rather than repeatedly sending commands.
3. After flashing, look for **H3M04**. Close other configuration/flasher tabs and open **`/flasher/hardware.html`**, keep all keys released, then **Connect v0.4**. The page checks H3M1, runs passive ADC and automatically starts three-bank capture and baseline collection. RGB remains manual.
4. If HE30 Upgrader returns instead, save the flash log. v0.3 is still the last demonstrated working baseline. No new image was flashed during this build task.

## Map the sensors

1. Connecting first runs passive ADC on the twelve proposed analog inputs, without changing bank-select outputs. A passive ADC error stops automation before any banked capture.
2. Three-bank capture starts automatically after passive success. Keep all keys released while the page collects five stable frames and takes a median baseline. Each channel's spread must be at most12 ADC counts. The page then requests a capture about150ms after the preceding capture/read finishes. It selects the proposed banks, captures36 values and leaves the bank lines high. This is not the final high-speed scanner.
3. Follow the prompt: press and hold the named key, then release it. One clear channel must exceed the measured-noise threshold for two captures; two released captures then record the mapping and advance automatically. Multiple active channels and already-assigned channels do not get silently relabeled. No assignment-button clicks are required. With no physical key presses, automatic readings continue but physical legends cannot be inferred.
4. Results save periodically to localStorage and after mapping changes. Reload restores notes/frames without starting hardware; connecting always takes a fresh baseline. Restored labels are local notes, not independently verified identification of the attached board. Browser storage failure leaves live capture/manual export available.
5. **Stop sampling** before RGB tests. **Save results** exports JSON. The baseline, physical selector and assignment button remain for corrections. Hardware errors/disconnects stop the loop without automatic retries; completing36 guided assignments also stops it. The firmware binary is unchanged by this browser automation update.

The bank hypothesis is **PC13, PC14, PB10**, independently selected active-low. Within each bank, channels are:

`10,11,12,13,4,5,6,7,14,15,8,9`

Analog pin candidates are **PC0–PC5, PA4–PA7 and PB0–PB1**. These are Zuoya donor facts being tested on Epomaker, not confirmed Epomaker wiring. The page initially labels positions by bank/channel, without pretending their physical names are known.

ADC1 uses single conversions, long sample time and PCLK2/8. Its register calibration and every conversion wait are bounded. This peripheral calibration is not magnetic-switch calibration and writes no learned Hall coefficients. Values are raw12-bit readings, not millimeters. `0xFFFF` denotes an uncaptured slot. No filtering, actuation, RT or input reports are enabled.

On success or an ADC timeout, ADC is disabled and banked tests deassert all three lines high. Pin configuration remains until changed/reset. Passive mode does not undo outputs configured by an earlier banked test. No debug-pin remap is offered. If readings do not follow keys, or several positions move together, save those results; they leave routing, bank selection, power and analog behavior unresolved.

## Test RGB outputs and LED order

The dark RGB on v0.3 was expected because that firmware never initialized lighting. v0.4 also leaves RGB off at boot; tests start only when selected.

1. Stop sampling. Choose **PB15 · SPI2**, **All64 test slots**, **Donor rate**, **GRB**, then **Dim red**. Try green/blue and record what physically lights, including “nothing”.
2. Send **black / off**, then try **PB5 · SPI1 remapped**. If a path works, uncheck all-slots and test indices0–63 to map physical LEDs. The64-slot limit does not establish64 physical LEDs.
3. If colors are swapped, try RGB order and record the result. Half donor rate provides a second bounded timing hypothesis. Continued darkness does not identify an I²C controller or prove an LED fault.
4. Enter the actual keys/color in the observation field and record it. Save results, and send black before leaving a working output.

| Hypothesis | Output | Transfer |
| --- | --- | --- |
| 1 | PB15 / SPI2 | DMA1 channel5 |
| 2 | PB5 / remapped SPI1 | DMA1 channel3 |

Both use the donor's pair-of-bits encoding `88,8E,E8,EE`, twelve bytes per24-bit color. A frame contains64 low prefix bytes,64 encoded pixels and64 low suffix bytes, totaling896 bytes at RAM0x20004400. DMA sends the contiguous waveform. SPI divisors are16 for SPI2 and32 for SPI1, with a half-rate option. Given v0.3's reported clocks, nominal default rate is4.5Mbit/s; physical timing was not measured.

The page uses12/255 for a chosen color and firmware rejects components above16. Black frames switch LEDs off through data, without toggling an unknown power pin. A completed DMA/SPI transfer does not acknowledge that an LED received data. No exact addressable-LED IC is identified. There is no speculative I²C-controller initialization or arbitrary GPIO/power selection.

## Status and failure handling

The v0.3 clock guards and exception record remain. Hardware actions mark stage0x31 for ADC or0x34 for RGB, returning to0x30 after completion or a handled timeout. Inspect the separate error field. A CPU exception still captures cause/PC and parks; the main loop may then be unable to answer USB requests.

| Error | Meaning |
| --- | --- |
| 0 | No error in last action |
| 1 | ADC reset-calibration timeout |
| 2 | ADC calibration timeout |
| 3 | ADC conversion timeout |
| 4 | RGB DMA completion timeout |
| 5 | SPI busy timeout after DMA |

ADC count increments after a complete capture. RGB count increments after DMA and SPI complete. A failed RGB transfer may have partially changed LEDs. Counters are not measured polling rates.

If an action freezes the diagnostic application, power-cycle its USB and reconnect. Hardware actions are not automatically restarted after reset. Save the last report/log first when possible.

## Protocol, memory and writes

- **55/DC:** retained read-only H3B1 startup status.
- **55/DB:** read-only160-byte snapshot, length≤56, offset+length≤160. Reads never start peripherals.
- **55/DD:**12-byte payload: `TEST`, action, path, pixel, R, G, B, rate, reserved0. Checksum, padding and parameter bounds are checked before hardware access. Actions1/2 capture passive/banked ADC;3/4 send dim/black frames. ADC requests require all RGB options zero.

The browser requires H3M04 and attests H3M1 before every control. Stock configuration codecs reject H3M04. There are no arbitrary-address, arbitrary-pin, persistent-keymap, Hall-calibration, settings, protection or security writes. The exact legacy5F06 recovery request is still the inherited flash-writing exception, with its previous unverified behavior.

Snapshot0–63 retains startup fields. Offset64 holds H3M1,68 format,69 last ADC mode,70 last RGB path,71 error,72u32 ADC frame count,76u32 last action,80–151 the36u16 samples,152u32 RGB frame count and156u32 DMA status. Multibyte fields are little-endian. Samples remain fixed between requested captures; separate host reads are not an atomic hardware-wide snapshot.

The2,604-byte extension occupies checked zero padding at file0x16000 / execution alias0x1B000, below0x20000. It does not overlap v0.3 code, native data initialization, settings tables or known boot flags. Reset clears160 bytes of reserved status RAM. Full image length is retained.

## Validation and sources

Run `python build.py` and `python verify.py` here. v0.3's exact SHA is pinned. The verifier executes generated RV32I instructions against bounded peripheral models: read bounds, ordered bank/channel values, invalid-command isolation, cleanup, both RGB paths/rates, exact pixel bytes, black frames, timeouts and ABI/stack preservation. Models cannot establish physical wiring, sensor readings, LED timing, USB interrupt interaction or recovery behavior.

Generated reply fixtures feed `node --test flasher/protocol.test.mjs flasher/flow.test.mjs flasher/hardware.test.mjs`. Page tests cover automatic passive-to-banked capture, baseline collection, guided press/release assignment, autosave/restore, local corrections and observation export, plus automatic stops on either ADC stage failing or on disconnect. The repository smoke test also passes. The disconnected page layout was visually checked in Edge during its initial build. No physical test or flash occurred during development.

Register fields/widths were checked against WCH's [ADC driver](https://github.com/openwch/ch32v307/blob/main/EVT/EXAM/SRC/Peripheral/src/ch32v30x_adc.c), [SPI driver](https://github.com/openwch/ch32v307/blob/main/EVT/EXAM/SRC/Peripheral/src/ch32v30x_spi.c), [RCC driver](https://github.com/openwch/ch32v307/blob/main/EVT/EXAM/SRC/Peripheral/src/ch32v30x_rcc.c) and [device header](https://github.com/openwch/ch32v307/blob/main/EVT/EXAM/SRC/Peripheral/inc/ch32v30x.h). Retrieved hashes and Zuoya V115 instruction windows are retained in `he30-lab/mapping-rgb-v04-2026-11-19/` in the workspace. These establish the implementation and donor hypotheses; they do not prove Epomaker copied that PCB.
