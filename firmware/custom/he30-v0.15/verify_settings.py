"""Check live rate updates, flash timing, saved RGB colors and LED retry."""
from pathlib import Path

source = Path(__file__).with_name("verify.py").read_text(encoding="utf-8")
exec(source.split("checks=[]", 1)[0])

class FlashClockCPU(CPU):
    def put(self, a, v, n=1):
        if 0x0801e000 <= a < 0x08020000 or (a == 0x40022010 and v & 0x20040 == 0x20040):
            assert self.regs[0x40021004] & 0xf0 == 0x90, "Flash write at full clock"
            assert not self.regs[0x40022010] & (1<<24), "Enhanced read active during programming"
            mask = 0x88 if self.user_mode else 8
            assert not self.csr[0x300] & mask, "Flash write with interrupts enabled"
            assert writer_bounds[0]<=self.pc<writer_bounds[1], "Flash operation outside the linked writer region"
        super().put(a, v, n)

class LockedFlashCPU(FlashClockCPU):
    """Model the lock-sensitive mode and the separate active-mode status bit."""
    def put(self,address,value,size=1):
        if address==0x40022010:
            old=self.regs.get(address,0)
            if old&0x8080:
                value=(value&~(1<<24))|(old&(1<<24))
            if old&0x80:
                value&=~(1<<22)
            if value&(1<<24):
                self.regs[0x40022000]=0x80
            elif value&(1<<22):
                self.regs[0x40022000]=0
            value&=~(1<<22)
            if value&0x20040==0x20040:
                assert not self.regs.get(0x40022000,0)&0x80, "Erase with enhanced read still active"
        super().put(address,value,size)

c = fresh()
c.__class__ = FlashClockCPU
calibrated(c)
held = frames(c,{32:2000})
assert 4 in held[2:]
releases = c.field('release_pending')
usb_calls = list(c.calls)
pset(c,8,bytes([6,0,0]))
assert read(c,0xd2,0,88)[6:10] == bytes([6,0,0,0])
assert read(c,0xd2,0,88)[14] == 0
assert c.blob(S+layout['report'],n=8)==held and c.field('release_pending')==releases
assert c.calls.count(0x5412)==usb_calls.count(0x5412)
print("PASS Polling changes live without restarting USB or releasing a held key",flush=True)
c = fresh()
c.__class__ = LockedFlashCPU if manifest.get('flash_lock_fix') else FlashClockCPU
pset(c,8,bytes([6,2,0]))
assert read(c,0xd2,0,88)[6:10] == bytes([6,2,0,0])
assert read(c,0xd2,0,88)[14] == 0
assert control(c,10) == 0
assert read(c,0xd2,0,88)[14] == 2
clock = c.get(0x40021004,4)
# Fifty percent keys and twenty-five percent strip; the low order/rate bits stay intact.
assert request(c,0xd1,1,bytes([1,2,101,151,5,1,20,9,1,3,12,24]))[2] == 0
assert request(c,0xd1,1,bytes([1,2,202,151,5,1,20,9,1,3,12,24]))[2] == 2
assert request(c,0xd1,2,bytes([15,32,0,16,32,0,32,2]))[2] == 0
lighting = read(c,0xd1,0,160)[16:144]
c.regs[0x40022010] = c.regs.get(0x40022010,0) | (1<<24)
if manifest.get('flash_lock_fix'):
    c.regs[0x40022010]|=0x8080
    c.regs[0x40022000]=0x80
if c.user_mode:
    c.csr[0x300]=0x6088
assert control(c,8) == 0
if c.user_mode:
    assert c.csr[0x300]==0x6088
    print("PASS U-mode Save masks and restores both interrupt bits through GINTENR",flush=True)
if FLASH_RESIDENT_SAVE:
    assert c.flash_read_protected
    print("PASS Fast erase and program run from zero-wait flash with read protection enabled",flush=True)
    assert c.flash_buffer_busy
    print("PASS Buffer loads wait for WRBSY even while BSY stays set until program",flush=True)
assert c.regs[0x40022010] & (1<<24)
if manifest.get('flash_lock_fix'):
    assert c.regs[0x40022010]&0x8080==0x8080
    assert c.regs[0x40022000]&0x80
    print("PASS Enhanced-read exit occurs after unlock and restoration occurs before relocking",flush=True)
assert c.get(0x40021004,4) == clock
assert c.csr[0x300]&8
assert len(c.programs) == 1024+192*FN_RGB and len(c.erases) == 16+3*FN_RGB
assert c.programs[-1] == 0x0801effc, "Commit row must be last"
saved = reboot(saved_image(c))
assert read(saved,0xd2,0,88)[6:10] == bytes([6,2,0,0])
assert control(saved,10) == 0
assert read(saved,0xd2,0,88)[14] == 2
assert read(saved,0xd1,0,160)[16:144] == lighting
print("PASS Applied polling pace and scanner mode, saved rates and RGB across reboot, restored flash clock",flush=True)

if DIAGNOSTICS:
    assert struct.unpack('<7I',c.blob(SAVE_TRACE,n=28))[:3]==(0x31533348,11,0x0801ef00)
    class CorruptPageCPU(FlashClockCPU):
        def put(self,address,value,size=1):
            super().put(address,value,size)
            if address==0x40022010 and value&0x210000==0x210000 and len(self.programs)==64:
                row=self.erases[-1]
                self.flash[self.physical(row)]^=1

    retry=reboot(saved_image(c))
    retry.__class__=CorruptPageCPU
    retry_clock=retry.get(0x40021004,4)
    pset(retry,8,bytes([2,1,0]))
    assert control(retry,8)==9
    assert retry.erases==[FN_PAGES[1] if FN_RGB else 0x0801f000], "Verification failure must stop before committing a new journal"
    trace=struct.unpack('<7I',retry.blob(SAVE_TRACE,n=28))
    assert trace[1:3]==(10,FN_PAGES[1] if FN_RGB else 0x0801f000) and trace[5:]==(9,9)
    assert retry.csr[0x300]&8 and retry.get(0x40021004,4)==retry_clock
    preserved=reboot(saved_image(retry))
    assert read(preserved,0xd2,0,88)[6:10]==bytes([6,2,0,0])
    assert read(preserved,0xd1,0,160)[16:144]==lighting
    print("PASS A failed page readback records the stage and keeps the earlier journal bootable",flush=True)

# Fail the first LED transfer after applying RGB. No new write occurs during retry.
saved.field('rgb_path',1) # RGB boot starts with the lightbar pending.
saved.fail='dma'
saved.call('rgb_service')
assert saved.field('rgb_state') == 1
path = saved.field('rgb_path')
saved.time += 21*144000
saved.call('rgb_service')
assert saved.field('rgb_error') & path and saved.field('rgb_pending') & path
saved.fail=None
for _ in range(8):
    saved.time += 144000
    saved.call('rgb_service')
status = read(saved,0xd1,0,160)
pixels = read(saved,0xd1,8,123)
assert status[5] == 0 and status[8] and status[12]
assert pixels[45:48] == bytes([16,0,8])
assert pixels[96:99] == bytes([0,16,1])
assert pixels[108:] == bytes([1,3,6])*5
print("PASS Both RGB chains send independently dimmed colors after one failed DMA frame",flush=True)

assert request(saved,0xd1,1,bytes([1,4,200,0,5,1,20,9,1,3,12,24]))[2] == 0
for _ in range(8):
    saved.time += 10*144000
    saved.call('rgb_service')
pixels = read(saved,0xd1,8,123)
assert not any(pixels[:108]), 'Zero keyboard brightness must mute animated effects'
assert pixels[108:] == bytes([3,12,24])*5, 'Keyboard brightness must not dim the strip'
print("PASS Zero brightness mutes the keyboard wave while leaving the strip at full intensity",flush=True)


# Produce the default journal template used by the recovery rate selector.
factory = fresh()
pset(factory,8,bytes([3,0,0]))
assert control(factory,8) == 0
record = bytearray(saved_image(factory)[0x19000:0x1a000])
assert len(record)==4096 and record[16:20]==bytes([0,3,0,0])
if FN_RGB:
    # A preconfigured install has no Fn palettes yet. Ship a self-contained
    # v5 record and let the first onboard Save migrate it to a paired record.
    struct.pack_into('<I',record,4,5)
    struct.pack_into('<I',record,12,zlib.crc32(record[4:12]+record[16:4092]))
    initial=bytearray(image)
    initial[0x19000:0x1a000]=record
    assert read(reboot(initial),0xd2,0,88)[6:10]==bytes([3,0,0,3])
(BUILD/'factory-journal.bin').write_bytes(record)
