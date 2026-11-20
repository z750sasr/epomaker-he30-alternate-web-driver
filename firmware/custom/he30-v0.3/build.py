"""Build a pinned USB-only startup experiment. No device access or flashing.

The donor USB/clock implementation remains opaque hardware-dependent code.
The generated code is standard RV32I; verify.py exercises its real bytes.
"""
from pathlib import Path
import hashlib
import json
import struct

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parents[1] / 'reference/Zuoya-HE30-FD50-V115-20250707.bin'
SOURCE_HASH = '535cf2b0d2ff5f6e696da48659bbb249a2d7dd74df243eb5ee69baa2efe368d5'
NAME = 'Epomaker-HE30-EXPERIMENTAL-v0.3-USB-startup.bin'
ALIAS, CAVE, STATUS, GP = 0x5000, 0x19000, 0x20004000, 0x20000A30
REPORT = GP + 0x14C
HEADER = b'H3B1' + bytes([1, 0, 15, 0])
STAGES = {1: 'reset trampoline', 2: 'before donor SystemInit', 3: 'SystemInit returned',
          16: 'diagnostic main', 17: 'clock/delay setup returned', 18: 'USB clock setup returned',
          19: 'USB enable returned', 48: 'USB diagnostic loop', 64: 'OEM recovery requested',
          224: 'exception captured', 226: 'PLL ready timeout', 227: 'clock switch timeout',
          228: 'OEM recovery handler returned'}
CALLS = {0x78C6: 'donor SystemInit', 0x795E: 'SystemCoreClockUpdate',
         0x15E7E: 'delay factors', 0x52C0: 'USBHS clock setup',
         0x5412: 'USBHS enable', 0x5506: 'USB endpoint upload',
         0x67B0: 'EXPLICIT recovery only: donor boot-flag writer/reset'}

def sha(b): return hashlib.sha256(b).hexdigest()
def signed(n, bits):
    if not -(1 << (bits-1)) <= n < 1 << (bits-1): raise ValueError((n,bits))
    return n & ((1 << bits)-1)

class Assembler:
    def __init__(self, base=CAVE): self.base=base; self.words=[]; self.labels={}; self.fixups=[]
    @property
    def pc(self): return self.base+4*len(self.words)
    def emit(self,w): self.words.append(w)
    def label(self,n):
        if n in self.labels: raise ValueError(n)
        self.labels[n]=self.pc
    def imm(self,op,rd,f,rs,n): self.emit(signed(n,12)<<20 | rs<<15 | f<<12 | rd<<7 | op)
    def addi(self,rd,rs,n): self.imm(0x13,rd,0,rs,n)
    def andi(self,rd,rs,n): self.imm(0x13,rd,7,rs,n)
    def li(self,rd,n):
        n &= 0xffffffff; upper=(n+0x800)>>12; lower=n-(upper<<12)
        self.emit((upper&0xfffff)<<12|rd<<7|0x37); self.addi(rd,rd,lower)
    def load(self,rd,base,n=0,f=2): self.imm(3,rd,f,base,n)
    def lbu(self,rd,base,n=0): self.load(rd,base,n,4)
    def store(self,rs,base,n=0,f=2):
        imm=signed(n,12); self.emit((imm>>5)<<25|rs<<20|base<<15|f<<12|(imm&31)<<7|0x23)
    def sb(self,rs,base,n=0): self.store(rs,base,n,0)
    def op(self,rd,a,b,f=0): self.emit(b<<20|a<<15|f<<12|rd<<7|0x33)
    def branch(self,f,a,b,label): self.fixups.append((len(self.words),'b',label,f,a,b)); self.emit(0)
    def jump(self,label,rd=0): self.fixups.append((len(self.words),'j',label,rd,0,0)); self.emit(0)
    def ret(self): self.imm(0x67,0,0,1,0)
    def csr(self,rd,address): self.emit(address<<20|2<<12|rd<<7|0x73)
    def stage(self,n): self.li(5,STATUS); self.addi(6,0,n); self.sb(6,5,5)
    def finish(self):
        for i,k,target,f,a,b in self.fixups:
            target=self.labels[target] if isinstance(target,str) else target
            delta=target-(self.base+4*i)
            if delta&1: raise ValueError('Misaligned branch')
            if k=='b':
                n=signed(delta,13); w=((n>>12)&1)<<31|((n>>5)&63)<<25|b<<20|a<<15|f<<12|((n>>1)&15)<<8|((n>>11)&1)<<7|0x63
            else:
                n=signed(delta,21); w=((n>>20)&1)<<31|((n>>1)&1023)<<21|((n>>11)&1)<<20|((n>>12)&255)<<12|f<<7|0x6f
            self.words[i]=w
        return b''.join(struct.pack('<I',w) for w in self.words)

def jump_at(pc, target, rd=0):
    a=Assembler(pc); a.jump(target,rd); return a.finish()

def diagnostic_code():
    a=Assembler()
    # These routines use only reserved SRAM, stack, RCC/USB and standard CSRs.
    a.label('reset')
    a.li(5,STATUS); a.addi(6,0,64); a.addi(7,5,0)
    a.label('zero_status'); a.sb(0,7); a.addi(7,7,1); a.addi(6,6,-1); a.branch(1,6,0,'zero_status')
    a.li(6,int.from_bytes(HEADER[:4],'little')); a.store(6,5)
    a.addi(6,0,1); a.sb(6,5,4); a.sb(6,5,5)
    a.addi(6,0,15); a.sb(6,5,6)
    a.li(6,0x40021024); a.load(7,6); a.store(7,5,16)
    a.jump(0xAD06)

    a.label('system_init')
    a.addi(2,2,-16); a.store(1,2,12)
    a.stage(2); a.jump(0x78C6,1); a.stage(3)
    a.load(1,2,12); a.addi(2,2,16); a.ret()

    # Bound the donor's two indefinite ready waits without selecting new clocks.
    for label,reg,mask,wanted,resume,failure in [
        ('pll_wait',0x40021000,0x02000000,0x02000000,0x7C1A,226),
        ('clock_wait',0x40021004,12,8,0x7C4A,227)]:
        a.label(label); a.li(5,1000000); a.li(6,reg); a.li(7,mask); a.li(28,wanted)
        a.label(label+'_loop'); a.load(14,6); a.op(15,14,7,7)
        a.branch(0,15,28,label+'_ok'); a.addi(5,5,-1); a.branch(1,5,0,label+'_loop')
        a.stage(failure); a.jump('park')
        a.label(label+'_ok'); a.jump(resume)

    a.label('trap')
    a.li(5,STATUS); a.lbu(6,5,5); a.store(6,5,48)
    a.csr(6,0x342); a.store(6,5,36); a.csr(6,0x341); a.store(6,5,40)
    a.csr(6,0x300); a.store(6,5,44); a.addi(6,0,224); a.sb(6,5,5)
    a.label('park'); a.jump('park')

    a.label('main')
    a.stage(16)
    a.jump(0x795E,1); a.jump(0x15E7E,1); a.stage(17)
    a.jump(0x52C0,1); a.stage(18)
    a.addi(10,0,1); a.jump(0x5412,1); a.stage(19)
    a.li(8,STATUS); a.li(9,REPORT); a.stage(48)
    a.label('loop')
    a.load(5,8,8); a.addi(5,5,1); a.store(5,8,8)
    a.jump('request',1)
    # Only the vendor endpoint can transmit; no key, mouse or consumer reports.
    a.lbu(5,3,-0x7bc); a.branch(0,5,0,'loop')
    a.addi(10,0,2); a.addi(11,9,0); a.addi(12,0,64); a.addi(13,0,1); a.jump(0x5506,1)
    a.addi(5,0,1); a.branch(1,10,5,'loop'); a.sb(0,3,-0x7bc); a.jump('loop')

    a.label('request')
    a.lbu(5,3,-0x7c7); a.addi(6,0,1); a.branch(1,5,6,'return')
    a.lbu(5,3,-0x7bc); a.branch(1,5,0,'return')
    a.lbu(5,3,-0x7bd); a.branch(1,5,6,'return')
    a.sb(0,3,-0x7bd)
    a.load(5,8,12); a.addi(5,5,1); a.store(5,8,12)
    a.lbu(5,9,0); a.sb(5,8,7)
    a.lbu(5,3,-0x7bb); a.addi(6,0,64); a.branch(1,5,6,'reject')
    a.lbu(5,9,0); a.addi(6,0,0x5f); a.branch(0,5,6,'recovery')
    a.addi(6,0,0x55); a.branch(1,5,6,'reject')
    a.lbu(5,9,1); a.addi(6,0,3); a.branch(0,5,6,'version')
    a.addi(6,0,0xdc); a.branch(1,5,6,'reject')
    a.lbu(5,9,2); a.branch(1,5,0,'reject'); a.lbu(5,9,7); a.branch(1,5,0,'reject')
    a.lbu(10,9,4); a.lbu(11,9,5); a.lbu(5,9,6); a.branch(1,5,0,'reject')
    a.addi(5,0,56); a.branch(6,5,10,'reject')
    a.op(5,10,11); a.addi(6,0,64); a.branch(6,6,5,'reject')
    a.andi(5,5,255); a.lbu(6,9,3); a.branch(1,5,6,'reject')
    a.addi(12,0,0xdc); a.jump('status')

    a.label('version')
    # Accept only the same read-version request used by this driver.
    for offset,value in [(2,0),(3,32),(4,32),(5,0),(6,0),(7,0)]:
        a.lbu(5,9,offset); a.addi(6,0,value); a.branch(1,5,6,'reject')
    a.addi(10,0,32); a.addi(11,0,0); a.addi(12,0,3); a.jump('respond')

    a.label('status')
    # Snapshot read-only registers before copying the bounded status window.
    for address,offset in [(0x40021000,20),(0x40021004,24),(0x40023400,28),(0x20000230,32)]:
        a.li(5,address); a.load(6,5); a.store(6,8,offset)
    a.jump('respond')

    a.label('reject')
    a.lbu(12,9,1); a.addi(10,0,0); a.addi(11,0,0)
    a.addi(13,0,1); a.jump('fill')
    a.label('respond'); a.addi(13,0,0)
    a.label('fill')
    # Save all parameters in registers before clearing stale request bytes.
    a.addi(5,9,0); a.addi(6,0,64)
    a.label('clear_reply'); a.sb(0,5); a.addi(5,5,1); a.addi(6,6,-1); a.branch(1,6,0,'clear_reply')
    a.addi(5,0,0xaa); a.sb(5,9,0); a.sb(12,9,1); a.sb(13,9,2)
    a.sb(10,9,4); a.sb(11,9,5)
    a.addi(5,0,3); a.branch(0,12,5,'fill_version')
    a.op(5,8,11); a.addi(6,9,8); a.addi(7,10,0)
    a.branch(0,7,0,'checksum')
    a.label('copy_status'); a.lbu(28,5); a.sb(28,6); a.addi(5,5,1); a.addi(6,6,1); a.addi(7,7,-1); a.branch(1,7,0,'copy_status')
    a.jump('checksum')
    a.label('fill_version'); a.branch(1,13,0,'checksum'); a.addi(5,0,3); a.sb(5,9,9)
    a.label('checksum')
    a.op(5,10,11); a.addi(6,9,8); a.addi(7,10,0)
    a.branch(0,7,0,'checksum_done')
    a.label('sum'); a.lbu(28,6); a.op(5,5,28); a.addi(6,6,1); a.addi(7,7,-1); a.branch(1,7,0,'sum')
    a.label('checksum_done'); a.sb(5,9,3); a.addi(5,0,64); a.sb(5,3,-0x7bb)
    a.addi(5,0,1); a.sb(5,3,-0x7bc)
    a.label('return'); a.ret()

    a.label('recovery')
    # The only flash-writing path: accept exactly the owner's existing recovery
    # request, then invoke its unchanged donor handler. Not hardware validated.
    recovery=bytes.fromhex('5f0600520100000051')+bytes(55)
    for offset,value in enumerate(recovery):
        a.lbu(5,9,offset); a.addi(6,0,value); a.branch(1,5,6,'reject')
    a.addi(2,2,-16); a.store(1,2,12)
    a.stage(64); a.jump(0x67B0,1)
    a.load(1,2,12); a.addi(2,2,16); a.stage(228); a.jump('reject')
    return a.finish(),a.labels

def build():
    original=SOURCE.read_bytes()
    if sha(original)!=SOURCE_HASH: raise ValueError('Donor mismatch')
    image=bytearray(original); edits=[]
    def patch(offset,old,new,label):
        if original[offset:offset+len(old)]!=old or len(old)!=len(new): raise ValueError(label)
        image[offset:offset+len(new)]=new
        edits.append(dict(label=label,offset=hex(offset),old=old.hex(),new=new.hex()))
    code,labels=diagnostic_code()
    if len(code)>0x1000: raise ValueError('Cave overflow')
    if any(original[0x14000:0x15000]): raise ValueError('Cave is not empty')
    patch(0x14000,bytes(len(code)),code,'standard-RV32I startup diagnostic')
    patch(0,bytes.fromhex('6f507050'),jump_at(0x5000,labels['reset']),'reset breadcrumb trampoline')
    patch(0xAD80-ALIAS,bytes.fromhex('efc07fb4'),jump_at(0xAD80,labels['system_init'],1),'wrap SystemInit with SRAM stages')
    patch(0x787E-ALIAS,bytes.fromhex('411106c6'),jump_at(0x787E,labels['main']),'replace main with USB-only diagnostic')
    for slot,expected in [(2,0x52A8),(3,0x52B8)]:
        patch(0x38+slot*4,struct.pack('<I',expected),struct.pack('<I',labels['trap']),'NMI/HardFault capture')
    for lo,hi,label in [(0x7C0A,0x7C1A,'pll_wait'),(0x7C38,0x7C4A,'clock_wait')]:
        patch(lo-ALIAS,original[lo-ALIAS:hi-ALIAS],jump_at(lo,labels[label])+b'\x01\x00'*((hi-lo-4)//2),'bounded '+label)
    patch(0x122CE,b'\x50\xfd',b'\x4c\xfb','Epomaker USB PID')
    patch(0x1B002,b'\x50\xfd',b'\x4c\xfb','Epomaker onboard PID')
    patch(0x122D0,b'\x15\x01',b'\x00\x03','diagnostic USB release 0x0300')
    patch(0x122F4,b'\x0c\x03'+'HE 30'.encode('utf-16le'),b'\x0c\x03'+'H3B03'.encode('utf-16le'),'distinct diagnostic USB product')
    allowed=set()
    for e in edits: allowed.update(range(int(e['offset'],16),int(e['offset'],16)+len(bytes.fromhex(e['new']))))
    changed=[i for i,(x,y) in enumerate(zip(original,image)) if x!=y]
    assert len(image)==len(original)==155056 and set(changed)<=allowed
    manifest=dict(name=NAME,version='0.3 USB startup diagnostic',experimental=True,base_sha256=SOURCE_HASH,sha256=sha(image),
        bytes=len(image),changed_bytes=len(changed),usb_id='19F5:FB4C',product='H3B03',release='0x0300',
        code_va=hex(CAVE),code_file_offset='0x14000',code_bytes=len(code),status_ram=hex(STATUS),status_bytes=64,
        status_command='55/DC read-only, length <=56, offset+length <=64; H3B1 signature',
        labels={k:hex(v) for k,v in labels.items()},stages=STAGES,edits=edits,
        external_calls={hex(k):v for k,v in CALLS.items()},
        startup='Skip donor main, scan GPIO/ADC/DMA, RGB, calibration, persistent-settings initialization and key reporting. Retain donor reset/data/BSS, clock setup and USBHS IRQ/control implementation.',
        recovery='Only exact 64-byte 5F0600520100000051 + zero padding invokes the unchanged donor boot-flag writer/reset. This explicit path writes flash; not validated on Epomaker.',
        limitations=['Not a typing firmware or raw-scan firmware','No hardware validation; loader acceptance/placement still unknown','Donor USB/clock compatibility remains unproved','Full donor size retained to avoid an unverified truncation/flash-layout change','SRAM breadcrumbs require a probe if USB never starts','NMI/HardFault records cause/PC then parks; no automatic repair'],hardware_flashed=False)
    (HERE/NAME).write_bytes(image)
    (HERE/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps({k:manifest[k] for k in ['name','sha256','bytes','changed_bytes','code_bytes','product','hardware_flashed']},indent=2))
    return original,bytes(image),manifest

if __name__=='__main__': build()
