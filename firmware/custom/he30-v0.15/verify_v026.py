"""Check v0.26 factory defaults, both USB configurations and RGB sleep."""
from pathlib import Path

exec(Path(__file__).with_name('verify.py').read_text(encoding='utf-8').split('\nchecks=[]', 1)[0])
assert manifest['usb_lighting_fix']
checks = []


def check(text):
    print('PASS '+text, flush=True)
    checks.append(text)


def setup(cpu, kind, op, value, index, size):
    cpu.blob(0x2000025c, struct.pack('<BBHHH', op, kind, value, index, size))
    assert cpu.call('usb_gamepad_control') == 1
    length = cpu.get(0x20000262, 2)
    first = cpu.blob(0x2000032c, n=min(length, 64))
    return first+cpu.blob(cpu.get(0x20000258, 4), n=max(length-64, 0))


def led(cpu, ms=0):
    cpu.time+=ms*144000
    for _ in range(8):
        cpu.call('rgb_service')
    return read(cpu,0xd1,8,123)


def preferences(cpu, slot=0):
    b=request(cpu,0xd1,11,off=slot,length=4)
    assert b[2]==0
    return b[8:12]


if manifest.get('factory_defaults'):
    source=(HERE/'v026-defaults.json').read_bytes()
    assert hashlib.sha256(source).hexdigest()==manifest['factory_source_sha256']
    snapshot=json.loads(source)
    factory=reboot(image)
    assert read(factory,0xd2,0,89)[5:11]==bytes([snapshot['active'],3,0,0,3,0])
    for slot in snapshot['profiles']:
        index=slot['slot']
        pset(factory,2,bytes([index]))
        assert read(factory,0xd2,1,976)==bytes.fromhex(slot['profile'])
        assert get_wire(factory)[8:160]==bytes(152)
        assert preferences(factory,index)==bytes([50,0,0,0])
        for layer,palette in enumerate(slot['fn']):
            base=(index*2+layer)*128
            data=request(factory,0xd1,9,off=base,length=55)[8:63]
            data+=request(factory,0xd1,9,off=base+55,length=18)[8:26]
            assert data==bytes.fromhex(palette)
    check('All four captured profiles and eight Fn palettes load byte-for-byte without calibration')

usb=fresh()
def endpoint_reset(state,pc):
    if pc==symbols['usb_endpoint_init_hook']:
        state.r[2]-=16
    return pc==0x540c
usb.call('usb_endpoint_init_hook',stop=endpoint_reset,limit=1000)
tx4=0x40023458+4*4  # Exact address derived from native upload at 0x561E.
assert usb.get(tx4,4)==0x200036d8
assert not usb.get(tx4+4,4)
assert usb.get(0x40023428,4)==0x200036e0
assert usb.get(0x400234ea)==2
for pad in [0,1]:
    usb.put(0x20000104,2+pad)
    configuration=setup(usb,0x80,6,0x0200,0,255)
    assert len(configuration)==91+40*pad
    mouse=66+40*pad
    assert configuration[mouse:mouse+9]==bytes([9,4,2+pad,0,1,3,0,0,0])
    assert configuration[mouse+18:mouse+25]==bytes([7,5,0x84,3,5,0,4])
    report=setup(usb,0x81,6,0x2200,2+pad,255)
    assert len(report)==79 and report[6:8]==bytes([0x85,1])
    assert bytes.fromhex('050c0901a1018502') in report
    assert report[-1]==0xc0
    if pad:
        assert configuration[66:75]==bytes.fromhex('0904020002ff5d0100')
        assert setup(usb,0xc0,0x20,0,4,255)[16:18]==bytes([2,1])
check('Native TX4 uses its own eight bytes and XInput stays at interface 2 with media enabled')

calibrated(usb)
config=bytearray(get_wire(usb))
for key,usage in enumerate([0xb0,0xc0,0xce,0xc5]):
    config[168+14*key]=usage
configure(usb,config);ready(usb)
def report(keys,expected):
    assert frames(usb,keys)==bytes(8)
    usb.time+=144000;usb.call('mouse_service')
    assert usb.sent[-1]==(4,expected)
report({0:3000},bytes([1,1,0,0,0]))
report({},bytes([1,0,0,0,0]))
report({1:3000},bytes([2,0xcd,0]))
report({},bytes([2,0,0]))
report({2:3000},bytes([2,0xa2,2]))
report({3:3000},bytes([2,0xe9,0]))
report({},bytes([2,0,0]))
assert read(usb,0xd0,0,208)[:5]==b'H3K1\1'
check('Mouse clicks and consumer press/release coexist with keyboard and vendor traffic')

rgb=fresh();calibrated(rgb);rgb.field('rgb_path',1)
plain=led(rgb)
assert plain==bytes([16])*123
assert request(rgb,0xd1,12,b'\x65\0\1\0')[2]==2
assert request(rgb,0xd1,12,b'\x32\1\1\0',off=1)[2]==3
assert request(rgb,0xd1,12,b'\x32\1\1\0')[2]==0
assert led(rgb)==plain
assert led(rgb,500)==plain
assert led(rgb,600)==bytes(108)+plain[108:]
frames(rgb,{0:3000})
assert led(rgb)==plain
frames(rgb)
assert request(rgb,0xd1,12,b'\x32\0\1\0')[2]==0
assert led(rgb)==plain
assert led(rgb,1100)==bytes(123)
frames(rgb,{0:3000});led(rgb);frames(rgb)
header=bytearray(read(rgb,0xd1,0,160)[16:28]);header[1]=5
assert request(rgb,0xd1,1,header)[2]==0
assert request(rgb,0xd1,12,b'\0\0\0\0')[2]==0
still=led(rgb,60)
assert led(rgb,300)==still
assert request(rgb,0xd1,12,b'\x64\0\0\0')[2]==0
assert led(rgb,180)!=still
assert control(rgb,8)==0
saved=reboot(saved_image(rgb))
assert preferences(saved)==b'\x64\0\0\0' and preferences(saved,1)==b'\x32\0\0\0'
check('RGB sleep and wake, keep-lightbar option, speed zero and speed persistence work per profile')

(BUILD/'verification-v026.json').write_text(json.dumps(dict(sha256=manifest['sha256'],checks=checks,hardware_tested=False),indent=2))
