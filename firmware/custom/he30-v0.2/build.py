"""Pinned Zuoya V115 -> experimental HE30 layout + bounded raw ADC endpoint.

No toolchain required: the small leaf hook uses standard RV32I encodings.
No hardware/USB access. Run verify.py after building.
"""
from pathlib import Path
import hashlib
import json
import struct

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parents[1] / 'reference/Zuoya-HE30-FD50-V115-20250707.bin'
SOURCE_HASH = '535cf2b0d2ff5f6e696da48659bbb249a2d7dd74df243eb5ee69baa2efe368d5'
ALIAS = 0x5000
CAVE = 0x19000
RETURN = 0x7634
TABLE = 0x16DDC
RAW_ADC = 0x200032CC  # V115 ADC1 DMA setup, NOT V110's 0x200032D0.
REPORT_GP = 0x14C   # V115 report buffer = gp + 0x14C.
HEADER = b'H3D1' + bytes([36, 3, 12, 1])
NAME = 'Epomaker-HE30-EXPERIMENTAL-v0.2-Zuoya115.bin'

def sha(data): return hashlib.sha256(data).hexdigest()
def signed(n, width):
    if not -(1 << (width-1)) <= n < 1 << (width-1): raise ValueError((n,width))
    return n & ((1 << width)-1)

class Assembler:
    def __init__(self): self.words=[]; self.labels={}; self.fixups=[]
    @property
    def pc(self): return CAVE+4*len(self.words)
    def emit(self,w): self.words.append(w)
    def label(self,name): self.labels[name]=self.pc
    def i(self,opcode,rd,f3,rs,imm): self.emit(signed(imm,12)<<20 | rs<<15 | f3<<12 | rd<<7 | opcode)
    def addi(self,rd,rs,n): self.i(0x13,rd,0,rs,n)
    def li(self,rd,n):
        upper=(n+0x800)>>12; lower=n-(upper<<12)
        self.emit((upper&0xfffff)<<12 | rd<<7 | 0x37); self.addi(rd,rd,lower)
    def lbu(self,rd,rs,n): self.i(3,rd,4,rs,n)
    def sb(self,rs,base,n):
        imm=signed(n,12); self.emit((imm>>5)<<25 | rs<<20 | base<<15 | (imm&31)<<7 | 0x23)
    def op(self,rd,a,b,f3=0): self.emit(b<<20 | a<<15 | f3<<12 | rd<<7 | 0x33)
    def branch(self,f3,a,b,label): self.fixups.append((len(self.words),'branch',label,f3,a,b)); self.emit(0)
    def jump(self,label): self.fixups.append((len(self.words),'jump',label,0,0,0)); self.emit(0)
    def finish(self):
        for i,kind,target,f3,a,b in self.fixups:
            dest=self.labels[target] if isinstance(target,str) else target
            delta=dest-(CAVE+i*4)
            if delta%2: raise ValueError('Unaligned branch')
            if kind=='branch':
                n=signed(delta,13); self.words[i]=((n>>12)&1)<<31 | ((n>>5)&63)<<25 | b<<20 | a<<15 | f3<<12 | ((n>>1)&15)<<8 | ((n>>11)&1)<<7 | 0x63
            else:
                n=signed(delta,21); self.words[i]=((n>>20)&1)<<31 | ((n>>1)&1023)<<21 | ((n>>11)&1)<<20 | ((n>>12)&255)<<12 | 0x6f
        return b''.join(struct.pack('<I',w) for w in self.words)

def diagnostic_hook():
    a=Assembler()
    # t0=report, t1=remaining length, t2=logical source offset.
    a.addi(5,3,REPORT_GP); a.lbu(6,5,4); a.lbu(7,5,5); a.lbu(28,5,6)
    a.i(0x13,28,1,28,8); a.op(7,7,28,6)
    a.addi(28,0,56); a.branch(6,28,6,'bad')  # unsigned length >56
    a.addi(28,0,80); a.branch(6,28,7,'bad')  # offset >80
    a.op(29,7,6); a.branch(6,28,29,'bad')     # offset+length >80
    a.sb(0,5,2); a.sb(0,5,7); a.addi(29,5,8)
    a.branch(0,6,0,'done')
    a.label('loop'); a.addi(30,0,8); a.branch(7,7,30,'raw')
    a.fixups.append((len(a.words),'address','header',0,0,31)); a.emit(0); a.emit(0)
    a.op(31,31,7); a.lbu(10,31,0); a.jump('store')
    a.label('raw'); a.li(31,RAW_ADC); a.addi(30,7,-8); a.op(31,31,30); a.lbu(10,31,0)
    a.label('store'); a.sb(10,29,0); a.addi(29,29,1); a.addi(7,7,1); a.addi(6,6,-1); a.branch(1,6,0,'loop')
    a.label('done'); a.jump(RETURN)
    a.label('bad'); a.addi(28,0,1); a.sb(28,5,2); a.sb(0,5,4); a.jump(RETURN)
    a.label('header')
    # Resolve the two-instruction constant load before ordinary control fixups.
    ordinary=[]
    for i,kind,target,f3,r1,rd in a.fixups:
        if kind!='address': ordinary.append((i,kind,target,f3,r1,rd)); continue
        value=a.labels[target]; upper=(value+0x800)>>12; lower=value-(upper<<12)
        a.words[i]=(upper&0xfffff)<<12 | rd<<7 | 0x37
        a.words[i+1]=signed(lower,12)<<20 | rd<<15 | rd<<7 | 0x13
    a.fixups=ordinary
    return a.finish()+HEADER,a.labels

def build():
    original=SOURCE.read_bytes()
    if sha(original)!=SOURCE_HASH: raise ValueError('Wrong donor image; patch offsets are V115-specific.')
    image=bytearray(original); edits=[]
    def patch(offset,expected,replacement,label):
        if original[offset:offset+len(expected)]!=expected or len(expected)!=len(replacement): raise ValueError(f'Patch precondition: {label} at {offset:#x}')
        image[offset:offset+len(expected)]=replacement
        edits.append({'label':label,'offset':hex(offset),'old':expected.hex(),'new':replacement.hex()})
    bases=[0x12DB8,0x1C400,0x1CC00,0x1D400,0x22DB0,0x235B0,0x23DB0]
    template=original[bases[0]:bases[0]+78]
    for base in bases:
        if original[base:base+78]!=template: raise ValueError('Unexpected main/default map')
        if original[base+78:base+80]!=b'\xf0\xff': raise ValueError('Unexpected Fn record')
        for slot,usage in enumerate([0x35,0x3a,0x3b,0x3c,0x3d,0x3e,0x3f],29):
            patch(base+3*slot,b'\x10\x00\x00',bytes([0x10,0,usage]),f'main slot {slot}')
    # Keep donor PID FD50 and release0115. Change its product string (five UTF16 chars).
    patch(0x122F4,b'\x0c\x03'+'HE 30'.encode('utf-16le'),b'\x0c\x03'+'H3D02'.encode('utf-16le'),'experimental USB product')
    code,labels=diagnostic_hook()
    if len(code)>1024: raise ValueError('Hook exceeds reserved cave')
    patch(CAVE-ALIAS,bytes(len(code)),code,'read-only raw ADC hook in padding')
    entry=TABLE-ALIAS+0xDB*4
    patch(entry,struct.pack('<I',0x762e),struct.pack('<I',CAVE),'DB dispatch from default case')
    # Establish the exact allowed-difference set before output.
    permitted=set()
    for e in edits: permitted.update(range(int(e['offset'],16),int(e['offset'],16)+len(bytes.fromhex(e['new']))))
    changed=[i for i,(x,y) in enumerate(zip(original,image)) if x!=y]
    if not set(changed)<=permitted or len(image)!=len(original): raise ValueError('Unexpected output mutation')
    (HERE/NAME).write_bytes(image)
    manifest={'name':NAME,'base':'Zuoya HE30 FD50 V115 / Jul7 2025','base_sha256':SOURCE_HASH,'sha256':sha(image),'bytes':len(image),'changed_bytes':len(changed),
      'usb_id':'19F5:FD50','product':'H3D02','release':'0x0115 retained','new_command':'55/DB read-only, maximum56 payload bytes, bounded80-byte logical source',
      'diagnostic_header':HEADER.hex(),'raw_adc_address':hex(RAW_ADC),'raw_adc_bytes':72,'report_offset_from_gp':hex(REPORT_GP),
      'code_va':hex(CAVE),'code_file_offset':hex(CAVE-ALIAS),'code_bytes':len(code),'return_va':hex(RETURN),'labels':{k:hex(v) for k,v in labels.items()},'edits':edits,
      'retained':['Donor clocks, scan pins, ADC and DMA setup','Donor RGB transport and calibration algorithm','Existing trigger/advanced functions and Fn records','Existing boot-entry behavior and storage map'],
      'unverified':['Epomaker PCB wiring/clock compatibility','Loader placement, acceptance and erase boundaries','Physical LED order and switch conversion accuracy','Recovery after a failed application','Calibration coverage and retention for added positions'],
      'snapshot_limit':'ADC/DMA remains running; samples can span different scan phases, not an atomic or calibrated millimeter report.',
      'verification':'Offline build only. Run verify.py; no hardware flashed.'}
    (HERE/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in manifest.items() if k not in ['edits','labels']},indent=2))
    return original,bytes(image),manifest

if __name__=='__main__': build()
