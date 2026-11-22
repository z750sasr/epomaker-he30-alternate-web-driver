# Zuoya HE30 V115 stability and timing

This analysis uses the July 7, 2025 FD50 image in [firmware/reference](../firmware/reference/Zuoya-HE30-FD50-V115-20250707.bin), SHA-256 `535cf2b0d2ff5f6e696da48659bbb249a2d7dd74df243eb5ee69baa2efe368d5`. The addresses below use its `0x5000` execution alias. The disassembly uses QingKe’s compressed byte and halfword load/store encodings. Generic RISC-V tools can decode those instructions as floating-point operations. [Image metadata](../firmware/reference/Zuoya-HE30-FD50-V115-20250707.json) · [WCH QingKe V4 manual](https://www.wch-ic.com/downloads/QingKeV4_Processor_Manual_PDF.html)

## Adaptive Stability or Shake Optimization

The matching flag is bit 1 of configuration byte 7, at `0x2000331B`. The key-depth routine tests it at `0xFB1E–0xFB26` and conditionally checks the first of two switch-specific thresholds at `0x17434`. The ordinary path checks the second threshold. Both comparisons reach the same transition path at `0xFB74`; the flag gives that path an alternate threshold near full travel. The table entries match for several switch selectors and differ for one of the six traced selectors. The static trace establishes a depth-dependent stability rule. Its physical distance and impact on a given switch depend on the donor’s curve and calibration.

## Key Debounce Level

At `0xFDC4–0xFDE4` the scanner shifts configuration byte 7 right by five to select an eight-entry table. Startup copies the table at `0x18C70` into RAM at `0x2000024C`. Its bytes are `25, 50, 75, 75, 75, 75, 75, 75`. The transition code loads the selected count into the key’s counter at `0x20002C74 + keyIndex`. The scan routine called from `0x14F3E` decrements a nonzero count at `0xEA24–0xEA58` and skips that key’s normal update for that visit. These are scan visits. Milliseconds require a measured per-key scan cadence on the donor. The Zuoya desktop language file names three levels; its English and Chinese resources reverse the order of two labels, so the raw table is the reliable evidence for setting codes.

## Tick Rate

The driver’s configuration codec stores Tick Rate in the high nibble of byte 4. Zuoya’s desktop language resource lists **No Tick rate**, **30 Tick rate**, and **60 Tick rate**. In V115, `0x67B0` transfers the config into RAM and persistent storage. The comparison at `0x68C6` masks the low nibble before requesting a USB reset, and `0x77FE–0x7862` reads its low three bits to set USB endpoint intervals. I found no verified V115 runtime consumer of the high nibble in the paths traced. The Epomaker stock driver’s help describes protecting short press/release pairs from being missed by games. That description is consistent with a minimum report hold, but it does not establish that algorithm or its timing in Zuoya V115. The 30/60 choices cannot be used to infer ADC scan or USB polling rates. [Configuration codec](../js/protocol/codecs.js#L321)

## HE30 Pro recommendation

Keep the current scanner defaults. HE30 Pro smooths each ADC reading, calibrates endpoints per key, validates the calibration excursion against idle noise, applies per-key dead zones, and requires two consecutive scans to confirm an ordinary or Rapid Trigger state change. It also applies release hysteresis or distinct Rapid Trigger press and release distances. These cover the stability problems targeted by the donor threshold and debounce controls, without adding the donor’s transition lockout. The two-scan filter’s timing depends on scan mode, so shallow Rapid Trigger settings still benefit from a physical chatter test at each speed. [Key engine](../firmware/custom/he30-v0.15/firmware.c) · [ADC scanner](../firmware/custom/he30-v0.15/scan.c)

Keep Tick Rate out of the Pro UI until there is a reproducible short-tap problem in a specific game or host and USB reports show where the transition is lost. ADC stability and host consumption of brief taps are separate behaviors.
