"""Run the compiled v0.25 shortcuts, lightbar effects and USB mouse paths."""
from pathlib import Path

exec(Path(__file__).with_name('verify.py').read_text(encoding='utf-8').split('\nchecks=[]', 1)[0])
assert manifest['desktop_keys']


def setup(cpu, kind, op, value, index, size):
    cpu.blob(0x2000025c, struct.pack('<BBHHH', op, kind, value, index, size))
    assert cpu.call('usb_gamepad_control') == 1
    length = cpu.get(0x20000262, 2)
    first = cpu.blob(0x2000032c, n=min(length, 64))
    return first+cpu.blob(cpu.get(0x20000258, 4), n=max(length-64, 0))


def collect_rgb(cpu, at=None):
    if at is not None:
        cpu.time = at
    for _ in range(7):
        cpu.call('rgb_service')
    return read(cpu, 0xd1, 8, 123)


def map_keys(cpu, bindings):
    config = bytearray(get_wire(cpu))
    for key, code in bindings.items():
        config[168+14*key] = code
    configure(cpu, config)
    ready(cpu)


cpu = fresh()
for controller in [0, 1]:
    cpu.put(0x20000104, 2+controller)
    descriptor = setup(cpu, 0x80, 6, 0x0200, 0, 255)
    assert len(descriptor) == (131 if controller else 91)
    assert descriptor[4] == 3+controller
    assert descriptor[66:75] == bytes([9,4,2,0,1,3,0,0,0])
    assert descriptor[84:91] == bytes([7,5,0x84,3,4,0,4])
    assert descriptor[57:66][-7:] == bytes([7,5,4,3,64,0,1])
    report = setup(cpu, 0x81, 6, 0x2200, 2, 255)
    hid = setup(cpu, 0x81, 6, 0x2100, 2, 9)
    assert len(report) == hid[7] == 52 and report[:8] == bytes.fromhex('05010902a1010901')
    assert report[-2:] == bytes.fromhex('c0c0')
    assert setup(cpu, 0x21, 10, 0, 2, 0) == b''

cpu.put(0x400234ea, 0)
cpu.put(0x400234eb, 0x18)
cpu.put(0x20000b70, 1)
cpu.native_test_ranges = ((0x57f2,0x57f6),)
def mouse_irq(state,pc):
    if pc == 0x57f2:
        state.r[15] = 0x24
    return pc == 0x5b98
cpu.call(0x57f2, stop=mouse_irq, limit=100)
assert cpu.get(0x400234ea)==10 and cpu.get(0x400234eb)==0x18 and not cpu.get(0x20000b70)
print('PASS Dedicated EP4 IN descriptor and native mouse IRQ leave vendor EP4 OUT independent', flush=True)

calibrated(cpu)
map_keys(cpu, {index:0xb0+index for index in range(11)})
pset(cpu,10,b'\x07')
def mouse(depths, expected):
    assert frames(cpu, depths) == bytes(8)
    cpu.time += 144000
    cpu.call('mouse_service')
    assert cpu.sent[-1] == (4, bytes(expected))

mouse({key:3000 for key in [0,1,2,3,4,5,8,9]}, [31,7,249,1])
mouse({key:3000 for key in [0,5,8,9]}, [1,7,249,0])
mouse({key:3000 for key in [6,7,10]}, [0,249,7,255])
mouse({0:3000}, [1,0,0,0])
frames(cpu)
cpu.busy=1
cpu.time+=144000
cpu.call('mouse_service')
assert cpu.sent[-1][1][0]==1
cpu.call('mouse_service')
assert cpu.sent[-1]==(4,bytes(4))
print('PASS Five mouse buttons, wheel directions, relative movement, speed and release retry', flush=True)

rgb = fresh()
calibrated(rgb)
rgb.field('rgb_path',1)
for profile in range(4):
    pset(rgb,2,bytes([profile]))
    map_keys(rgb,{2:0xf5,3:0xf6})
pset(rgb,2,b'\0')
for layer,key in [(0,1),(1,5),(2,6)]:
    pset(rgb,11,bytes([layer]),key)
for profile in range(4):
    pset(rgb,2,bytes([profile]))
    assert get_wire(rgb)[168+14]==0xf4
    assert get_wire(rgb)[169+14*5]==0xf4
    assert read(rgb,0xd2,1,976)[632+6]==0xf4
pset(rgb,2,b'\0')
ready(rgb)
for profile in [1,2,3,0]:
    assert frames(rgb,{1:3000})==bytes(8)
    assert read(rgb,0xd2,0,89)[5]==profile
    assert frames(rgb,{1:3000})==bytes(8)
    assert read(rgb,0xd2,0,89)[5]==profile
    ready(rgb)
start=rgb.time
for time,level in [(35,20),(140,0),(260,20),(390,0),(480,16)]:
    assert collect_rgb(rgb,start+time*144000)[:108]==bytes([level])*108
for code,level in [(3,99),(2,100),(2,100)]:
    frames(rgb,{code:3000},n=40)
    assert read(rgb,0xd2,0,89)[88]==level
    ready(rgb)
print('PASS One-step brightness, four-slot wraparound, held-key interlock and exactly two RGB blinks', flush=True)

def set_bar(flags):
    header=bytearray(read(rgb,0xd1,0,160)[16:28])
    header[4]=flags
    assert request(rgb,0xd1,1,header)[2]==0

set_bar(5)
static=collect_rgb(rgb)[108:]
assert static==bytes([16])*15
set_bar(0x80|8|5)
low=collect_rgb(rgb,2560*144000)[108:]
high=collect_rgb(rgb,3840*144000)[108:]
assert low != high and high==bytes([15])*15
set_bar(0x80|8|32|5)
rainbow=collect_rgb(rgb,6400*144000)[108:]
assert rainbow[0:3]!=high[0:3] and len(set(rainbow))>1
set_bar(0x80|16|5)
wave=collect_rgb(rgb,7000*144000)[108:]
set_bar(0x80|16|64|5)
reverse=collect_rgb(rgb,7000*144000)[108:]
assert reverse==b''.join(wave[i:i+3] for i in range(12,-1,-3))
set_bar(0x80|24|5)
a=collect_rgb(rgb,7100*144000)[108:]
b=collect_rgb(rgb,7500*144000)[108:]
assert a!=b and b==b[:3]*5
pset(rgb,10,b'\x20')
assert control(rgb,8)==0
restored=reboot(saved_image(rgb))
assert read(restored,0xd1,0,160)[20:22]==bytes([0x80|24|5,63])
print('PASS Independent static, breathing, reversible wave and 24-bit spectrum lightbar settings survive Save', flush=True)

powered = fresh()
powered.call('firmware_main', stop=lambda state,_:state.field('frames',size=4)>=2)
start=powered.time
first=collect_rgb(powered,start+40*144000)[:108]
next_frame=collect_rgb(powered,start+160*144000)[:108]
assert first!=next_frame and any(first) and any(next_frame)
assert collect_rgb(powered,start+400*144000)[:108]==bytes([16])*108
print('PASS Power-on sweep moves across the key chain, then restores the profile', flush=True)
