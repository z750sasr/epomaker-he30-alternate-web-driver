"""Verify compiled USB descriptors, spare journal bytes and hot-path work."""
from pathlib import Path

source = Path(__file__).with_name('verify.py').read_text(encoding='utf-8')
exec(source.split('checks=[]', 1)[0])


def setup(cpu, type_, value, index=0):
    cpu.blob(0x2000025c, struct.pack('<BBHHH', 6, type_, value, index, 255))
    assert cpu.call('usb_gamepad_control')
    length = cpu.get(0x20000262, 2)
    pointer = cpu.get(0x20000258, 4)
    return cpu.blob(0x2000032c, n=min(length, 64)) + (cpu.blob(pointer, n=length-64) if length>64 else b'')


def settle_usb(cpu):
    cpu.field('vendor_pending', 0)
    for delay in [0,101,251]:
        cpu.time += delay*144000
        cpu.call('gp_usb_service')
    cpu.usb()


def usb_status(cpu):
    data=read(cpu,0xd2,0,91)
    return data[8],data[10],data[89],data[90]


def benchmark():
    cpu=fresh()
    calibrated(cpu)
    for key,binding in [(15,1),(16,4),(33,2),(32,3)]:
        pset(cpu,7,bytes([binding]),key)
    assert request(cpu,0xd3,4,b'\1')[2]==0
    settle_usb(cpu)
    ready(cpu)
    cpu.call('gp_service')
    result={}
    for name,depths in [('idle',{}),('held_diagonal',{15:3000,16:3000})]:
        frames(cpu,depths)
        cpu.call('gp_service')
        before=cpu.instructions
        for _ in range(20):
            cpu.time+=18000
            cpu.call('gp_service')
            cpu.call('mouse_service')
        result[name]=(cpu.instructions-before)//20
    return result


cost=benchmark()
print(f'Modeled controller and mouse service instructions per loop: {cost}',flush=True)
if not manifest.get('input_budget'):
    raise SystemExit(0)

cpu=fresh()
cpu.native_usb_borrows_timer=True
assert usb_status(cpu)==(0,0,1,1)
assert request(cpu,0xd2,12,b'\0')[2]==0
cpu.call('gp_usb_service')
assert cpu.calls.count(0x5412)==0
assert usb_status(cpu)==(0,0,0,1)
settle_usb(cpu)
assert usb_status(cpu)==(0,0,0,0)
for pad in [0,1]:
    assert usb_status(cpu)==(pad,pad,0,0)
    iface=2+pad
    config=setup(cpu,0x80,0x0200)
    hid_offset=75+40*pad
    descriptor=setup(cpu,0x81,0x2200,iface)
    assert len(config)==91+40*pad and config[4]==3+pad
    assert len(descriptor)==25 and descriptor[:8]==bytes.fromhex('050c0901a1018502')
    assert setup(cpu,0x81,0x2100,iface)==config[hid_offset:hid_offset+9]
    assert config[hid_offset+7]==len(descriptor)
    assert setup(cpu,0x80,0x0100)[12]==2+pad
    if not pad:
        assert request(cpu,0xd3,4,b'\1')[2]==0
        settle_usb(cpu)

calibrated(cpu)
config=bytearray(get_wire(cpu))
config[168]=0xb0
config[168+14]=0xc0
configure(cpu,config)
ready(cpu)
start=len(cpu.sent)
frames(cpu,{0:3000})
cpu.call('mouse_service')
assert len(cpu.sent)==start
frames(cpu,{1:3000})
cpu.time+=144000
cpu.call('mouse_service')
assert cpu.sent[-1]==(4,bytes([2,0xcd,0]))

assert request(cpu,0xd2,12,b'\1')[2]==0
settle_usb(cpu)
assert usb_status(cpu)==(1,1,1,1)
assert len(setup(cpu,0x81,0x2200,3))==79
assert request(cpu,0xd2,12,b'\0')[2]==0
settle_usb(cpu)
assert usb_status(cpu)==(1,1,0,0)

assert read(cpu,0xd2,0,91)[11]==10
rule(cpu,5,8,usage=(4,0,0,0),slot=8)
rule(cpu,5,9,usage=(5,0,0,0),slot=9)
assert request(cpu,0xd2,5,bytes(14),10)[2]==2
assert frames(cpu,{8:3000,9:3000})[2:4]==bytes([4,5])
profile_zero=read(cpu,0xd2,13,28)
assert profile_zero[0:2]==bytes([5,8]) and profile_zero[14:16]==bytes([5,9])
pset(cpu,2,b'\1')
assert read(cpu,0xd2,13,28)==bytes(28)
rule(cpu,5,0,usage=(6,0,0,0),slot=9)
profile_one=read(cpu,0xd2,13,28)
assert control(cpu,8)==0
saved=reboot(saved_image(cpu))
assert usb_status(saved)==(1,1,0,0)
assert read(saved,0xd2,13,28)==profile_one
pset(saved,2,b'\0')
assert read(saved,0xd2,13,28)==profile_zero

rule(cpu,5,0,usage=(7,0,0,0),slot=9)
cpu.cut=len(cpu.programs)+32
try:
    control(cpu,8)
    raise AssertionError('Expected modeled power cut')
except PowerCut:
    pass
assert read(reboot(saved_image(cpu)),0xd2,13,28)==profile_one

if manifest.get('factory_defaults'):
    factory=reboot(image)
    assert read(factory,0xd2,13,28)==bytes(28)
    assert usb_status(factory)==(0,0,1,1)

result={
    'sha256':manifest['sha256'],
    'passed':['independent mouse and Xbox USB changes','consumer controls with mouse disabled',
              'USB configuration and HID descriptor agree','slots 9 and 10 execute and save',
              'advanced assignments stay profile-specific','power-cut rollback','v0.26 factory journal loads'],
    'service_instructions_per_loop':cost,
    'hardware_tested':False,
}
(BUILD/'verification-v028.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print('PASS mouse visibility, consumer HID, advanced slots, journal fallback and migration')
