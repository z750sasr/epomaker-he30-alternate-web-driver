"""Run the compiled RV32IM bytes, not a host-language copy of the engine.

USB upload, ADC, GPIO, timer and flash are bounded models. This verifies
software behavior and addresses, not electrical behavior, interrupts or timing.
No connected device is opened. Run build.py first.
"""
import hashlib,json,struct,zlib
from pathlib import Path
HERE=Path(__file__).resolve().parent
manifest=json.loads((HERE/'manifest.json').read_text())
image=(HERE/manifest['name']).read_bytes()
symbols=json.loads((HERE/'symbols.json').read_text())
layout=json.loads((HERE/'layout.json').read_text())
assert hashlib.sha256(image).hexdigest()==manifest['sha256']
assert 0<symbols['__ramcode_end']-symbols['__ramcode_start']<=1024
assert symbols['__ramcode_load']+symbols['__ramcode_end']-symbols['__ramcode_start']<=0x1e000
S=0x20004000;TEMP=0x20006000;END=0xdead0000
MASK=0xffffffff
def sx(v,b=32):return v-(1<<b) if v&(1<<(b-1)) else v
def divs(a,b):
    if not b:return -1
    return (abs(a)//abs(b))*(-1 if (a<0) != (b<0) else 1)
class PowerCut(Exception):pass

class CPU:
    def __init__(self):
        self.ram=bytearray(32768);self.flash=bytearray(image);self.r=[0]*32
        self.regs={};self.csr={0x300:8};self.time=0;self.instructions=0;self.calls=[];self.writes=[]
        self.sent=[];self.busy=0;self.fail=None;self.adc_ready=False;self.conversions=[]
        self.latch={0x40011000:0x6000,0x40010c00:0x400};self.unlock=0;self.erases=[];self.programs=[];self.cut=None;self.dma_frames=[]
        n=symbols['__ramcode_end']-symbols['__ramcode_start'];off=symbols['__ramcode_load']-0x5000
        self.ram[0x7000:0x7000+n]=self.flash[off:off+n]
    def field(self,name,value=None,size=1):
        a=S+layout[name]
        if value is None:return self.get(a,size)
        self.put(a,value,size)
    def blob(self,address,data=None,n=0):
        if data is not None:
            for i,v in enumerate(data):self.put(address+i,v)
        else:return bytes(self.get(address+i) for i in range(n))
    def usb(self,on=True):
        self.put(0x20000269,int(on));self.put(0x20000266,int(on));self.put(0x20000268,0)
    def physical(self,a):
        if 0x5000<=a<0x5000+len(self.flash):return a-0x5000
        if 0x08005000<=a<0x08005000+len(self.flash):return a-0x08005000
        return None
    def get(self,a,n=1):
        if 0x20000000<=a and a+n<=0x20008000:return int.from_bytes(self.ram[a-0x20000000:a-0x20000000+n],'little')
        f=self.physical(a)
        if f is not None:return int.from_bytes(self.flash[f:f+n],'little')
        assert (n==4 or n==2 and a in [b+i for b in [0x40003800,0x40013000] for i in [0,4,8]]) and (0x40000000<=a<0x40030000 or 0xe000f000<=a<=0xe000f014),f'Invalid read {a:#x}/{n}'
        if a in [0x40003808,0x40013008]:return 128 if self.fail=='spi' else 0
        if a==0xe000f008:return self.time&MASK
        if a==0x40012408:
            v=self.regs.get(a,0)
            if self.fail!='reset_cal':v&=~8
            if self.fail!='cal':v&=~4
            self.regs[a]=v;return v
        if a==0x40012400:return 2 if self.adc_ready else 0
        if a==0x4001244c:
            self.adc_ready=False
            banks=[i for i,(p,m) in enumerate([(0x40011000,0x2000),(0x40011000,0x4000),(0x40010c00,0x400)]) if not self.latch[p]&m]
            assert len(banks)==1,'Multiple sensor banks enabled'
            ch=self.regs[0x40012434];self.conversions.append((banks[0],ch));return 1000+banks[0]*500+ch*11
        return self.regs.get(a,0)
    def put(self,a,v,n=1):
        v&=(1<<(8*n))-1
        if 0x20000000<=a and a+n<=0x20008000:
            self.ram[a-0x20000000:a-0x20000000+n]=v.to_bytes(n,'little');return
        f=self.physical(a)
        if f is not None:
            assert n==2 and 0x0801e000<=a<0x08020000 and self.unlock==2 and self.regs.get(0x40022010,0)&1,f'Illegal flash program {a:#x}/{n},unlock={self.unlock},CTLR={self.regs.get(0x40022010,0):#x}'
            if self.cut is not None and len(self.programs)>=self.cut:raise PowerCut()
            old=int.from_bytes(self.flash[f:f+2],'little');assert old&v==v,'Flash program attempted0->1'
            self.flash[f:f+2]=v.to_bytes(2,'little');self.programs.append(a);return
        assert (n==4 or n==2 and a in [b+i for b in [0x40003800,0x40013000] for i in [0,4]]) and (0x40000000<=a<0x40030000 or 0xe000f000<=a<=0xe000f014),f'Invalid write {a:#x}/{n}'
        self.writes.append((a,v));self.regs[a]=v
        if a==0x40020004:self.regs[0x40020000]=self.regs.get(0x40020000,0)&~v
        if a in [0x40020058,0x40020030] and v&1:
            assert v==0x2091;path=1 if a==0x40020058 else 2;count=self.regs[a+4]
            assert count>=128 and count<=896 and (count-128)%12==0
            assert self.regs[a+8]==(0x4000380c if path==1 else 0x4001300c)
            assert self.regs[a+12]==S+layout['rgb_frame']
            self.dma_frames.append((path,self.blob(self.regs[a+12],n=count)))
            if self.fail!='dma':self.regs[0x40020000]=self.regs.get(0x40020000,0)|(0x20000 if path==1 else 0x200)
        if a in [0x40011010,0x40010c10,0x40011014,0x40010c14]:
            p=a&~31
            if a&31==0x10:self.latch[p]=(self.latch[p]|(v&65535))&~(v>>16)
            else:self.latch[p]&=~v
        if a==0x40012400:self.adc_ready=False
        if a==0x40012408 and v&0x500000==0x500000:self.adc_ready=self.fail!='conversion'
        if a==0xe000f008:self.time=v
        if a==0x40022004:
            if v==0x45670123:self.unlock=1
            elif v==0xcdef89ab and self.unlock==1:
                self.unlock=2;self.regs[0x40022010]=self.regs.get(0x40022010,0)&~0x80
            else:raise AssertionError('Bad flash unlock')
        if a==0x4002200c:self.regs[a]=0
        if a==0x40022010:
            if v&0x80:self.unlock=0
            if v&0x42==0x42:
                p=self.regs[0x40022014];assert self.unlock==2 and p in [0x0801e000,0x0801f000]
                off=p-0x08005000;self.flash[off:off+4096]=b'\xff'*4096;self.erases.append(p);self.regs[a]&=~0x40
    def call(self,name,*args,limit=4000000,stop=None):
        self.r=[(0x12300000+i*13)&MASK for i in range(32)];self.r[0]=0;self.r[1]=END;self.r[2]=0x20008000;self.r[3]=0x20000a30
        for i,v in enumerate(args):self.r[10+i]=v
        before=self.r[:];pc=symbols[name] if isinstance(name,str) else name
        for step in range(limit):
            if pc==END:
                assert all(self.r[i]==before[i] for i in [2,3,4,8,9,*range(18,28)]),'C ABI/stack corruption'
                return self.r[10]
            if stop and stop(self,pc):return step
            if pc in [0x795e,0x15e7e,0x52c0,0x5412,0x5506,0x67b0]:
                self.calls.append(pc)
                if pc==0x5506:
                    ep,p,n,copy=self.r[10:14];assert copy==1 and (ep,n) in [(1,8),(2,64)]
                    if self.busy:self.busy-=1;self.r[10]=0
                    else:self.sent.append((ep,self.blob(p,n=n)));self.r[10]=1
                pc=self.r[1];continue
            assert pc%4==0 and (0x1b000<=pc<0x1e000 or 0x20007000<=pc<symbols['__ramcode_end']),f'Invalid PC {pc:#x}'
            w=self.get(pc,4);op=w&127;rd=w>>7&31;f=w>>12&7;a=w>>15&31;b=w>>20&31;top=w>>25
            x=self.r[a];y=self.r[b];nxt=pc+4;val=None
            if op==0x37:val=w&0xfffff000
            elif op==0x17:val=pc+(w&0xfffff000)
            elif op==0x13:
                imm=sx(w>>20,12);shift=w>>20&31
                if f==0:val=x+imm
                elif f==2:val=int(sx(x)<imm)
                elif f==3:val=int(x<(imm&MASK))
                elif f==4:val=x^(imm&MASK)
                elif f==6:val=x|(imm&MASK)
                elif f==7:val=x&(imm&MASK)
                elif f==1:assert top==0;val=x<<shift
                elif f==5:assert top in [0,32];val=(sx(x) if top else x)>>shift
            elif op==3:
                assert f in [0,1,2,4,5];size={0:1,1:2,2:4,4:1,5:2}[f];val=self.get((x+sx(w>>20,12))&MASK,size)
                if f in [0,1]:val=sx(val,size*8)
            elif op==0x23:
                assert f in [0,1,2];imm=sx((w>>25)<<5|(w>>7&31),12);self.put((x+imm)&MASK,y,1<<f)
            elif op==0x33:
                if top==1:
                    if f==0:val=x*y
                    elif f==1:val=(sx(x)*sx(y))>>32
                    elif f==2:val=(sx(x)*y)>>32
                    elif f==3:val=(x*y)>>32
                    elif f==4:val=divs(sx(x),sx(y))
                    elif f==5:val=x//y if y else MASK
                    elif f==6:val=sx(x)-divs(sx(x),sx(y))*sx(y) if y else x
                    elif f==7:val=x%y if y else x
                else:
                    assert top in [0,32]
                    if f==0:val=x-y if top else x+y
                    elif f==1:val=x<<(y&31)
                    elif f==2:val=int(sx(x)<sx(y))
                    elif f==3:val=int(x<y)
                    elif f==4:val=x^y
                    elif f==5:val=(sx(x) if top else x)>>(y&31)
                    elif f==6:val=x|y
                    elif f==7:val=x&y
            elif op==0x63:
                imm=sx((w>>31)<<12|(w>>7&1)<<11|(w>>25&63)<<5|(w>>8&15)<<1,13)
                take={0:x==y,1:x!=y,4:sx(x)<sx(y),5:sx(x)>=sx(y),6:x<y,7:x>=y}[f]
                if take:nxt=pc+imm
            elif op==0x6f:
                val=pc+4;imm=sx((w>>31)<<20|(w>>12&255)<<12|(w>>20&1)<<11|(w>>21&1023)<<1,21);nxt=pc+imm
            elif op==0x67:assert f==0;val=pc+4;nxt=(x+sx(w>>20,12))&0xfffffffe
            elif op==0x0f:pass # fence/fence.i, single-threaded model
            elif op==0x73:
                assert f in [1,2,3,5,6,7];csr=w>>20;old=self.csr.get(csr,0);v=a if f>=5 else x;val=old
                self.csr[csr]={1:v,2:old|v,3:old&~v}[f if f<5 else f-4]&MASK
            else:raise AssertionError(f'Unsupported instruction {w:08x} at {pc:#x}')
            if val is not None and rd:self.r[rd]=val&MASK
            self.r[0]=0;pc=nxt;self.instructions+=1
            if self.regs.get(0xe000f000,0)&1:self.time+=100
        raise AssertionError(f'Instruction budget exceeded at {pc:#x}')

checks=[];total=0
def passed(name):checks.append(name);print('PASS',name,flush=True)
def fresh():
    c=CPU();c.field('rgb_path',2);c.call('config_defaults',S+layout['cfg']);c.call('lighting_defaults');c.usb();c.call('time_init');return c
def config(c):return bytearray(c.blob(S+layout['cfg'],n=664))
def request(c,op,data=b'',offset=0,length=None):
    length=len(data) if length is None else length
    p=bytearray(64);p[:8]=bytes([0x55,0xd0,op,0,length,offset&255,offset>>8,0]);p[8:8+len(data)]=data;p[3]=sum(p[4:8+length])&255
    c.blob(TEMP,p);c.call('vendor_request',TEMP);r=c.blob(S+layout['vendor'],n=64)
    assert r[:2]==b'\xaa\xd0' and r[3]==sum(r[4:8+r[4]])&255
    assert not any(r[8+r[4]:])
    if op not in [0,1] or r[2]:assert r[4:8]==b'\0'*4
    return r
def control(c,op):return request(c,op)[2]
def stage(c,blob,commit=True):
    for off in range(0,664,56):assert request(c,2,blob[off:off+56],off)[2]==0
    return request(c,3,struct.pack('<I',zlib.crc32(blob)))[2] if commit else None
def frame(c,values=None,n=1):
    values=values or [1000]*36
    c.blob(TEMP,struct.pack('<36H',*values))
    for _ in range(n):c.call('engine_step',TEMP)
def ready(c):
    c.call('keyboard_service');frame(c,n=12);assert not c.field('inhibit')
def calibrated(c):
    blob=config(c);struct.pack_into('<II',blob,8,MASK,15)
    struct.pack_into('<36H',blob,16,*([1000]*36));struct.pack_into('<36H',blob,88,*([3000]*36))
    assert stage(c,blob)==0;assert control(c,6)==0;ready(c)
def press(c,keys,n=16):
    v=[1000]*36
    for i in keys:v[i]=3000
    frame(c,v,n);return c.blob(S+layout['report'],n=8)

c=fresh();assert config(c)[1:4]==b'\2\0\1' and config(c)[6]==1
frame(c,[3000]*36,n=10);assert not c.field('enabled') and not any(c.blob(S+layout['report'],n=8));assert control(c,6)==7
assert c.call('config_valid',S+layout['cfg'])==1
passed('Confirmed group defaults; no typing before calibration; config ABI')

# Full compiled startup and scan loop. Stubs stand only for native routines.
c=CPU();c.usb();c.call('firmware_main',stop=lambda c,pc:c.field('frames',size=4)>=2)
assert c.calls[:4]==[0x795e,0x15e7e,0x52c0,0x5412]
assert c.conversions[:36]==[(b,ch) for b in [2,0,1] for ch in [6,7,14,15,8,9,5,4,12,13,11,10]]
assert [c.get(S+layout['raw']+i*2,2) for i in range(36)]==[1000+b*500+ch*11 for b in [2,0,1] for ch in [6,7,14,15,8,9,5,4,12,13,11,10]]
assert not c.erases and not c.programs
assert c.dma_frames and c.dma_frames[0][0]==1
passed('Real startup reaches ordered36-sensor frames; native USB starts first; dim keyboard RGB queued, no flash writes')
for fail,error in [('reset_cal',1),('cal',2),('conversion',3)]:
    c=CPU();c.usb();c.fail=fail;c.call('firmware_main',stop=lambda c,pc:c.field('scan_error')==error)
    assert not c.field('enabled') and c.regs[0x40012408]==0
    assert c.latch[0x40011000]&0x6000==0x6000 and c.latch[0x40010c00]&0x400
passed('All3 ADC failure paths terminate, stop typing and deassert banks')

c=fresh();assert control(c,4)==0
frame(c,n=32);assert c.field('cal_phase')==2
v=[3000 if i%2==0 else 300 for i in range(36)];frame(c,v,n=3)
assert control(c,5)==8
frame(c,n=16);assert control(c,5)==0;assert control(c,6)==0;ready(c)
assert c.field('enabled') and not c.field('inhibit')
assert press(c,[32])[2]==4
v=[1000]*36;v[33]=300;frame(c,v,n=16);assert c.blob(S+layout['report'],n=8)[2]==0x16
passed('32-frame baseline, both sensor polarities, finish-release guard and typing')

c=fresh();calibrated(c)
assert press(c,[15,32])[2:4]==b'\x1a\x04'
assert press(c,[32])[2]==4
assert press(c,[])[2:]==bytes(6)
assert press(c,[8,0])[2]==0x40 and c.field('fn')
assert press(c,[0])[2]==0x40 # binding stays latched until key released
press(c,[]);assert press(c,[0])[2]==0x3a
assert press(c,[9,10,25])[0]==7
press(c,[]);blob=config(c);blob[160+33*14+8]=4;assert stage(c,blob)==0;ready(c)
assert press(c,[32,33])[2:4]==b'\4\0';assert press(c,[33])[2]==4
press(c,[]);assert press(c,[0,1,2,3,4,5,6])[2:]==b'\1'*6 and c.field('rollover')
assert press(c,[0,1])[2:4]==b'\x3a\x3b' and not c.field('rollover')
passed('Simultaneous input, momentary Fn and latched outputs, modifiers, duplicate sources,6KRO recovery')

# Hysteresis and rapid trigger: use many identical frames to settle filtering.
c=fresh();calibrated(c);blob=config(c);blob[160+32*14+10]=1;assert stage(c,blob)==0;ready(c)
v=[1000]*36;v[32]=2400;frame(c,v,n=16);assert c.blob(S+layout['report'],n=8)[2]==4
v[32]=2100;frame(c,v,n=16);assert c.blob(S+layout['report'],n=8)[2]==0
v[32]=2280;frame(c,v,n=16);assert c.blob(S+layout['report'],n=8)[2]==4
press(c,[]);v[32]=1800;frame(c,v,n=16);assert c.blob(S+layout['report'],n=8)[2]==0
passed('Rapid Trigger releases/retriggers from relative movement; full release restores initial threshold')

c=fresh();calibrated(c);press(c,[32]);c.call('keyboard_service');assert c.sent[-1][1][2]==4
c.busy=3;assert control(c,7)==0
for _ in range(3):c.call('keyboard_service');assert c.field('release_pending')
c.call('keyboard_service');assert not c.field('release_pending') and c.sent[-1]==(1,bytes(8))
assert control(c,6)==0;ready(c);press(c,[32]);c.call('keyboard_service')
c.usb(False);c.call('keyboard_service');assert c.field('inhibit') and not c.field('have_last')
c.usb();c.call('keyboard_service');assert c.sent[-1]==(1,bytes(8));press(c,[32]);assert not any(c.blob(S+layout['report'],n=8))
ready(c);press(c,[32]);c.call('keyboard_service');c.put(0x20000268,2);c.call('keyboard_service');c.put(0x20000268,0);c.call('keyboard_service');assert c.sent[-1]==(1,bytes(8))
ready(c);c.put(0x2000026c,1);c.call('keyboard_service');before=len(c.sent);c.time+=4*144000;c.call('keyboard_service');assert len(c.sent)==before+1
c.put(0x20000266,0);c.call('keyboard_service');assert not c.field('was_usb')
passed('Busy-safe zero releases, reconnect/suspend release interlocks, SET_IDLE and configuration0')

c=fresh();original=config(c)
assert request(c,2,b'abc',10)[2]==5
assert request(c,2,original[:56])[2]==0
assert request(c,3,struct.pack('<I',zlib.crc32(original)))[2]==5
assert config(c)==original
stage(c,original,False);assert request(c,3,b'\0'*4)[2]==4;assert config(c)==original
bad=bytearray(original);bad[1:4]=b'\0\0\1';assert stage(c,bad)==2;assert config(c)==original
for offset,value in [(0,b'\2'),(6,b'\10'),(4,b'\x63\0'),(160,b'\0\0'),(170,b'\4'),(173,b'\1')]:
    bad=bytearray(original);bad[offset:offset+len(value)]=value;assert stage(c,bad)==2
for off,count in [(0,56),(200,8),(208,0),(209,0),(65535,1),(0,57)]:
    if count>56:
        p=bytearray(64);p[:5]=bytes([0x55,0xd0,0,57,57]);c.blob(TEMP,p);c.call('vendor_request',TEMP);assert c.field('vendor')==0xaa;continue
    r=request(c,0,offset=off,length=count);assert r[2]==(0 if off+count<=208 else 2)
calibrated(c);blob=config(c);blob[1:4]=b'\0\1\2';assert stage(c,blob)==0;assert config(c)[8:16]==bytes(8) and not c.field('enabled')
assert not c.erases and not c.programs
passed('Staging completeness, CRC, validation and read bounds; changed bank order invalidates calibration')

# Journal tests execute the actual SRAM writer including CSR and FPEC accesses.
c=fresh();calibrated(c)
for i in range(6):
    assert control(c,8)==0;assert c.field('saved_seq',size=4)==i+1
assert c.erases==[0x0801f000]
assert all(0x0801e000<=a<0x08020000 for a in c.programs)
saved_flash=bytes(c.flash)
d=fresh();d.flash[:]=saved_flash;assert d.call('load_saved')==0;assert d.field('saved_seq',size=4)==6 and d.field('enabled') and d.field('inhibit')
# Corrupt latest slot; fall back to previous fully committed valid record.
d.flash[0x1a000+1024+16]^=1;assert d.call('load_saved')==0;assert d.field('saved_seq',size=4)==5
passed('Journal append, page rotation, startup calibration/typing restore and CRC fallback')
for cut in [0,1,8,100,330]:
    d=fresh();d.flash[:]=saved_flash;assert d.call('load_saved')==0;d.cut=cut
    try:control(d,8)
    except PowerCut:pass
    else:raise AssertionError('Fault injection did not interrupt write')
    e=fresh();e.flash[:]=d.flash;assert e.call('load_saved')==0;assert e.field('saved_seq',size=4)==6
# Rotation power loss: four full slots, target other page erased, current remains.
d=fresh();calibrated(d)
for _ in range(4):assert control(d,8)==0
d.cut=len(d.programs)+8
try:control(d,8)
except PowerCut:pass
e=fresh();e.flash[:]=d.flash;assert e.call('load_saved')==0 and e.field('saved_seq',size=4)==4
# Writer rejects every address outside its dedicated journal before FPEC writes.
for address in [0x08000000,0x0801d000,0x0801e001,0x08020000]:
    e=fresh();before=len(e.writes);assert e.call('flash_writer',address,S+layout['scratch'],0)==9;assert len(e.writes)==before
passed('Interrupted writes/rotation preserve latest committed record; flash writer bounds reject outside pages')

def light_request(c,op,data=b'',offset=0,length=None):
    n=len(data) if length is None else length
    p=bytearray(64);p[:8]=bytes([0x55,0xd1,op,0,n,offset&255,offset>>8,0]);p[8:8+len(data)]=data;p[3]=sum(p[4:8+n])&255
    c.blob(TEMP,p);c.call('vendor_request',TEMP);r=c.blob(S+layout['vendor'],n=64)
    assert r[:2]==b'\xaa\xd1' and r[3]==sum(r[4:8+r[4]])&255
    if op or r[2]:assert r[4:8]==bytes(4)
    return r
def light(c):return bytearray(c.blob(S+layout['light'],n=128))
def options(c,**values):
    b=light(c)[:12];names=['version','mode','order','rate','count','bar_on','r','g','b','br','bg','bb']
    for k,v in values.items():b[names.index(k)]=v
    assert light_request(c,1,b)[2]==0
def drain(c):
    for _ in range(8):c.call('rgb_service')
    assert not c.field('rgb_state') and not c.field('rgb_pending') and not c.field('rgb_error')
def wave(color):return bytes([0x88,0x8e,0xe8,0xee][color>>shift&3] for shift in range(22,-1,-2))
wiring=json.loads((HERE/'wiring.json').read_text());api=json.loads((HERE/'API.json').read_text())
assert sorted(wiring['ledToHall'])==list(range(36))
assert [api['keys'][i] for i in wiring['ledToHall']]==wiring['ledOrder']
assert bytes(wiring['ledToHall'])==image[symbols['led_to_key']-0x5000:symbols['led_to_key']-0x5000+36]
c=fresh();drain(c)
assert [(p,len(b)) for p,b in c.dma_frames]==[(1,560),(2,188)]
for path,b in c.dma_frames:
    assert b[:64]==bytes(64) and b[-64:]==bytes(64)
    assert b[64:-64]==wave(0x080006 if path==1 else 0)*(36 if path==1 else 5)
assert c.field('key_frames',size=4)==1 and c.field('bar_frames',size=4)==1
passed('Confirmed36-key LED permutation and5-LED bar; exact DMA waveforms and idle-low cleanup')

options(c,mode=2)
for start in range(0,36,14):
    payload=b''.join(bytes([i,i%33,(i+1)%33,(i+2)%33]) for i in range(start,min(36,start+14)))
    assert light_request(c,2,payload)[2]==0
drain(c);keyframe=[b for p,b in c.dma_frames if p==1][-1]
for led,k in enumerate(wiring['ledToHall']):assert keyframe[64+led*12:76+led*12]==wave(((k+1)%33)<<16|(k%33)<<8|(k+2)%33)
options(c,mode=1,order=1,rate=1,bar_on=1,r=1,g=2,b=3,br=3,bg=4,bb=5);drain(c)
assert [b for p,b in c.dma_frames if p==1][-1][64:-64]==wave(0x010203)*36
assert [b for p,b in c.dma_frames if p==2][-1][64:-64]==wave(0x030405)*5
assert (0x40003800,0x364) in c.writes and (0x40013000,0x36c) in c.writes
options(c,count=2);drain(c);assert [b for p,b in c.dma_frames if p==2][-1][64:-64]==wave(0x030405)*2+wave(0)*3
assert light_request(c,3,bytes([32]))[2]==0;drain(c)
keyframe=[b for p,b in c.dma_frames if p==1][-1]
for led,k in enumerate(wiring['ledToHall']):assert keyframe[64+led*12:76+led*12]==wave(0x0c0c0c if k==32 else 0)
c.time+=2001*144000;drain(c);assert c.field('identify')==255
options(c,mode=3);c.field('active',1);drain(c)
keyframe=[b for p,b in c.dma_frames if p==1][-1]
for led,k in enumerate(wiring['ledToHall']):assert keyframe[64+led*12:76+led*12]==wave(0x010203 if k==0 else 0)
passed('Per-key palette follows physical mapping; both orders/rates, bar tail clearing, identify expiry and reactive input')

# DMA buffer may not be overwritten while hardware owns it, even if settings change.
c=fresh();c.fail='dma';c.call('rgb_service');frozen=c.blob(S+layout['rgb_frame'],n=896)
options(c,r=12,g=0,b=0);c.call('rgb_service');assert c.blob(S+layout['rgb_frame'],n=896)==frozen
frame(c);assert c.field('frames',size=4)==1 # scanner/engine still runs while DMA pending
c.time+=21*144000;c.call('rgb_service');assert c.field('rgb_error')==1 and not c.field('rgb_state')
assert c.regs[0x40020058]==0 and c.regs[0x40003804]==0
before=len(c.dma_frames);c.call('rgb_service');assert len(c.dma_frames)==before
c.fail=None;assert light_request(c,5)[2]==0;drain(c)
c=fresh();c.fail='spi';c.call('rgb_service');c.call('rgb_service');assert c.field('rgb_state')==2
c.time+=21*144000;c.call('rgb_service');assert c.field('rgb_error')==2 and not c.field('rgb_state')
passed('Nonblocking DMA keeps frame immutable and input running; DMA/SPI faults stop only RGB until explicit retry')

# Repeated key updates cannot starve a queued bar frame.
c=fresh();c.call('rgb_service');c.call('rgb_service');c.field('rgb_pending',3);c.call('rgb_service')
assert c.dma_frames[-1][0]==2
passed('Round-robin chain scheduling prevents continuous key changes starving the bar')

c=fresh();baseline=light(c);before=len(c.writes)
for payload in [bytes([36,1,2,3]),bytes([0,33,0,0]),bytes([0,1,2]),bytes([0,1,2,3,36,1,2,3])]:
    assert light_request(c,2,payload)[2] and light(c)==baseline
for idx,value in [(0,2),(1,4),(2,2),(3,2),(4,65),(5,2),(6,33)]:
    b=bytearray(baseline[:12]);b[idx]=value;assert light_request(c,1,b)[2] and light(c)==baseline
assert light_request(c,3,b'\x24')[2]==2
assert light_request(c,0,offset=159,length=2)[2]==2
assert len(c.writes)==before
assert control(c,8)==0
d=fresh();d.flash[:]=c.flash;assert d.call('load_saved')==0 and light(d)==baseline
# v0.5 journal records remain readable, with v0.6 lighting defaults.
record=bytearray(b'\xff'*1024);struct.pack_into('<III',record,0,0x35434648,1,17);record[16:680]=config(c)
struct.pack_into('<I',record,12,zlib.crc32(record[4:12]+record[16:680]));struct.pack_into('<I',record,1020,0x5ac3d17e)
d=fresh();d.flash[0x19000:0x19000+1024]=record;assert d.call('load_saved')==0 and d.field('saved_seq',size=4)==17 and light(d)==baseline
passed('Lighting packet bounds and all-before-mutation validation; v2 lighting persistence and v1 journal compatibility')

# Capture the compiled packet handler's bytes for cross-language browser tests.
fixtures=[]
for phase in ['default','calibrated','fn-pressed']:
    c=fresh()
    if phase!='default':calibrated(c)
    if phase=='fn-pressed':press(c,[8,0])
    for op,size in [(0,208),(1,664)]:
        spans=[(0,8)] if op==0 else []
        spans += [(off,min(56,size-off)) for off in range(0,size,56)]
        for off,n in spans:
            p=bytearray(64);p[:8]=bytes([0x55,0xd0,op,(n+(off&255)+(off>>8))&255,n,off&255,off>>8,0])
            r=request(c,op,offset=off,length=n)
            fixtures.append(dict(phase=phase,request=p.hex(),response=r.hex()))
    for off,n in [(0,8),(0,56),(56,56),(112,48)]:
        p=bytearray(64);p[:8]=bytes([0x55,0xd1,0,(off+n)&255,n,off,0,0]);r=light_request(c,0,offset=off,length=n)
        fixtures.append(dict(phase=phase,request=p.hex(),response=r.hex()))
(HERE/'protocol-fixtures.json').write_text(json.dumps(dict(sha256=manifest['sha256'],fixtures=fixtures),indent=2))

result=dict(sha256=manifest['sha256'],checks=checks,hardware_tested=False,
 limitations='Compiled RV32IM execution against bounded peripheral models; native USB/clock/reset calls stubbed. Does not validate physical polarity, settling, ADC responses, USB IRQ timing, flash electrical behavior, recovery reset writer or RGB. No connected-device access.')
(HERE/'verification.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
