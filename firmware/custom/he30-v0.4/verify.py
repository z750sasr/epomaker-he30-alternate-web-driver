"""Execute generated v0.4 RV32I bytes against bounded peripheral models.

Models verify intent, ranges, waveform contents and failure cleanup. They do
not establish Epomaker wiring, electrical timing or physical ADC/LED behavior.
"""
import json
import struct
import random
from pathlib import Path
from build import HERE, PREVIOUS, NAME, BASE_HASH, CAVE, STATUS, REPORT, GP, FRAME, FRAME_BYTES, CHANNELS

manifest=json.loads((HERE/'manifest.json').read_text());image=(HERE/NAME).read_bytes()
import hashlib
assert hashlib.sha256(image).hexdigest()==manifest['sha256']
assert hashlib.sha256((PREVIOUS/json.loads((PREVIOUS/'manifest.json').read_text())['name']).read_bytes()).hexdigest()==BASE_HASH
labels={k:int(v,16) for k,v in manifest['labels'].items()};legacy={k:int(v,16) for k,v in manifest['legacy_labels'].items()}
assert len(image)==155056 and manifest['extension_bytes']<=8192
assert image[0x1B100:0x1B200]==(PREVIOUS/json.loads((PREVIOUS/'manifest.json').read_text())['name']).read_bytes()[0x1B100:0x1B200]
def sx(v,b):return v-(1<<b) if v&(1<<(b-1)) else v

GPIO_ADDRS={0x40010800,0x40010c00,0x40010c04,0x40010c10,0x40010c14,0x40011000,0x40011004,0x40011010,0x40011014,0x40010004}
RCC_ADDRS={0x40021000,0x40021004,0x40021014,0x40021018,0x4002101c,0x40021024}
ADC_ADDRS={0x40012400+i for i in [0,4,8,12,16,44,48,52,76]}
DMA_ADDRS={0x40020000,0x40020004,*[0x40020030+i for i in [0,4,8,12]],*[0x40020058+i for i in [0,4,8,12]]}
SPI_ADDRS={base+i for base in [0x40003800,0x40013000] for i in [0,4,8]}
MMIO=GPIO_ADDRS|RCC_ADDRS|ADC_ADDRS|DMA_ADDRS|SPI_ADDRS|{0x40023400,0x20000230}

class CPU:
    def __init__(self, fail=None):
        self.r=[0x12300000+i*13 for i in range(32)];self.r[0]=0;self.r[1]=0xdead0000;self.r[2]=0x20008000;self.r[3]=GP;self.r[8]=STATUS;self.r[9]=REPORT
        self.mem={}
        for start,size in [(STATUS,160),(REPORT,64),(GP-0x7d8,64),(0x20007f00,256),(FRAME,FRAME_BYTES)]:self.mem.update({start+i:0 for i in range(size)})
        self.mem.update({STATUS+i:b for i,b in enumerate(b'H3B1\x01\x30\x03\0')})
        self.regs={address:0 for address in MMIO};self.regs.update({0x40021004:0x1040a,0x20000230:144000000,0x40021000:0x03036483})
        self.writes=[];self.reads=[];self.dma_frames=[];self.fail=fail;self.bank=0;self.adc_ready=False;self.calls=[];self.conversions=0
        self.gpio_latch={0x40011000:0x6000,0x40010c00:0x400}
    def put(self,address,value,size=1):
        if address in MMIO:
            assert address not in [0x40020000,0x4001244c,0x40023400,0x20000230],f'Read-only register {address:#x}'
            self.writes.append((address,value,size));self.regs[address]=value&((1<<(size*8))-1)
            if address in [0x40011010,0x40010c10,0x40011014,0x40010c14]:
                port=address&~31
                if address&31==0x10:self.gpio_latch[port]|=value&0xffff;self.gpio_latch[port]&=~(value>>16)
                else:self.gpio_latch[port]&=~value
                if not self.gpio_latch[0x40011000]&0x2000:self.bank=0
                elif not self.gpio_latch[0x40011000]&0x4000:self.bank=1
                elif not self.gpio_latch[0x40010c00]&0x400:self.bank=2
            if address==0x40012408:
                if value&0x500000==0x500000:self.conversions+=1;self.adc_ready=self.fail!='conversion'
            if address==0x40012400:self.adc_ready=False
            if address==0x40020004:self.regs[0x40020000]&=~value
            if address in [0x40020030,0x40020058] and value&1:
                assert value==0x2091
                assert self.regs[address+4]==FRAME_BYTES and self.regs[address+12]==FRAME
                assert self.regs[address+8]==(0x4001300c if address==0x40020030 else 0x4000380c)
                self.dma_frames.append(bytes(self.mem[FRAME+i] for i in range(FRAME_BYTES)))
                if self.fail!='dma':self.regs[0x40020000]|=0x200 if address==0x40020030 else 0x20000
            return
        assert all(address+i in self.mem for i in range(size)),f'Illegal memory/peripheral write {address:#x}'
        for i in range(size):self.mem[address+i]=value>>(8*i)&255
    def get(self,address,size=1):
        self.reads.append((address,size))
        if 0x19000<=address<0x1d000:return int.from_bytes(image[address-0x5000:address-0x5000+size],'little')
        if address in MMIO:
            if address==0x40012408:
                v=self.regs[address]
                if self.fail!='reset_cal':v&=~8
                if self.fail!='cal':v&=~4
                self.regs[address]=v;return v
            if address==0x40012400:return 2 if self.adc_ready else 0
            if address==0x4001244c:
                self.adc_ready=False;return 1000+self.bank*500+self.regs[0x40012434]*11
            if address in [0x40003808,0x40013008]:return 128 if self.fail=='spi' else 0
            return self.regs[address]
        assert all(address+i in self.mem for i in range(size)),f'Illegal read {address:#x}'
        return sum(self.mem[address+i]<<(8*i) for i in range(size))
    def run(self,pc,limit=2000000,stop=None):
        for step in range(limit):
            if pc==0xdead0000 or stop and stop(self,pc):return step
            if pc in [0x795e,0x15e7e,0x52c0,0x5412,0x78c6,0x5506,0x67b0]:
                self.calls.append(pc);pc=self.r[1];continue
            assert 0x19000<=pc<0x1d000 and pc%4==0,f'Illegal PC {pc:#x}'
            w=int.from_bytes(image[pc-0x5000:pc-0x5000+4],'little');op=w&127;rd=w>>7&31;f=w>>12&7;a=w>>15&31;b=w>>20&31;nxt=pc+4;val=None
            if op==0x37:val=w&0xfffff000
            elif op==0x13:
                n=sx(w>>20,12)
                if f==0:val=self.r[a]+n
                elif f==7:val=self.r[a]&n
                elif f==1:val=self.r[a]<<((w>>20)&31)
                elif f==5:assert w>>25==0;val=self.r[a]>>((w>>20)&31)
                else:raise AssertionError('ALU immediate')
            elif op==3:
                assert f in [2,4,5];val=self.get((self.r[a]+sx(w>>20,12))&0xffffffff,{2:4,4:1,5:2}[f])
            elif op==0x23:
                assert f in [0,1,2];n=sx((w>>25)<<5|(w>>7&31),12);self.put((self.r[a]+n)&0xffffffff,self.r[b],1<<f)
            elif op==0x33:
                assert w>>25==0
                if f==0:val=self.r[a]+self.r[b]
                elif f==7:val=self.r[a]&self.r[b]
                elif f==6:val=self.r[a]|self.r[b]
                else:raise AssertionError('ALU register')
            elif op==0x63:
                n=sx((w>>31&1)<<12|(w>>7&1)<<11|(w>>25&63)<<5|(w>>8&15)<<1,13)
                take={0:self.r[a]==self.r[b],1:self.r[a]!=self.r[b],6:self.r[a]<self.r[b],7:self.r[a]>=self.r[b]}[f]
                if take:nxt=pc+n
            elif op==0x6f:
                val=pc+4;n=sx((w>>31&1)<<20|(w>>12&255)<<12|(w>>20&1)<<11|(w>>21&1023)<<1,21);nxt=pc+n
            elif op==0x67:val=pc+4;nxt=(self.r[a]+sx(w>>20,12))&0xfffffffe
            else:raise AssertionError(f'Unsupported opcode {op:#x} at {pc:#x}')
            if val is not None and rd:self.r[rd]=val&0xffffffff
            self.r[0]=0;pc=nxt
        raise AssertionError(f'Instruction budget exceeded {pc:#x}')

cases=0;max_steps=0
def request(data,fail=None,cpu=None):
    global cases,max_steps
    c=cpu or CPU(fail);c.r[1]=0xdead0000;c.mem.update({REPORT+i:b for i,b in enumerate(data)})
    c.mem[GP-0x7c7]=1;c.mem[GP-0x7bc]=0;c.mem[GP-0x7bd]=1;c.mem[GP-0x7bb]=64
    before=c.r[:];steps=c.run(legacy['request']);cases+=1;max_steps=max(max_steps,steps)
    assert all(c.r[i]==before[i] for i in [1,2,3,4,8,9,*range(18,28)]),'ABI/stack changed'
    reply=bytes(c.mem[REPORT+i] for i in range(64))
    assert reply[3]==sum(reply[4:8+reply[4]])&255
    assert c.mem[GP-0x7bc]==1 and c.mem[GP-0x7bd]==0
    return c,reply

def action(which,path=0,index=0,r=0,g=0,b=0,rate=0):
    body=b'TEST'+bytes([which,path,index,r,g,b,rate,0])
    return bytes([0x55,0xdd,0,(12+sum(body))&255,12,0,0,0])+body+bytes(44)
def read(off,count):return bytes([0x55,0xdb,0,(off+count)&255,count,off,0,0])+bytes(56)

# Read-only API is exhaustively bounded and must never touch peripherals.
for offset in range(162):
    for count in [0,1,8,48,55,56,57]:
        c,reply=request(read(offset,count));assert not c.writes and not c.calls
        if count<=56 and offset+count<=160:
            assert reply[2]==0 and reply[4:8]==bytes([count,offset,0,0])
            assert reply[8:8+count]==bytes(c.mem[STATUS+offset+i] for i in range(count))
            assert not any(reply[8+count:])
        else:assert reply[2]==1 and reply[4]==0

for mode in [1,2]:
    c,reply=request(action(mode));assert reply[2]==0 and c.mem[STATUS+69]==mode
    expected=[1000+bank*500+ch*11 for bank in range(3 if mode==2 else 1) for ch in CHANNELS]
    values=[c.get(STATUS+80+i*2,2) for i in range(36)]
    assert values[:len(expected)]==expected and all(v==65535 for v in values[len(expected):])
    assert c.conversions==len(expected) and c.get(STATUS+72,4)==1 and c.regs[0x40012408]==0
    if mode==1:assert not any(a in [0x40011004,0x40010c04,0x40011010,0x40010c10,0x40011014,0x40010c14] for a,v,s in c.writes)
    else:assert c.gpio_latch[0x40011000]&0x6000==0x6000 and c.gpio_latch[0x40010c00]&0x400

for fail,error in [('reset_cal',1),('cal',2),('conversion',3)]:
    c,reply=request(action(2),fail);assert reply[2]==error and c.mem[STATUS+71]==error
    assert c.regs[0x40012408]==0 and c.get(STATUS+72,4)==0
    assert c.gpio_latch[0x40011000]&0x6000==0x6000 and c.gpio_latch[0x40010c00]&0x400

def encode(color):
    return bytes([0x88,0x8e,0xe8,0xee][(color>>shift)&3] for shift in range(22,-1,-2))
for path in [1,2]:
    for rate in [0,1]:
        for index in [0,17,63,255]:
            c,reply=request(action(3,path,index,12,8,4,rate));assert reply[2]==0 and len(c.dma_frames)==1
            data=c.dma_frames[0];assert data[:64]==bytes(64) and data[-64:]==bytes(64)
            for i in range(64):assert data[64+i*12:76+i*12]==encode((8<<16)|(12<<8)|4 if index in [i,255] else 0)
            spi=0x40003800 if path==1 else 0x40013000;dma=0x40020058 if path==1 else 0x40020030
            assert c.regs[spi]==(0x35c if path==1 else 0x364)+rate*8 and c.regs[spi+4]==0 and c.regs[dma]==0
            assert c.get(STATUS+152,4)==1
    c,reply=request(action(4,path,255,12,12,12));assert reply[2]==0
    assert c.dma_frames[0][64:832]==encode(0)*64
for fail,error in [('dma',4),('spi',5)]:
    c,reply=request(action(3,1,255,12,0,0),fail);assert reply[2]==error and c.regs[0x40020058]==0 and c.regs[0x40003804]==0
    assert c.get(STATUS+152,4)==0

# Every one-byte mutation of a valid action is rejected before MMIO.
valid=action(3,1,255,12,0,0)
for offset in range(2,64):
    bad=bytearray(valid);bad[offset]^=1
    c,reply=request(bad);assert reply[2]==1 and not c.writes and not c.calls
for params in [(0,0,0,0,0,0,0),(5,0,0,0,0,0,0),(3,0,0,0,0,0,0),(3,3,0,0,0,0,0),(3,1,64,0,0,0,0),(3,1,255,17,0,0,0),(3,1,0,0,17,0,0),(3,1,0,0,0,17,0),(3,1,0,0,0,0,2),(1,1,0,0,0,0,0)]:
    c,reply=request(action(*params));assert reply[2]==1 and not c.writes
rng=random.Random(304)
for _ in range(256):
    data=bytearray(valid);data[8:20]=bytes(rng.randrange(256) for _ in range(12));data[3]=(12+sum(data[8:20]))&255
    c,reply=request(data);assert reply[2]==1 and not c.writes

# Boot/reset changes only clear SRAM; main remains the proven USB-only path.
c=CPU();c.run(0x19000,stop=lambda c,pc:pc==0xad06);assert not c.writes
assert all(c.mem[STATUS+i]==0 for i in range(64,160)) and c.mem[STATUS+6]==3
c=CPU();c.run(legacy['main'],stop=lambda c,pc:pc==legacy['loop']);assert c.calls==[0x795e,0x15e7e,0x52c0,0x5412] and not c.writes
c,reply=request(bytes.fromhex('5503002020')+bytes(59));assert reply[8:10]==b'\0\4'

fixtures=[];c=CPU()
for phase,control in [('boot',None),('passive',action(1)),('banked',action(2)),('rgb',action(3,1,255,12,0,0)),('off',action(4,1,255))]:
    if control:
        c,reply=request(control,cpu=c);fixtures.append(dict(phase=phase,request=control.hex(),response=reply.hex()))
    for packet in [read(64,8),read(0,56),read(56,56),read(112,48)]:
        c,reply=request(packet,cpu=c);fixtures.append(dict(phase=phase,request=packet.hex(),response=reply.hex()))
(HERE/'protocol-fixtures.json').write_text(json.dumps(dict(sha256=manifest['sha256'],fixtures=fixtures),indent=2))
result=dict(sha256=manifest['sha256'],request_cases=cases,max_request_instructions=max_steps,hardware_tested=False,
    checks=['No GPIO/ADC/SPI startup calls','Read bounds and no stale response bytes','Malformed controls have no MMIO side effects','Passive ADC does not configure bank outputs','Three-bank model yields36 distinct ordered readings','ADC failures disable converter and deassert banks','Both SPI/DMA paths, rates, indices and exact GRB waveforms','Black frames and bounded DMA/SPI timeout cleanup','ABI and return-stack preservation','Legacy v0.4 version reply'],
    limitations='Generated instructions executed against peripheral models. Models do not validate physical pins, sensor responses, LED chip, frame timing, USB IRQ interaction, or the inherited recovery writer.')
(HERE/'verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
