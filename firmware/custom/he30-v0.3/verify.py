"""Execute actual RV32I diagnostic bytes. Native callees are explicit stubs.

This is a bounded instruction/side-effect check, not a USB/MCU simulator.
"""
from pathlib import Path
import json
import random
import struct
from build import HERE, SOURCE, SOURCE_HASH, NAME, ALIAS, CAVE, STATUS, GP, REPORT, HEADER, CALLS, sha, STAGES

image=(HERE/NAME).read_bytes(); original=SOURCE.read_bytes()
manifest=json.loads((HERE/'manifest.json').read_text(encoding='utf-8'))
assert sha(original)==SOURCE_HASH and sha(image)==manifest['sha256']
assert len(image)==len(original)==155056
labels={k:int(v,16) for k,v in manifest['labels'].items()}
code_end=CAVE+manifest['code_bytes']
assert code_end<=0x1A000
assert struct.unpack_from('<I',image,0x38+4*85)[0]==0x5772
assert image[0x13A00:0x14000]==original[0x13A00:0x14000], 'Original data initializer altered'
assert image[0x1B100:0x1B200]==original[0x1B100:0x1B200], 'Persistent settings altered'
assert image[0x12DB8:0x12DB8+108]==original[0x12DB8:0x12DB8+108], 'Donor mappings altered'
for e in manifest['edits']:
    off=int(e['offset'],16); assert image[off:off+len(bytes.fromhex(e['new']))]==bytes.fromhex(e['new'])
allowed=set()
for e in manifest['edits']: allowed.update(range(int(e['offset'],16),int(e['offset'],16)+len(bytes.fromhex(e['new']))))
assert {i for i,(a,b) in enumerate(zip(image,original)) if a!=b}<=allowed

def sx(n,b): return n-(1<<b) if n&(1<<(b-1)) else n

class CPU:
    def __init__(self):
        self.r=[(0x12300000+i*13)&0xffffffff for i in range(32)]; self.r[0]=0
        self.r[1]=0xDEAD0000; self.r[2]=0x20008000; self.r[3]=GP; self.r[8]=STATUS; self.r[9]=REPORT
        self.memory={}
        for base,size in [(STATUS,64),(REPORT,64),(GP-0x7D8,64),(0x20007FC0,64)]:
            self.memory.update({base+i:0 for i in range(size)})
        self.memory.update({STATUS+i:b for i,b in enumerate(HEADER)})
        self.reads=[]; self.writes=[]; self.calls=[]; self.csrs={0x300:0x1888,0x341:0x12345678,0x342:2}
        self.hardware={0x40021024:0x04000000,0x40021000:0x03030003,0x40021004:0x10108,0x40023400:0x290000,0x20000230:144000000}
    def write(self,a,v,size=1):
        assert all(a+i in self.memory for i in range(size)), f'Unpermitted write {a:#x}'
        for i in range(size): self.memory[a+i]=(v>>(8*i))&255
        self.writes.append((a,size))
    def read(self,a,size=1):
        self.reads.append((a,size))
        if a in self.hardware:
            assert size==4
            value=self.hardware[a]; return value() if callable(value) else value
        assert all(a+i in self.memory for i in range(size)),f'Unpermitted read {a:#x}'
        return sum(self.memory[a+i]<<(8*i) for i in range(size))
    def run(self,start,stop=None,limit=20000):
        pc=labels.get(start,start)
        for step in range(limit):
            if (stop and stop(self,pc)) or pc==0xDEAD0000: return pc,step
            if pc in CALLS:
                self.calls.append(pc)
                if pc==0x5506:
                    assert self.r[10:14]==[2,REPORT,64,1]
                    self.r[10]=1
                pc=self.r[1]; continue
            assert CAVE<=pc<code_end and pc%4==0,f'Unexpected PC {pc:#x}'
            w=struct.unpack_from('<I',image,pc-ALIAS)[0]
            op=w&127; rd=w>>7&31; f=w>>12&7; a=w>>15&31; b=w>>20&31
            nxt=pc+4; val=None
            if op==0x37: val=w&0xfffff000
            elif op==0x13:
                n=sx(w>>20,12)
                if f==0: val=self.r[a]+n
                elif f==7: val=self.r[a]&n
                else: raise AssertionError('Unexpected immediate instruction')
            elif op==3:
                assert f in [2,4]; val=self.read((self.r[a]+sx(w>>20,12))&0xffffffff,4 if f==2 else 1)
            elif op==0x23:
                assert f in [0,2]; n=sx((w>>25)<<5|(w>>7&31),12)
                self.write((self.r[a]+n)&0xffffffff,self.r[b],4 if f==2 else 1)
            elif op==0x33:
                assert w>>25==0
                if f==0: val=self.r[a]+self.r[b]
                elif f==7: val=self.r[a]&self.r[b]
                else: raise AssertionError('Unexpected register instruction')
            elif op==0x63:
                n=sx((w>>31&1)<<12|(w>>7&1)<<11|(w>>25&63)<<5|(w>>8&15)<<1,13)
                take={0:self.r[a]==self.r[b],1:self.r[a]!=self.r[b],6:self.r[a]<self.r[b],7:self.r[a]>=self.r[b]}[f]
                if take:nxt=pc+n
            elif op==0x6f:
                n=sx((w>>31&1)<<20|(w>>12&255)<<12|(w>>20&1)<<11|(w>>21&1023)<<1,21)
                val=pc+4; nxt=pc+n
            elif op==0x67:
                assert f==0; val=pc+4; nxt=(self.r[a]+sx(w>>20,12))&0xfffffffe
            elif op==0x73:
                assert f==2 and a==0; val=self.csrs[w>>20]
            else: raise AssertionError(f'Unknown opcode {op:#x}')
            if val is not None and rd:self.r[rd]=val&0xffffffff
            self.r[0]=0; pc=nxt
        raise AssertionError(f'Instruction budget exceeded at {pc:#x}')

cases=0; max_steps=0
def request(data, *, configured=1, received=1, pending=0, actual_length=64):
    global cases,max_steps
    c=CPU(); c.memory.update({REPORT+i:v for i,v in enumerate(data)})
    c.memory[STATUS+5]=48
    c.memory[GP-0x7c7]=configured; c.memory[GP-0x7bd]=received; c.memory[GP-0x7bc]=pending; c.memory[GP-0x7bb]=actual_length
    before=c.r[:]; _,steps=c.run('request'); max_steps=max(max_steps,steps); cases+=1
    assert all(c.r[i]==before[i] for i in [1,2,3,4,8,9,*range(18,28)]), 'ABI register corruption'
    return c,bytes(c.memory[REPORT+i] for i in range(64))

for off in range(66):
    for length in range(58):
        data=bytes([0x55,0xdc,0,(off+length)&255,length,off,0,0])+bytes(56)
        c,reply=request(data)
        assert not c.calls
        if length<=56 and off+length<=64:
            assert reply[:3]==b'\xaa\xdc\0' and reply[4:8]==bytes([length,off,0,0])
            expected=bytes(c.memory[STATUS+i] for i in range(64))
            assert reply[8:8+length]==expected[off:off+length]
            assert not any(reply[8+length:]), 'Stale data disclosure'
        else: assert reply[2]==1 and reply[4]==0
        assert reply[3]==sum(reply[4:8+reply[4]])&255
        assert c.memory[GP-0x7bc]==1 and c.memory[GP-0x7bd]==0

recovery=bytes.fromhex('5f0600520100000051')+bytes(55)
c,_=request(recovery); assert c.calls==[0x67B0] and c.memory[STATUS+5]==228
for i in range(64):
    bad=bytearray(recovery); bad[i]^=1
    c,reply=request(bad); assert not c.calls and reply[2]==1

version=bytes.fromhex('5503002020')+bytes(59)
c,reply=request(version); assert reply[:3]==b'\xaa\x03\0' and reply[8:10]==b'\0\x03' and reply[4]==32
assert reply[3]==sum(reply[4:40])&255

rng=random.Random(305)
for _ in range(512):
    data=bytes(rng.randrange(256) for _ in range(64))
    c,reply=request(data); assert not c.calls and reply[2]==1
for overrides in [dict(configured=0),dict(received=0),dict(pending=1)]:
    c,reply=request(recovery,**overrides); assert not c.calls and reply==recovery
for length in [0,1,7,8,32,63,65,255]:
    c,reply=request(recovery,actual_length=length); assert not c.calls and reply[2]==1

# First entry leaves an inspectable marker before executing any native code.
c=CPU(); c.run('reset',lambda c,pc:pc==0xAD06)
assert bytes(c.memory[STATUS+i] for i in range(8))==HEADER[:5]+bytes([1,15,0])
assert c.read(STATUS+16,4)==0x04000000
c=CPU(); c.run('system_init'); assert c.calls==[0x78C6] and c.r[2]==0x20008000 and c.memory[STATUS+5]==3
c=CPU(); c.run('main',lambda c,pc:pc==labels['loop'])
assert c.calls==[0x795E,0x15E7E,0x52C0,0x5412] and c.memory[STATUS+5]==48
# A complete loop with no request never invokes a scanner, settings or RGB callee.
c.memory[GP-0x7c7]=0
c.run('loop',lambda c,pc:c.read(STATUS+8,4)>=2)
assert c.calls==[0x795E,0x15E7E,0x52C0,0x5412]
c=CPU(); c.memory[STATUS+5]=18; c.run('trap',lambda c,pc:pc==labels['park'])
assert c.memory[STATUS+5]==224 and c.read(STATUS+48,4)==18
assert c.read(STATUS+36,4)==2 and c.read(STATUS+40,4)==0x12345678
for label,reg,ready,resume,failure in [('pll_wait',0x40021000,0x02000000,0x7C1A,226),('clock_wait',0x40021004,8,0x7C4A,227)]:
    c=CPU(); c.hardware[reg]=ready; c.run(label,lambda c,pc:pc==resume)
    c=CPU(); c.hardware[reg]=0; c.run(label,lambda c,pc:pc==labels['park'],limit=5100000)
    assert c.memory[STATUS+5]==failure

fixtures=[]
for length in [8,56]:
    data=bytes([0x55,0xdc,0,length,length,0,0,0])+bytes(56)
    c,reply=request(data)
    fixtures.append(dict(request=data.hex(),response=reply.hex()))
(HERE/'status-fixtures.json').write_text(json.dumps(dict(sha256=sha(image),fixtures=fixtures),indent=2),encoding='utf-8')

result=dict(sha256=sha(image),request_cases=cases,max_request_instructions=max_steps,hardware_tested=False,
    checks=['Exact donor and patch bounds','No persistent-settings or map changes','USB IRQ vector preserved',
            'All status read windows and zeroed reply tails','Invalid/writing commands rejected without native calls',
            '64 single-byte mutations cannot enter recovery','Recovery-return path restores stack/return address',
            'Reset, clock wrapper and USB-only main stages','NMI/HardFault cause and PC record',
            'Ready and timeout branches of both clock guards'],
    limitations='External native calls are explicit stubs, not emulated donor hardware/USB/flash code. Loader acceptance is not tested.')
(HERE/'verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2))
