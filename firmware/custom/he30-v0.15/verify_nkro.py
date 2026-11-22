"""Execute both keyboard report formats and the pinned HID class handler."""
from pathlib import Path

source = Path(__file__).with_name("verify.py").read_text(encoding="utf-8")
exec(source.split("checks=[]", 1)[0])

assert manifest.get("nkro")
PROTOCOL = 0x20000270
CONTROL_BUFFER = 0x2000032C


def native_setup(cpu, request_type, opcode, value, index, length, stop_at=0x63BE):
    cpu.blob(0x2000025C, struct.pack("<BBHHH", opcode, request_type, value, index, length))
    cpu.native_test_ranges = ((0x5C2E, 0x606C),)

    def stop(state, pc):
        if pc == 0x5C2E:
            state.r[8] = 0x20007F00  # Native USB IRQ's frame pointer.
        return pc == stop_at

    cpu.call(0x5C2E, stop=stop, limit=3000)
    assert cpu.pc == stop_at


def reset_endpoint(cpu):
    def stop(state, pc):
        if pc == symbols["usb_endpoint_init_hook"]:
            state.r[2] -= 16
        return pc == 0x540C

    cpu.call("usb_endpoint_init_hook", stop=stop, limit=3000)
    assert cpu.get(PROTOCOL) == 1


def send(cpu):
    cpu.time += 144000
    cpu.call("keyboard_service")
    endpoint, report = cpu.sent[-1]
    assert endpoint == 1
    return report


c = fresh()
calibrated(c)
reset_endpoint(c)
native_setup(c, 0x81, 6, 0x2200, 0, 255, stop_at=0x606C)
pointer = c.get(0x20000258, 4)
size = c.get(0x20007F00 - 100, 2)
assert pointer == 0x171C0 and size == 49
descriptor = c.blob(pointer, n=size)
assert descriptor[22:34] == bytes.fromhex("95388101190029a795a88102")
for controller in (0, 1):
    c.put(0x20000104, 2 + controller)
    c.blob(0x2000025C, struct.pack("<BBHHH", 6, 0x80, 0x0200, 0, 64))
    assert c.call("usb_gamepad_control") == 1
    config = c.blob(CONTROL_BUFFER, n=34)
    assert config[25:34] == bytes.fromhex("3100070581031d0001")
c.put(0x20000104, 2)
print("PASS Native keyboard report descriptor and both composite configurations agree on NKRO length")

keys = {14: 3000, 15: 3000, 16: 3000, 17: 3000, 30: 3000, 31: 3000, 32: 3000, 10: 3000}
usages = {20, 26, 8, 21, 9, 7, 4}
assert frames(c, keys)[2:] == bytes([1]) * 6
report = send(c)
assert len(report) == 29 and report[0] == 1
assert {usage for usage in range(168) if report[8 + usage // 8] & (1 << (usage % 8))} == usages
assert read(c, 0xD0, 0, 208)[185] == 2
native_setup(c, 0xA1, 3, 0, 0, 1)
assert c.get(CONTROL_BUFFER) == 1

native_setup(c, 0x21, 11, 0, 0, 0)
assert c.get(PROTOCOL) == 0
native_setup(c, 0xA1, 3, 0, 0, 1)
assert c.get(CONTROL_BUFFER) == 0
before = len(c.sent)
assert send(c) == report[:8] and len(c.sent) == before + 1
assert read(c, 0xD0, 0, 208)[185] == 1
keys.pop(14)
frames(c, keys)
assert set(send(c)[2:]) == usages - {20}
native_setup(c, 0x21, 11, 1, 0, 0)
assert len(send(c)) == 29
print("PASS SET_PROTOCOL switches between eight-byte 6KRO and 29-byte NKRO while keys are held")

c.busy = 1
frames(c)
before = len(c.sent)
send(c)
assert len(c.sent) == before
assert send(c) == bytes(29)
native_setup(c, 0x21, 11, 0, 0, 0)
reset_endpoint(c)
assert c.get(PROTOCOL) == 1
print("PASS NKRO queues release until accepted and USB reset restores report protocol")

cfg = bytearray(get_wire(c))
all_usages = range(0x81, 0xA5)
for index, usage in enumerate(all_usages):
    cfg[160 + 14 * index + 8] = usage
configure(c, cfg)
ready(c)
frames(c, {index: 3000 for index in range(36)})
report = send(c)
assert len(report) == 29
assert {usage for usage in range(168) if report[8 + usage // 8] & (1 << (usage % 8))} == set(all_usages)
print("PASS All 36 remapped physical keys fit in one NKRO report, including usage 0xA4")
