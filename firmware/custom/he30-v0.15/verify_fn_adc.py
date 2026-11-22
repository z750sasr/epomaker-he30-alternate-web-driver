"""Check v0.22 RGB flash transactions and ADC sequencing on compiled code."""
from pathlib import Path

exec(Path(__file__).with_name('verify.py').read_text(encoding='utf-8').split('\nchecks=[]', 1)[0])
assert FN_RGB
checks = []


def check(name):
    checks.append(name)
    print('PASS ' + name, flush=True)


def palette_offset(profile, layer):
    return (profile * 2 + layer - 1) * 128


def get_palette(cpu, profile, layer):
    base = palette_offset(profile, layer)
    chunks = []
    for offset, size in [(0, 55), (55, 18)]:
        reply = request(cpu, 0xd1, 9, off=base + offset, length=size)
        assert reply[2] == 0 and reply[4] == size
        chunks.append(reply[8:8 + size])
    return b''.join(chunks)


def set_palette(cpu, profile, layer, data):
    base = palette_offset(profile, layer)
    assert request(cpu, 0xd1, 10, data[:55], base)[2] == 0
    assert request(cpu, 0xd1, 10, data[55:], base + 55)[2] == 0


def rgb_frame(cpu):
    for _ in range(8):
        cpu.time += 5 * 144000
        cpu.call('rgb_service')
    return read(cpu, 0xd1, 8, 123)


lighting = fresh()
calibrated(lighting)
lighting.field('rgb_path', 1)
plain = rgb_frame(lighting)
assert plain == bytes([16]) * 123
red = b'\1' + struct.pack('<36H', *[15 * 33 * 33] * 36)
invalid = b'\1' + bytes(52) + b'\xff\xff'
assert request(lighting, 0xd1, 10, invalid)[2] == 2
assert request(lighting, 0xd1, 10, red[:55])[2] == 0
assert get_palette(lighting, 0, 1) == bytes(73)
pset(lighting, 2, b'\1')
assert request(lighting, 0xd1, 10, red[55:], 55)[2] == 3
pset(lighting, 2, b'\0')
assert request(lighting, 0xd1, 10, red[55:], 55)[2] == 5
check('Fn RGB writes validate color data and are atomic across fragments and profile changes')

palettes = {}
for profile in range(4):
    pset(lighting, 2, bytes([profile]))
    for layer in [1, 2]:
        # Unique value for every profile, layer and physical LED.
        words = [(profile + 1) * 1089 + layer * 33 + key % 33 for key in range(36)]
        data = b'\1' + struct.pack('<36H', *words)
        set_palette(lighting, profile, layer, data)
        palettes[profile, layer] = data
pset(lighting, 2, b'\0')
set_palette(lighting, 0, 1, red)
palettes[0, 1] = red
if manifest.get('desktop_keys'):
    lighting.time += 500 * 144000
ready(lighting)
frames(lighting, {8: 3000})
assert lighting.field('fn') == 1
assert rgb_frame(lighting) == bytes([15, 0, 0]) * 36 + plain[108:]
frames(lighting)
assert rgb_frame(lighting) == plain
cfg = bytearray(get_wire(lighting))
cfg[160 + 8 * 14 + 8] = 253
configure(lighting, cfg)
ready(lighting)
frames(lighting, {8: 3000})
assert lighting.field('fn') == 2
second = rgb_frame(lighting)
assert second[:108] == b''.join(bytes([1, 2, key % 33]) for key in range(36))
led_order = json.loads((HERE / 'wiring.json').read_text())['ledToHall']
key_frame = next(frame for chain, frame in reversed(lighting.dma_frames) if chain == 1)
for led, key in enumerate(led_order):
    grb = (2 << 16) | (1 << 8) | (key % 33)
    assert key_frame[64 + 12 * led:76 + 12 * led] == bytes([0x88, 0x8e, 0xe8, 0xee][grb >> shift & 3]
        for shift in range(22, -1, -2))
assert second[108:] == plain[108:]
set_palette(lighting, 0, 2, bytes(73))
assert rgb_frame(lighting) == plain
set_palette(lighting, 0, 2, palettes[0, 2])
frames(lighting)
check('Held Fn1 and Fn2 display their per-key colors in LED order and leave the lightbar independent')

assert control(lighting, 8) == 0
boot = reboot(saved_image(lighting))
assert all(get_palette(boot, *slot) == data for slot, data in palettes.items())
set_palette(boot, 0, 1, bytes(73))
boot.cut = 192 + 410
try:
    control(boot, 8)
except PowerCut:
    interrupted = reboot(saved_image(boot))
    assert get_palette(interrupted, 0, 1) == red
else:
    raise AssertionError('Expected a power cut during the new main journal write')
set_palette(lighting, 0, 1, b'\1' + bytes(72))
assert control(lighting, 8) == 0
assert get_palette(reboot(saved_image(lighting)), 0, 1) == b'\1' + bytes(72)
lighting.flash[lighting.physical(FN_PAGES[1]) + 12] ^= 1
assert get_palette(reboot(saved_image(lighting)), 0, 1) == red
check('All eight palettes survive reboot; interrupted or corrupt newest pairs preserve earlier palettes')

scanner = fresh()
calibrated(scanner)
before = get_wire(scanner)
original = [6, 7, 14, 15, 8, 9, 5, 4, 12, 13, 11, 10]
swapped = [10, *original[1:11], 6]
banks = [2, 0, 1]
expected_values = tuple(1000 + bank * 500 + 11 * channel for bank in banks for channel in original)
calibration_qol = manifest.get('calibration_qol')
conversion_order = [[6, *original] if calibration_qol else original, original, original, swapped, original, [6, *original], swapped]

for trial, channels in enumerate(conversion_order):
    pset(scanner, 9, bytes([trial]))
    assert read(scanner, 0xd2, 0, 88)[15] == trial
    assert scanner.get(0x40021004, 4) & 0xf800 == 0xa000
    assert scanner.get(0x40012410, 4) >> 18 & 7 == (3 if trial == 0 else 2 if trial in [2, 6] else 1)
    scanner.conversions.clear()
    assert scanner.call('adc_frame_fast', TEMP) == 0
    assert scanner.conversions == [(bank, channel) for bank in banks for channel in channels]
    assert struct.unpack('<36H', scanner.blob(TEMP, n=72)) == expected_values
    assert scanner.get(0x40012408, 4) & 2 == 0  # Single regular sequence.
assert get_wire(scanner) == before
assert request(scanner, 0xd2, 9, b'\7')[2] == 2
assert control(scanner, 10) == 0 and read(scanner, 0xd2, 0, 88)[15] == 0
scanner.fail = 'dma_adc'
assert scanner.call('adc_frame_fast', TEMP) == 3
assert scanner.latch[0x40011000] & 0x6000 == 0x6000
assert scanner.latch[0x40010c00] & 0x400 == 0x400
assert scanner.get(0x40020008, 4) == scanner.get(0x40012408, 4) == 0
check('ADC A–F rank and acquisition settings preserve all 36 physical slots and shut down on DMA error')

if manifest.get('adc_rgb_fix'):
    class ClockGatedDMA(CPU):
        def put(self, address, value, size=1):
            if 0x40020000 <= address < 0x40020400 and not self.get(0x40021014, 4) & 1:
                return
            super().put(address, value, size)

    cold = fresh()
    cold.__class__ = ClockGatedDMA
    assert not cold.get(0x40021014, 4) & 1
    cold.call('firmware_main', limit=4_500_000, stop=lambda cpu,_:cpu.field('frames',size=4)>=2)
    assert not cold.field('scan_error') and cold.get(0x40020010, 4) == 0x4001244c
    assert struct.unpack('<36H', cold.blob(S + layout['raw'], n=72)) == expected_values
    check('Cold startup programs the ADC DMA source after its peripheral clock is enabled')

    header = bytearray(read(lighting, 0xd1, 0, 160)[16:28])
    for rate in [0, 1]:
        header[3] = rate
        lighting.writes.clear()
        assert request(lighting, 0xd1, 1, header)[2] == 0
        rgb_frame(lighting)
        settings = {address:value for address,value in lighting.writes if address in [0x40003800, 0x40013000] and value}
        assert settings[0x40003800] == 0x364
        assert settings[0x40013000] == 0x364 + 8 * rate
    check('Keyboard stays at half-rate while the lightbar responds to both data-rate selections')

if calibration_qol:
    for mode in [0, 1, 2]:
        pset(scanner, 8, bytes([3, mode, 0]))
        scanner.fail = None
        assert control(scanner, 10) == 0
        scanner.first_rank_sample = 4095
        scanner.conversions.clear()
        assert scanner.call('adc_frame_fast', TEMP) == 0
        assert len(scanner.conversions) == 39
        assert struct.unpack('<36H', scanner.blob(TEMP, n=72)) == expected_values
    check('All configured scan modes discard a corrupted first conversion in each bank')

    cal = fresh()
    prior = bytearray(get_wire(cal))
    struct.pack_into('<I', prior, 8, 1 << 5)
    struct.pack_into('<H', prior, 16 + 2*5, 1001)
    struct.pack_into('<H', prior, 88 + 2*5, 3001)
    configure(cal, prior)
    cal.field('rgb_path', 1)
    before_cal = rgb_frame(cal)
    assert control(cal, 4) == 0
    colors = rgb_frame(cal)
    assert colors[0:3] == bytes([16,0,0]) and colors[15:18] == bytes([0,16,0])
    assert colors[108:] == before_cal[108:]
    frames(cal, n=35)
    assert control(cal, 5) == 7
    frames(cal, {0:3000})
    assert rgb_frame(cal)[:3] == bytes([16,0,0])
    frames(cal)
    assert rgb_frame(cal)[:3] == bytes([0,0,16])
    frames(cal, {0:3000})
    assert control(cal, 5) == 8  # Do not finish while a captured key is held.
    frames(cal)
    assert control(cal, 5) == 0
    assert rgb_frame(cal) == before_cal
    updated = get_wire(cal)
    assert struct.unpack_from('<I', updated, 8)[0] == (1 << 5 | 1)
    assert struct.unpack_from('<H', updated, 88)[0] == 3000
    assert updated[26:28] == prior[26:28] and updated[98:100] == prior[98:100]
    assert control(cal, 8) == 0
    assert get_wire(reboot(saved_image(cal))) == updated
    assert control(cal, 4) == 0
    assert rgb_frame(cal)[:3] == bytes([0,16,0])
    assert control(cal, 11) == 0
    assert rgb_frame(cal) == before_cal and get_wire(cal) == updated
    check('Partial calibration shows red, green and blue physical frames, retains untouched endpoints and survives Save')

(BUILD / 'verification-fn-adc.json').write_text(json.dumps(dict(sha256=manifest['sha256'], checks=checks,
    hardware_tested=False), indent=2))
