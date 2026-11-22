"""Exercise the Xbox switch with the donor's SysTick side effects modeled."""
from pathlib import Path

source = Path(__file__).with_name('verify.py').read_text(encoding='utf-8')
exec(source.split('checks=[]', 1)[0])

TICKS_MS = 144000
CONTROL = 0xe000f000
COUNT = 0xe000f008
COMPARE = 0xe000f010
NATIVE_USB = 0x5412
FIXED = manifest.get('gamepad_clock_fix', False)


def advance(cpu, ms):
    if cpu.get(CONTROL, 4) & 1:
        cpu.time += ms * TICKS_MS


def status(cpu):
    report = read(cpu, 0xd3, 0, 40)
    cpu.field('vendor_pending', 0)
    assert report[:4] == b'H3G1'
    return report[5], report[6], report[13]


def assert_timer_resumed(cpu, before):
    assert cpu.get(CONTROL, 4) == 5
    assert cpu.get(COMPARE, 4) == cpu.get(COMPARE + 4, 4) == MASK
    assert 0 < (cpu.get(COUNT, 4) - before) & MASK < TICKS_MS


cpu = fresh()
cpu.native_usb_borrows_timer = True
assert status(cpu) == (0, 0, 0)
for enabled in ([1, 0, 1, 0] if FIXED else [1]):
    if FIXED:
        # Start close enough to the wrap that the detach and attach deadlines
        # can cross it on separate passes.
        cpu.time = MASK - (50 if enabled else 200) * TICKS_MS
    previous_calls = cpu.calls.count(NATIVE_USB)
    assert request(cpu, 0xd3, 4, bytes([enabled]))[2] == 0
    cpu.call('gp_usb_service')
    assert cpu.calls.count(NATIVE_USB) == previous_calls
    assert status(cpu) == (enabled, 1 - enabled, 1)
    cpu.call('gp_usb_service')
    advance(cpu, 99)
    cpu.call('gp_usb_service')
    assert cpu.calls.count(NATIVE_USB) == previous_calls

    advance(cpu, 2)
    before = cpu.get(COUNT, 4)
    cpu.call('gp_usb_service')
    assert cpu.calls.count(NATIVE_USB) == previous_calls + 1
    assert status(cpu) == (enabled, 1 - enabled, 3)
    if not FIXED:
        assert not (cpu.get(CONTROL, 4) & 1)
        advance(cpu, 1000)
        cpu.call('gp_usb_service')
        assert cpu.calls.count(NATIVE_USB) == previous_calls + 1
        assert status(cpu) == (1, 0, 3)
        print('REPRODUCED v0.26 USB remaining detached with SysTick stopped')
        break

    assert_timer_resumed(cpu, before)
    advance(cpu, 249)
    cpu.call('gp_usb_service')
    assert cpu.calls.count(NATIVE_USB) == previous_calls + 1
    advance(cpu, 2)
    before = cpu.get(COUNT, 4)
    cpu.call('gp_usb_service')
    assert cpu.calls.count(NATIVE_USB) == previous_calls + 2
    assert_timer_resumed(cpu, before)
    assert cpu.get(0x20000104) == (3 if enabled else 2)
    assert not cpu.get(0x20000269) and not cpu.get(0x20000266)
    cpu.usb()
    assert status(cpu) == (enabled, enabled, 0)

assert not cpu.programs and not cpu.erases
if FIXED:
    result = {
        'sha256': manifest['sha256'],
        'passed': ['vendor reply before detach', 'repeated Xbox enable and disable',
                   'SysTick restored after both donor calls', 'deadline wraparound',
                   'correct interface selection', 'no flash writes'],
        'hardware_tested': False,
    }
    (BUILD / 'verification-gamepad-clock.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print('PASS Xbox USB detach and reconnect in both directions with donor SysTick side effects')
