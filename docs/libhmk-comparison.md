# libhmk and HE30 Pro

I traced the local libhmk checkout at `1d2b2e2`, its pinned TinyUSB 0.20.0 dependency, and the compiled HE30 Pro v0.20 image. The v0.21 model tests execute the new image and the inherited HID setup handlers. They do not exercise a physical BIOS or keyboard.

## Keyboard rollover

HE30 Pro v0.20 and earlier use a single eight-byte keyboard report. Byte 0 carries eight modifier bits and bytes 2 through 7 carry six ordinary usages. A seventh distinct ordinary usage replaces the six slots with HID rollover-error values. The ADC scanner can read all 36 positions. The report format is what limits simultaneous keyboard output. [HE30 key engine](../firmware/custom/he30-v0.15/firmware.c)

Libhmk builds a 28-byte report. Its first eight bytes contain a boot-compatible modifier byte and six-key array; the remaining 20 bytes are a bitmap. Its Report Protocol descriptor declares the six-key array as padding so the OS sees the bitmap and the modifier byte. Libhmk always passes the full structure to TinyUSB. TinyUSB handles `SET_PROTOCOL` but passes the application’s report length through to the interrupt transfer. Libhmk’s compatibility therefore relies on the boot host consuming the prefix. [libhmk sender](https://github.com/peppapighs/libhmk/blob/1d2b2e2/src/hid.c#L37) · [libhmk descriptor](https://github.com/peppapighs/libhmk/blob/1d2b2e2/src/usb_descriptors.c#L48) · [TinyUSB 0.20.0](https://github.com/hathach/tinyusb/blob/0.20.0/src/class/hid/hid_device.c)

HE30 Pro v0.21 uses the same prefix-and-bitmap layout with 21 bitmap bytes to cover ordinary remap usages through `0xA4`. The native interrupt handler stores interface 0’s protocol at `0x20000270`. The application reads it and sends 29 bytes in Report Protocol or eight in Boot Protocol. The native endpoint initialization hook restores Report Protocol after USB reset. The hardware EP1 DMA buffer and transfer routine already accept the larger payload; the candidate advertises the 29-byte endpoint packet size in both composite configurations. The report’s format is selected by the host’s `SET_PROTOCOL` request. [HID 1.11 §§7.2.5–7.2.6 and appendix B](https://www.usb.org/sites/default/files/hid1_11.pdf) · [Compiled model test](../firmware/custom/he30-v0.15/verify_nkro.py)

The new build uses 44 additional bytes of application RAM. Size optimizations kept it within the four pinned executable windows with 36 bytes of total room remaining. Both 4 KiB settings sectors retain their existing addresses and format.

## Feature comparison

| Area | libhmk | HE30 Pro |
| --- | --- | --- |
| Calibration | Learns a rest endpoint at boot and raises its estimated bottom endpoint when a deeper sample passes an epsilon. | Uses a quiet startup gate and explicit per-key calibration measured against idle noise. A deeper incidental sample leaves saved calibration intact. |
| Rapid Trigger | Can reset at the actuation point or remain active until the key returns to the top. | Existing enabled RT behaves like the continuous mode after initial actuation. Its press and release distances are independently configurable. |
| SOCD and Rappy Snappy | A common Null Bind rule supports direction priority, depth priority and an optional both-bottomed-out policy. | Separate SOCD and Rappy Snappy editors. Rappy Snappy has a configurable depth difference and a choice of neutral or keep-winner behavior inside that range. |
| DKS | Four physical phases. Each binding can independently emit a tap, press, release or keep its held state at each phase. | Four phase-specific outputs, currently emitted as timed taps. Added a **Preview DKS travel** panel so the user can compare real switch travel with both draft thresholds before applying. |
| Tap-Hold, Toggle and macros | Tap-Hold can promote to hold on another key press. Toggle can turn a long press into a momentary output. Macros support timed sequences of distinct actions. Tick Rate controls deferred-action timing in this engine. | Mod Tap promotes by elapsed time, Toggle latches on each press, and Macro emits up to four timed taps. Timing is already expressed in milliseconds. |
| XInput | Shapes stick magnitude with a curve and can snap to full tilt in the end zone. | Provides per-binding windows and curves, digital hysteresis, configurable opposite-direction handling and independent USB visibility. Retained the current controller path. |
| Flash | Appends wear-leveling records and consolidates them using internal flash. | Uses two full-image journal sectors with CRC and commit-last writes. The v0.19 flash writer already passed an onboard save and power cycle. |
| RGB | No RGB engine in this checkout. | Has a dedicated LED engine. This rollover update leaves it in place. |

The extra Tap-Hold, Toggle, and DKS modes would need new firmware behavior and additional profiling. The preview uses the existing sensor stream and action settings, so it also works on earlier HE30 Pro firmware. [libhmk advanced engine](https://github.com/peppapighs/libhmk/blob/1d2b2e2/src/advanced_keys.c) · [Scanner](https://github.com/peppapighs/libhmk/blob/1d2b2e2/src/matrix.c) · [Gamepad](https://github.com/peppapighs/libhmk/blob/1d2b2e2/src/xinput.c) · [Wear leveling](https://github.com/peppapighs/libhmk/blob/1d2b2e2/src/wear_leveling.c)
