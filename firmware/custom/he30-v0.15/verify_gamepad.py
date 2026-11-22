"""Execute the linked H3K15 controller, USB hooks and journal in the CPU model."""
from pathlib import Path
import struct
import zlib

# Reuse the linked-image CPU and peripheral model without running its suites.
source = Path(__file__).with_name("verify.py").read_text(encoding="utf-8")
exec(source.split("checks=[]", 1)[0])

GP = 0x20003700
NEUTRAL = bytes([0, 20]) + bytes(18)

def set_config(cpu, data, first=0):
    for offset in range(first, len(data), 56):
        assert request(cpu, 0xd3, 2, data[offset:offset+56], offset)[2] == 0
    return request(cpu, 0xd3, 3, struct.pack("<I", zlib.crc32(data)))[2]

def report(cpu, depths=None, n=15):
    keys = frames(cpu, depths, n)
    cpu.time += 144000
    cpu.call("gp_service")
    return keys, cpu.sent[-1][1]

def setup(cpu, type_, request_, value, index, length):
    cpu.blob(0x2000025c, struct.pack("<BBHHH", request_, type_, value, index, length))
    handled = cpu.call("usb_gamepad_control")
    count = min(64, cpu.get(0x20000262, 2))
    return handled, cpu.blob(0x2000032c, n=count)

c = fresh()
original = read(c, 0xd3, 1, 292)
assert original[0:2] == bytes([1, 1])
assert all(original[2+21*i] == 255 for i in range(10))
assert all(original[212+5*i] == 255 for i in range(14))
mouse = manifest.get('desktop_keys',False)
usb_fix = manifest.get('usb_lighting_fix',False)
assert setup(c, 0x80, 6, 0x0200, 0, 255)[1][:5] == bytes([9,2,91 if mouse else 66,0,3 if mouse else 2])
assert setup(c, 0x80, 6, 0x03ee, 0x409, 18)[0] == 0
assert setup(c, 0xc0, 0x20, 0, 4, 40)[0] == 0
assert request(c,0xd3,4,b'\1')[2] == 0
c.call("gp_usb_service")
assert 0x5412 not in c.calls
c.field("vendor_pending",0)
c.call("gp_usb_service")
c.time += 101*144000
c.call("gp_usb_service")
assert c.calls.count(0x5412) == 1 and c.get(0x20000104) == 2
c.time += 251*144000
c.call("gp_usb_service")
assert c.calls.count(0x5412) == 2 and c.get(0x20000104) == 3
assert c.get(0x20000269) == 0 and c.get(0x20000266) == 0
release = int(manifest['release'],16)>>8
assert setup(c,0x80,6,0x0100,0,18)[1][8:14] == bytes.fromhex("f5194cfb01")+bytes([release])
assert setup(c,0x80,6,0x0200,0,9)[1] == bytes([9,2,131 if mouse else 106,0,4 if mouse else 3,1,0,128,250])
head = setup(c,0x80,6,0x0200,0,255)[1]
tail = c.blob(c.get(0x20000258,4),n=67 if mouse else 42)
config = head + tail
xinput = config[66:106] if usb_fix else config[-40:]
assert xinput[:9] == bytes([9,4,3 if mouse and not usb_fix else 2,0,2,0xff,0x5d,1,0])
assert xinput[-14:] == bytes.fromhex("0705830320000107050303200001")
assert setup(c,0x80,6,0x03ee,0x409,8)[1] == bytes.fromhex("12034d0053004600")
assert setup(c,0xc0,0x20,0,4,255)[1][16:26] == bytes([3 if mouse and not usb_fix else 2])+b'\x01XUSB10\0\0'
assert setup(c,0xc0,0x20,0,5,255)[0] == 0
print("PASS USB visibility waits for reply, detaches, and serves both composite layouts and XUSB descriptors",flush=True)

c.usb()
calibrated(c)
settings = bytearray(original)
for action,key in [(0,32),(1,31),(2,15),(3,33),(8,35)]:
    settings[2+21*action]=key
for action,key in [(0,17),(10,14),(11,16)]:
    settings[212+5*action]=key
struct.pack_into("<HH",settings,2+21*8+1,2000,8000)
assert request(c,0xd3,2,settings[:56],0)[2] == 0
assert request(c,0xd3,3,struct.pack("<I",zlib.crc32(settings)))[2] == 5
assert read(c,0xd3,1,292) == original
bad = bytearray(settings)
bad[2+21] = 32
assert set_config(c,bad) == 2 and read(c,0xd3,1,292) == original
assert set_config(c,settings) == 0 and read(c,0xd3,1,292) == settings
ready(c)
assert report(c)[1] == NEUTRAL
keys,pad = report(c,{15:3000,32:3000,35:3000,17:3000,14:3000,16:3000})
assert keys == bytes(8)
assert struct.unpack_from("<hh",pad,6) == (-23166,23166)
assert pad[4] == 255 and struct.unpack_from("<H",pad,2)[0] == 0x1000
assert struct.unpack_from("<H",report(c,{17:1800})[1],2)[0] == 0x1000
assert report(c,{17:1500})[1] == NEUTRAL
assert report(c,{32:3000,31:3000})[1] == NEUTRAL
for _ in range(32):
    assert report(c,{32:3000},n=2)[0] == bytes(8)
    assert report(c,n=2)[0] == bytes(8)
print("PASS controller transactions, diagonals, triggers, hysteresis, D-pad cancellation and repeated key suppression",flush=True)

settings[1] = 2
assert set_config(c,settings) == 0
ready(c)
report(c)
assert report(c,{32:3000})[0][2] == 4
c.field("scan_error",1)
c.time += 144000
c.call("gp_service")
assert c.sent[-1] == (3,NEUTRAL)
c.field("scan_error",0)
assert report(c,{32:3000})[1] == NEUTRAL
assert report(c)[1] == NEUTRAL
assert report(c,{32:3000})[1] != NEUTRAL
c.time += 60*144000
c.call("gp_service")
assert c.sent[-1] == (3,NEUTRAL)
ready(c)
pset(c,2,b'\1')
second = read(c,0xd3,1,292)
assert second[1] == 2 and second[2] == 255
assert second[2+21*8+1:2+21*8+5] == settings[2+21*8+1:2+21*8+5]
pset(c,2,b'\0')
assert read(c,0xd3,1,292) == settings
assert control(c,8) == 0
saved = reboot(saved_image(c))
assert read(saved,0xd3,1,292) == settings and saved.get(0x20000104) == 3

# The report path retains a neutral packet until the USB endpoint accepts it.
ready(saved)
report(saved)
assert report(saved,{32:3000})[1] != NEUTRAL
saved.field("scan_error",1)
saved.time += 144000
saved.busy = 1
previous_count = len(saved.sent)
saved.call("gp_service")
assert len(saved.sent) == previous_count
saved.call("gp_service")
assert saved.sent[-1] == (3,NEUTRAL)

assert request(saved,0xd3,4,b'\0')[2] == 0
saved.field("vendor_pending",0)
saved.call("gp_usb_service")
saved.time += 101*144000
saved.call("gp_usb_service")
saved.time += 251*144000
saved.call("gp_usb_service")
assert saved.get(0x20000104) == 2
assert setup(saved,0x80,6,0x03ee,0,18)[0] == 0
assert reboot(saved_image(saved)).get(0x20000104) == 3
print("PASS scan failure and watchdog release guards, mixed output, profile isolation and settings persistence",flush=True)
