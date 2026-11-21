# HE30 Pro v0.9

Application build for the 36-key Epomaker HE30 with CH32V305RBT6. The working v0.3 USB startup and the v0.6 RGB power and serial-data sequence serve as the board baseline. The generic HID gamepad, scan modes, profile library and key actions are compiled and tested against peripheral models. The v0.9 image still needs its first physical flash and hardware validation.

- Open the local `/flasher/` page and select **Load v0.9 HE30 Pro**. The manifest and image SHA-256 are checked before the review step.
- Open `/pro/` in desktop Chrome or Edge after H3K09 appears. In **Quick Settings**, calibrate all 36 switches, then enable typing. Verify each key on the live board.
- Apply settings from the relevant editor, then select **Save changes** to write the entire four-profile library. Reconnect to apply the saved report cadence and USB controller visibility.
- **Diagnostics** shows complete 36-key frames per second, the most recent ADC frame time, and maximum observed ADC frame time. Measure both DMA profiles on the physical keyboard before depending on either. Start with Compatibility if the readings are unstable.

A full-image flash initializes both journal pages. Export existing key and lighting settings from the earlier driver before replacing that image. The My Profiles page can restore those exports into the selected slot. For profile naming, the firmware accepts up to 15 printable ASCII characters. Each of the four profiles includes a Main layer, Fn1 and Fn2, performance settings, switch parameters, eight advanced rules, gamepad bindings and RGB settings. Calibration endpoints describe the physical board and are shared. Saved profiles restore without the browser running.

## Timing and memory

The linker keeps the application in three checked padding windows of the pinned donor-derived base. It preserves the existing startup, USB and boot flags. The new code is standard RV32IMC. Its two settings pages are at 0x0801E000 and 0x0801F000. The save writes to the inactive page and programs the commit marker last, leaving a previous valid record if a write is interrupted. The original 155,056-byte image convention includes trailing donor data. The new code and both settings pages fit below physical 0x08020000. See `manifest.json` for the exact linked sizes and checksums.

DMA modes sequence 12 channels per Hall bank using ADC1 and DMA1 channel 1. They avoid a CPU register transaction for each conversion. The GPIO settling guard separates the three banks. The nominal ADC clock is 12 MHz in those modes, giving conversion-only budgets of approximately 78 µs with 13.5 sample cycles and 60 µs with 7.5 cycles. Code execution, bank settling and USB activity add overhead. The shorter sample mode also needs a physical noise and channel-bleed check. The lightbar SPI divisor compensates for the APB2 clock change. The one-shot compatibility scanner uses a nominal 9 MHz ADC clock and the longest sample setting. [WCH CH32V305 datasheet](https://ch32-riscv-ug.github.io/CH32V307/datasheet_en/CH32V20x_30xDS0.PDF)

USB report pacing can be set from 125 to 8000 Hz. Actual host polling depends on negotiated speed, endpoint scheduling and the host. The known High-Speed descriptor already advertises interval 1. The controller is a separate generic HID gamepad using endpoint 3. Its on/off setting determines whether that interface is enumerated after restart. The inherited USB stack has no implemented XInput control descriptors in this build. Axes combine opposite directions and keyboard reports suppress controller-mapped physical keys while the interface is active.

The local Wooting 2.14.1 packages were checked as Intel HEX. The original uses AVR jump vectors and populates 128 KiB of data. The 60HE ARM and Plus use Cortex-M vectors and populate about 474 and 473 KiB. Both ARM images initialize SP to 0x20018000. Wooting's published Two HE transition to pipelined conversion and separating RGB work from input informed the design. This build uses the Zuoya bank sequence and its own RGB renderer. [Wooting hardware history](https://wooting.io/post/the-volt-regulator-got-us) · [Wooting scan research](https://wooting.io/post/validation-tests-lekker-update-8)

## Switch selection

Zuoya FD50 V115 has six 201-entry Hall tables starting at file offset 0x1244C, with stride 0x192. IDs 1 and 3 share a response table, as do IDs 2 and 4. The lookup input is the endpoint-scaled ADC response and the inverse lookup returns a travel index. Its legacy desktop software assigns Gateron Magnetic Jade, Gateron Magnetic White and Hejin to IDs 0, 1 and 2. This linkage is supported by desktop AddItem IDs 502–504 and the direct switch_type write. The V110 and V115 tables for those three IDs match. The current Zuoya site configures different HE30 USB IDs and exposes Magnetic Pro Switch, Chinese Red Lotus HE. That label is independent of the three FD50 presets. [Zuoya site](https://zuoya.keybord.net.cn/) · [Zuoya English switch labels](https://zuoya.keybord.net.cn/_next/static/chunks/249.97f1513acb2cf6ca.js)

| FD50 selector | Curve exposed in driver | Fitted coefficient | Maximum donor fit error |
| --- | --- | ---: | ---: |
| 0 | Gateron Magnetic Jade | 13770 | 1.49% of travel |
| 1 | Gateron Magnetic White | 13596 | 3.45% |
| 2 | Hejin | 18457 | 1.05% |
| 5 | Factory selector 5 | 23461 | 4.04% |

Calibration first maps each key's released and pressed ADC values to a 0–1 interval, supporting either polarity. The normalized curve fits the inverse donor LUT with the AE64-style function `(1 - sqrt(C/(C + 65535q))) / (1 - sqrt(C/(C + 65535)))`, where `q` is the normalized ADC position and `C` is the coefficient. The driver supplies travel and coefficient. The firmware caches 33 nodes for each selected key and interpolates at runtime. The full catalog stays in the browser. AE64 entries and Zuoya fits are presented separately because their curves differ. The 0–1000 travel representation yields 0.004 mm steps at 4 mm travel. ADC steps, sensor noise and donor curve error determine real accuracy.

## RGB and scope

Owner confirmed PB15 through a series resistor to the first keyboard LED. The working updated v0.6 source drives PA9 and PA10 high. PA9 is traced through the 1 kΩ input resistor to the likely NPN that pulls down the probable P-channel MOSFET gate. With that topology, PA9 high turns on the 5 V LED rail. The component identities and PA10's independent role are provisional. The sibling's LOW and floating states concern its own PCB. v0.9 keeps the working two-pin sequence and re-enables persisted effects. PB5 drives the five-pixel bar. The driver can show the colors in the last completed transmit frame. Confirmation of the individual LEDs' physical color and brightness requires observing the board.

DKS supports four threshold-crossing taps. MPT can hold up to three outputs by depth. Macros support four key taps separated by release gaps. SOCD supports neutral, either priority and last pressed. Rappy Snappy compares normalized travel with an adjustable gap and permits both keys at bottom out. The keyboard endpoint uses six ordinary keys plus modifiers. Adaptive stability and a configurable debounce setting are outside this build. The browser uses the AE64 Reloaded shell, typography and navigation with HE30-specific editors, protocol and capabilities. [AE64 source revision](https://github.com/tuk3kCS/everglide-ae64-pro-webdriver/tree/c3c600e4b733375177bb4bcd5e5799755c30be55)

## Reproduce

Run `python firmware/custom/he30-v0.9/build.py` with the local xPack toolchain, `python firmware/custom/he30-v0.9/verify.py`, `node --test flasher/*.test.mjs pro/*.test.mjs` and `node smoke-test.cjs`. Firmware tests run the linked instructions and flash writer with modeled USB, ADC, timer, GPIO and flash. Browser tests validate the protocol against replies from the compiled firmware. The browser connection and physical keyboard remain separate from these tests.
