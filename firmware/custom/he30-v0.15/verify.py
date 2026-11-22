"""Run the compiled RV32IMC bytes, not a host-language copy of the engine.

USB upload, ADC, GPIO, timer and flash are bounded models. This verifies
software behavior and addresses, not electrical behavior, interrupts or timing.
No connected device is opened. Run build.py first.
"""
import hashlib,json,os,struct,zlib
from pathlib import Path
HERE=Path(__file__).resolve().parent
BUILD=Path(os.environ.get('HE30_BUILD_DIR',HERE))
manifest=json.loads((BUILD/'manifest.json').read_text())
image=(BUILD/manifest['name']).read_bytes()
symbols=json.loads((BUILD/'symbols.json').read_text())
layout=json.loads((BUILD/'layout.json').read_text())
assert hashlib.sha256(image).hexdigest()==manifest['sha256']
S=0x20004000;TEMP=0x20006c00;END=0xdead0000
MASK=0xffffffff
def sx(v,b=32):return v-(1<<b) if v&(1<<(b-1)) else v
def divs(a,b):
    if not b:return -1
    return (abs(a)//abs(b))*(-1 if (a<0) != (b<0) else 1)
class PowerCut(Exception):pass
class IllegalInstruction(Exception):pass

def expand(w):
    """Expand the RV32C integer encodings used by the linked image."""
    q=w&3; funct=w>>13; rd=(w>>7)&31; rs=(w>>2)&31
    small=8+((w>>7)&7); small2=8+((w>>2)&7)
    imm=sx(((w>>12)&1)<<5|rs,6)
    def it(op,d,fun,a,n):return (n&4095)<<20|a<<15|fun<<12|d<<7|op
    def st(a,b,n):return ((n>>5)&127)<<25|b<<20|a<<15|2<<12|(n&31)<<7|0x23
    def rt(d,a,b,fun,top=0):return top<<25|b<<20|a<<15|fun<<12|d<<7|0x33
    if q==0:
        if funct==0:
            n=((w>>7)&15)<<6|((w>>11)&3)<<4|((w>>5)&1)<<3|((w>>6)&1)<<2
            assert n;return it(0x13,small2,0,2,n)
        n=((w>>10)&7)<<3|((w>>6)&1)<<2|((w>>5)&1)<<6
        if funct==2:return it(3,small2,2,small,n)
        if funct==6:return st(small,small2,n)
    if q==1:
        if funct==0:return it(0x13,rd,0,rd,imm)
        if funct==2:return it(0x13,rd,0,0,imm)
        if funct in [1,5]:
            n=sx(((w>>12)&1)<<11|((w>>11)&1)<<4|((w>>9)&3)<<8|((w>>8)&1)<<10|((w>>7)&1)<<6|((w>>6)&1)<<7|((w>>3)&7)<<1|((w>>2)&1)<<5,12)
            return ((n>>20)&1)<<31|((n>>1)&1023)<<21|((n>>11)&1)<<20|((n>>12)&255)<<12|(int(funct==1)<<7)|0x6f
        if funct==3:
            if rd!=2:return ((imm<<12)&0xfffff000)|rd<<7|0x37
            n=sx(((w>>12)&1)<<9|((w>>6)&1)<<4|((w>>5)&1)<<6|((w>>3)&3)<<7|((w>>2)&1)<<5,10)
            return it(0x13,2,0,2,n)
        if funct==4:
            code=(w>>10)&3
            if code<2:return it(0x13,small,5,small,rs|(1024 if code else 0))
            if code==2:return it(0x13,small,7,small,imm)
            fn=(w>>5)&3
            return rt(small,small,small2,[0,4,6,7][fn],32 if fn==0 else 0)
        if funct>=6:
            n=sx(((w>>12)&1)<<8|((w>>10)&3)<<3|((w>>5)&3)<<6|((w>>3)&3)<<1|((w>>2)&1)<<5,9)
            return ((n>>12)&1)<<31|((n>>5)&63)<<25|small<<15|(funct-6)<<12|((n>>1)&15)<<8|((n>>11)&1)<<7|0x63
    if q==2:
        if funct==0:return it(0x13,rd,1,rd,rs)
        if funct==2:
            n=((w>>12)&1)<<5|((w>>4)&7)<<2|((w>>2)&3)<<6
            return it(3,rd,2,2,n)
        if funct==4:
            high=(w>>12)&1
            if not rs:return it(0x67,high,0,rd,0)
            return rt(rd,rd if high else 0,rs,0)
        if funct==6:
            n=((w>>9)&15)<<2|((w>>7)&3)<<6
            return st(2,rs,n)
    raise AssertionError(f'Unsupported compressed instruction {w:04x}')

DIAGNOSTICS=manifest.get('save_diagnostics',False)
FLASH_RESIDENT_SAVE=manifest.get('flash_resident_save',False)
FN_RGB=manifest.get('fn_rgb',False)
FN_PAGES=[int(p,16) for p in manifest.get('fn_light_pages',[])]
def writable(address):
    return 0x0801e000<=address<0x08020000 or any(p<=address<p+768 for p in FN_PAGES)
SRAM_WRITER=DIAGNOSTICS and not FLASH_RESIDENT_SAVE
RAM_BEGIN=symbols.get('__ramflash_begin',0)
RAM_END=symbols.get('__ramflash_end',0)
SAVE_TRACE=0x20007400
writer_bounds=(RAM_BEGIN,RAM_END) if SRAM_WRITER else (0x1b000,0x1e000)
assert all(writer_bounds[0] <= symbols[n] < writer_bounds[1] for n in ('stored_byte','flash_writer'))

class CPU:
    def __init__(self):
        self.ram=bytearray(32768);self.flash=bytearray(image);self.r=[0]*32
        self.regs={};self.csr={0x300:8};self.time=0;self.instructions=0;self.calls=[];self.writes=[]
        self.user_mode=manifest.get('user_mode_save',False)
        self.flash_read_protected=FLASH_RESIDENT_SAVE
        self.flash_buffer_busy=FLASH_RESIDENT_SAVE
        self.sent=[];self.adc_samples={};self.busy=0;self.fail=None;self.adc_ready=False;self.conversions=[];self.first_rank_sample=None
        self.native_test_ranges=()
        self.native_usb_borrows_timer=False
        self.latch={0x40010800:0,0x40011000:0x6000,0x40010c00:0x400};self.unlock=0;self.mode_unlock=0;self.page_buffer={};self.erases=[];self.programs=[];self.cut=None;self.dma_frames=[]
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
        assert (0x40023400<=a<0x40023500 or n==4 or n==2 and a in [b+i for b in [0x40003800,0x40013000] for i in [0,4,8]]) and (0x40000000<=a<0x40030000 or 0xe000f000<=a<=0xe000f014),f'Invalid read {a:#x}/{n}'
        if a in [0x40003808,0x40013008]:return 128 if self.fail=='spi' else 0
        if a==0xe000f008:return self.time&MASK
        if a==0x4002200c and self.flash_buffer_busy:
            status=self.regs.get(a,0)
            self.regs[a]=status&~2
            return status
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
            ch=self.regs[0x40012434];self.conversions.append((banks[0],ch));return self.adc_samples.get((banks[0],ch),1000+banks[0]*500+ch*11)
        return self.regs.get(a,0)
    def put(self,a,v,n=1):
        v&=(1<<(8*n))-1
        if 0x20000000<=a and a+n<=0x20008000:
            self.ram[a-0x20000000:a-0x20000000+n]=v.to_bytes(n,'little');return
        f=self.physical(a)
        if f is not None:
            assert n==4 and a%4==0 and writable(a) and self.mode_unlock==2
            assert writer_bounds[0]<=self.pc<writer_bounds[1]
            assert self.regs.get(0x40022010,0)&0x10000
            assert a&~255==self.erases[-1], 'Write outside the last erased row'
            if self.flash_buffer_busy:
                assert not self.regs.get(0x4002200c,0)&2, 'Buffer write while WRBSY is set'
                self.regs[0x4002200c]=0x23
            self.page_buffer[a]=v
            return
        assert (0x40023400<=a<0x40023500 or n==4 or n==2 and a in [b+i for b in [0x40003800,0x40013000] for i in [0,4]]) and (0x40000000<=a<0x40030000 or 0xe000f000<=a<=0xe000f014),f'Invalid write {a:#x}/{n}'
        self.writes.append((a,v));self.regs[a]=v
        if a==0x40020004:self.regs[0x40020000]=self.regs.get(0x40020000,0)&~v
        if a in [0x40020058,0x40020030] and v&1:
            assert v==0x2091;path=1 if a==0x40020058 else 2;count=self.regs[a+4]
            assert count>=128 and count<=896 and (count-128)%12==0
            assert self.regs[a+8]==(0x4000380c if path==1 else 0x4001300c)
            assert self.regs[a+12]==S+layout['rgb_frame']
            self.dma_frames.append((path,self.blob(self.regs[a+12],n=count)))
            if self.fail!='dma':self.regs[0x40020000]=self.regs.get(0x40020000,0)|(0x20000 if path==1 else 0x200)
        if a in [0x40010810,0x40010814,0x40011010,0x40010c10,0x40011014,0x40010c14]:
            p=a&~31
            if a&31==0x10:self.latch[p]=(self.latch[p]|(v&65535))&~(v>>16)
            else:self.latch[p]&=~v
        if a==0x40012400:self.adc_ready=False
        if a==0x40012408 and v&0x500000==0x500000:
            self.adc_ready=self.fail!='conversion'
            if v&0x100 and self.regs.get(0x40020008,0)&1:
                count=self.regs[0x4002000c]
                assert count in ([12,13] if FN_RGB else [12]) and self.regs[0x40020010]==0x4001244c
                assert (self.regs[0x4001242c]>>20&15)==count-1
                if self.fail=='dma_adc':self.regs[0x40020000]|=8
                elif self.fail!='conversion':
                    banks=[i for i,(port,mask) in enumerate([(0x40011000,0x2000),(0x40011000,0x4000),(0x40010c00,0x400)]) if not self.latch[port]&mask]
                    assert len(banks)==1
                    for i in range(count):
                        channel=(self.regs[0x40012434-4*(i//6)]>>((i%6)*5))&31
                        self.conversions.append((banks[0],channel))
                        sample=self.adc_samples.get((banks[0],channel),1000+banks[0]*500+11*channel)
                        if i==0 and self.first_rank_sample is not None:sample=self.first_rank_sample
                        self.put(self.regs[0x40020014]+2*i,sample,2)
                    self.regs[0x40020000]|=2
        if a==0xe000f008:self.time=v
        if a==0x40022004:
            if v==0x45670123:self.unlock=1
            elif v==0xcdef89ab and self.unlock==1:
                self.unlock=2;self.regs[0x40022010]=self.regs.get(0x40022010,0)&~0x80
            else:raise AssertionError('Bad flash unlock')
        if a==0x40022024:
            if v==0x45670123:self.mode_unlock=1
            elif v==0xcdef89ab and self.mode_unlock==1:
                self.mode_unlock=2;self.regs[0x40022010]=self.regs.get(0x40022010,0)&~0x8000
            else:raise AssertionError('Bad fast flash unlock')
        if a==0x4002200c:self.regs[a]=0
        if a==0x40022010:
            if v&0x80:self.unlock=0
            if v&0x8000:self.mode_unlock=0
            if v&0x20040==0x20040:
                page=self.regs[0x40022014]
                assert self.unlock==2 and self.mode_unlock==2 and writable(page) and page%256==0
                self.regs[a]&=~0x40
                if self.flash_read_protected and not 0x5000<=self.pc<0x20000:
                    self.regs[0x4002200c]=0x10
                    return
                off=self.physical(page);self.flash[off:off+256]=b'\xff'*256
                self.erases.append(page);self.page_buffer.clear()
            if v&0x210000==0x210000:
                assert len(self.page_buffer)==64
                if self.flash_buffer_busy:
                    assert not self.regs.get(0x4002200c,0)&2, 'Program command before buffer is ready'
                    self.regs[0x4002200c]=0x20
                for address,word in self.page_buffer.items():
                    if self.cut is not None and len(self.programs)>=self.cut:raise PowerCut()
                    off=self.physical(address)
                    assert int.from_bytes(self.flash[off:off+4],'little')&word==word
                    self.flash[off:off+4]=word.to_bytes(4,'little');self.programs.append(address)
                self.page_buffer.clear();self.regs[a]&=~0x200000
    def call(self,name,*args,limit=4000000,stop=None):
        self.r=[(0x12300000+i*13)&MASK for i in range(32)];self.r[0]=0;self.r[1]=END;self.r[2]=0x20008000;self.r[3]=0x20000a30
        for i,v in enumerate(args):self.r[10+i]=v
        before=self.r[:];pc=symbols[name] if isinstance(name,str) else name
        for step in range(limit):
            self.pc=pc
            if pc==END:
                assert all(self.r[i]==before[i] for i in [2,3,4,8,9,*range(18,28)]),'C ABI/stack corruption'
                return self.r[10]
            if stop and stop(self,pc):return step
            if pc in [0x795e,0x15e7e,0x52c0,0x5412,0x5506,0x67b0]:
                self.calls.append(pc)
                if pc==0x5412 and self.native_usb_borrows_timer:
                    # The donor's one-shot delay replaces the compare value
                    # and clears the timer enable bit before returning.
                    self.put(0xe000f010,180,4)
                    self.put(0xe000f014,0,4)
                    self.put(0xe000f008,180,4)
                    self.put(0xe000f000,0x30,4)
                if pc==0x5506:
                    ep,p,n,copy=self.r[10:14]
                    packets={(1,8),(2,64),(3,20)}
                    if manifest.get('nkro'):packets.add((1,29))
                    if manifest.get('usb_lighting_fix'):packets.update({(4,3),(4,5)})
                    elif manifest.get('desktop_keys'):packets.add((4,4))
                    assert copy==1 and (ep,n) in packets
                    if self.busy:self.busy-=1;self.r[10]=0
                    else:self.sent.append((ep,self.blob(p,n=n)));self.r[10]=1
                pc=self.r[1];continue
            valid_native=any(start<=pc<end for start,end in self.native_test_ranges)
            assert pc%2==0 and (0x18c7c<=pc<0x19000 or 0x19158<=pc<0x1e000 or RAM_BEGIN<=pc<RAM_END or FN_RGB and 0xea00<=pc<0xf900 or manifest.get('usb_lighting_fix') and 0x24000<=pc<0x25000 or valid_native),f'Invalid PC {pc:#x}'
            w=self.get(pc,4);size=4
            if (w&3)!=3:w=expand(w&65535);size=2
            op=w&127;rd=w>>7&31;f=w>>12&7;a=w>>15&31;b=w>>20&31;top=w>>25
            x=self.r[a];y=self.r[b];nxt=pc+size;val=None
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
                val=pc+size;imm=sx((w>>31)<<20|(w>>12&255)<<12|(w>>20&1)<<11|(w>>21&1023)<<1,21);nxt=pc+imm
            elif op==0x67:assert f==0;val=pc+size;nxt=(x+sx(w>>20,12))&0xfffffffe
            elif op==0x0f:pass # fence/fence.i, single-threaded model
            elif op==0x73:
                assert f in [1,2,3,5,6,7];csr=w>>20
                if self.user_mode and csr&0x300:
                    raise IllegalInstruction(f'U-mode access to CSR {csr:#x} at {pc:#x}')
                # QingKe's GINTENR exposes the interrupt bits of mstatus in U-mode.
                csr_mask=0x88 if csr==0x800 else MASK
                if csr==0x800:csr=0x300
                previous=self.csr.get(csr,0);old=previous&csr_mask;v=a if f>=5 else x;val=old
                updated={1:v,2:old|v,3:old&~v}[f if f<5 else f-4]&csr_mask
                self.csr[csr]=(previous&~csr_mask)|updated
            else:raise AssertionError(f'Unsupported instruction {w:08x} at {pc:#x}')
            if val is not None and rd:self.r[rd]=val&MASK
            self.r[0]=0;pc=nxt;self.instructions+=1
            if self.regs.get(0xe000f000,0)&1:self.time+=8
        raise AssertionError(f'Instruction budget exceeded at {pc:#x}')

def fresh():
    c=CPU()
    if manifest.get('factory_defaults'):
        c.flash[0x19000:0x1a000]=b'\xff'*4096
        c.flash[0xa900:0xac00]=b'\xff'*768
    c.blob(0x20000100,image[0x13b24:0x13b24+91])
    c.call('gp_defaults',0x20003700)
    c.call('config_defaults',S+layout['cfg'])
    c.call('lighting_defaults')
    c.call('profiles_defaults')
    c.call('gpio_poll_setup')
    c.call('time_init')
    c.usb()
    return c

def request(c,cmd,op,data=b'',off=0,length=None):
    body=bytes(data);n=len(body) if length is None else length
    p=bytearray(64);p[:8]=bytes([0x55,cmd,op,0,n,off&255,off>>8,0]);p[8:8+len(body)]=body;p[3]=sum(p[4:8+n])&255
    c.blob(TEMP,p);c.call('vendor_request',TEMP)
    reply=c.blob(S+layout['vendor'],n=64)
    assert reply[:2]==bytes([0xaa,cmd]) and reply[3]==sum(reply[4:8+reply[4]])&255
    return reply

def control(c,op):
    return request(c,0xd0,op)[2]

def pset(c,op,data,off=0):
    r=request(c,0xd2,op,data,off)
    assert r[2]==0,(op,r.hex())
    assert r[4:8]==bytes(4)

def read(c,cmd,op,n):
    result=b''
    for i in range(0,n,56):
        amount=min(56,n-i)
        r=request(c,cmd,op,off=i,length=amount)
        assert not r[2] and r[4]==amount and int.from_bytes(r[5:7],'little')==i
        result+=r[8:8+amount]
    return result

def configure(c,cfg):
    for i in range(0,len(cfg),56):assert request(c,0xd0,2,cfg[i:i+56],i)[2]==0
    assert request(c,0xd0,3,struct.pack('<I',zlib.crc32(cfg)))[2]==0

def frames(c,depths=None,n=18):
    values=[1000]*36
    for i,level in (depths or {}).items():values[i]=level
    c.blob(TEMP,struct.pack('<36H',*values))
    for _ in range(n):c.call('engine_step',TEMP)
    return c.blob(S+layout['report'],n=8)

def get_wire(c):
    return read(c,0xd0,1,664)

def calibrated(c):
    cfg=bytearray(get_wire(c))
    struct.pack_into('<II',cfg,8,0xffffffff,15)
    struct.pack_into('<36H',cfg,16,*[1000]*36)
    struct.pack_into('<36H',cfg,88,*[3000]*36)
    configure(c,cfg);assert control(c,6)==0
    ready(c)

def ready(c):
    c.call('keyboard_service')
    frames(c)

def rule(c,kind,host,other=0,mode=0,usage=(0,0,0,0),depth=(0,0,0),slot=0):
    pset(c,5,struct.pack('<8B3H',kind,host,other,mode,*usage,*depth),slot)
    ready(c)

def saved_image(c):
    return bytes(c.flash)

def reboot(image):
    d=fresh();d.flash[:]=image;assert d.call('load_saved')==0;d.call('gpio_poll_setup')
    return d

checks=[]
def check(name):
    print('PASS '+name,flush=True);checks.append(name)

# Model a cold boot with the observed idle readings. Drives the actual
# compiled startup, ADC path, scan loop and USB report sender.
import re
idle=[int(x) for x in re.search(r'\{(.*?)\}',(HERE/'startup-reference.h').read_text())[1].split(',')]
slots=[(g,ch) for g in [2,0,1] for ch in [6,7,14,15,8,9,5,4,12,13,11,10]]
boot=fresh()
boot.adc_samples=dict(zip(slots,idle))
def exercise_default_typing(cpu,pc):
    frame=cpu.field('frames',size=4)
    if frame<40:
        # Hold A during power-up. The firmware must not learn it as idle.
        cpu.adc_samples[slots[32]]=idle[32]-1000
    elif frame<85:
        cpu.adc_samples[slots[32]]=idle[32]
    elif frame<98:
        cpu.adc_samples[slots[32]]=idle[32]-1000
    else:
        cpu.adc_samples[slots[32]]=idle[32]
    return frame>=112
boot.call('firmware_main',limit=14_000_000,stop=exercise_default_typing)
packets=[p for ep,p in boot.sent if ep==1]
assert packets==[bytes(8),bytes([0,0,4,0,0,0,0,0]),bytes(8)],packets
assert boot.field('enabled') and not boot.field('scan_error')
boot_status=read(boot,0xd0,0,208)
assert boot_status[200]==36 and boot_status[203]==2
assert not boot.erases and not boot.programs
check('Clean image types automatically after quiet startup; held boot key is ignored')

# Expected physical Main layout in row-independent ADC order. Both Fn layers
# must be fully transparent in all four factory slots, including default Fn.
factory=bytes.fromhex('3A 3B 3C 3D 3E 3F 35 2C FF E2 E0 05 23 2B 14 1A 08 15 22 21 1F 20 1E 29 0A E1 1D 1B 06 19 09 07 04 16 39 17')
factory_cpu=fresh()
for slot in range(4):
    pset(factory_cpu,2,bytes([slot]))
    wire=get_wire(factory_cpu)
    profile=read(factory_cpu,0xd2,1,976)
    assert wire[168::14]==factory
    assert wire[169::14]==bytes([254])*36
    assert profile[632:668]==bytes([254])*36
assert control(factory_cpu,7)==0
assert control(factory_cpu,8)==0
assert not reboot(saved_image(factory_cpu)).field('enabled')
check('All four default maps match the physical board; a saved Disable overrides factory defaults')

c=fresh();status=read(c,0xd2,0,88)
assert status[:12]==b'H3P1\1\0\3\0\0\3\0\10'
assert [status[24+i*16:33+i*16] for i in range(4)]==[f'Profile {i+1}'.encode() for i in range(4)]
assert c.get(0x20000102)==66 and c.get(0x20000104)==2
assert control(c,6)==0
calibrated(c)
assert frames(c,{32:3000})[2]==4
check('H3P1 and three-layer profile storage, calibration gate and stock key path')

# Functional Fn2 and physical key latch after releasing the layer key.
cfg=bytearray(get_wire(c));cfg[160+8*14+8]=253;configure(c,cfg)
pset(c,4,b'\x05',32);ready(c)
assert frames(c,{8:3000,32:3000})[2]==5
assert frames(c,{32:3000})[2]==5
assert frames(c,{})[2]==0
assert frames(c,{32:3000})[2]==4
check('Fn2 and press-latched reports')

# Neutral and last-input SOCD; Rappy Snappy compares travel and permits dual bottom-out.
rule(c,1,32,31);assert frames(c,{32:2900,31:2500})[2:]==bytes(6)
rule(c,1,32,31,3);assert frames(c,{32:2800})[2]==4
assert frames(c,{32:2800,31:2600})[2]==7
assert frames(c,{32:2800})[2]==4
rule(c,2,32,31,0,depth=(10,0,0))
assert frames(c,{32:2600,31:2800})[2]==7
assert frames(c,{32:3000,31:3000})[2:4]==b'\x07\x04'
check('SOCD priorities and Rappy Snappy compare physical positions')

rule(c,3,32,usage=(4,5,6,7),depth=(300,700,0))
c.time+=100*144000
assert frames(c,{32:2000},n=8)[2]==4
def complete_tap(level):
    c.time+=13*144000
    assert frames(c,{32:level},n=4)[2]==0
    c.time+=10*144000
complete_tap(2000)
assert frames(c,{32:3000},n=16)[2]==5
complete_tap(3000)
assert frames(c,{32:2000},n=16)[2]==6
complete_tap(2000)
assert frames(c,{32:1000},n=16)[2]==7
check('Four DKS phases generate their own tapped outputs')

rule(c,8,32,usage=(4,5,6,0),depth=(200,500,800))
assert frames(c,{32:2900})[2:5]==b'\x04\x05\x06'
rule(c,5,32,usage=(9,0,0,0));assert frames(c,{32:3000})[2]==9
assert frames(c,{})[2]==9
assert frames(c,{32:3000})[2]==0
rule(c,6,32,usage=(4,5,0xe1,0))
assert frames(c,{32:3000})[:4]==b'\2\0\4\5'
check('Three-point trigger, Toggle and Key Combination')
rule(c,4,32,usage=(4,0xe1,0,0),depth=(180,0,0))
assert frames(c,{32:3000})[:4]==bytes(4)
assert frames(c,{})[2]==4
c.time+=20*144000
frames(c,{32:3000})
c.time+=180*144000
assert frames(c,{32:3000})[0]==2
assert frames(c,{})[0]==0
rule(c,7,32,usage=(4,5,6,7),depth=(24,0,0))
assert frames(c,{32:3000})[2]==4
c.time+=27*144000
assert frames(c,{32:3000})[2]==0
c.time+=24*144000
assert frames(c,{32:3000})[2]==5
rule(c,9,32,usage=(4,5,0,0),depth=(20,0,0))
assert frames(c,{32:3000})[2]==4
assert frames(c,{})[2]==0
c.time+=21*144000
assert frames(c,{})[2]==5
check('Mod Tap distinguishes holds; macro and End Key timing generate release gaps')


# Per-key coefficient cache, default curve remains linear.
pset(c,6,struct.pack('<HH',4000,13770),32);ready(c);frames(c,{32:2000})
sample=read(c,0xd0,0,208)
assert 500<int.from_bytes(sample[168:170],'little')<1000
assert int.from_bytes(read(c,0xd2,1,976)[968:970],'little')==13770
check('Per-key Hall coefficient changes normalized depth and is readable')

pset(c,3,b'Slot One'+bytes(8))
pset(c,2,b'\1')
assert get_wire(c)[160+8*14+8]==255
pset(c,3,b'Slot Two'+bytes(8))
pset(c,7,b'\2',32)
pset(c,8,b'\6\2\1')
pset(c,2,b'\0')
assert read(c,0xd2,1,976)[704:712]==b'Slot One'
assert get_wire(c)[160+8*14+8]==253
assert control(c,8)==0 and c.erases==([FN_PAGES[0]+256*i for i in range(3)] if FN_RGB else [])+list(range(0x0801e000,0x0801f000,256))
d=reboot(saved_image(c))
assert d.get(0x20000102)==106 and d.get(0x20000104)==3
assert read(d,0xd2,0,88)[5:11]==b'\0\6\2\1\0\1'
pset(d,2,b'\1')
assert read(d,0xd2,1,976)[704:712]==b'Slot Two'
assert read(d,0xd2,1,976)[700]==2
check('Four-profile library persists independently across simulated power cycle')

if manifest.get('profile_keys'):
    a,fn=32,8
    key_offset=160+14*a
    hotkeys=fresh()
    calibrated(hotkeys)
    for index in range(4):
        pset(hotkeys,2,bytes([index]));ready(hotkeys)
        cfg=bytearray(get_wire(hotkeys))
        target=0xf0+((index+1)%4)
        if index==1:
            cfg[key_offset+9]=target
        elif index==2:
            cfg[160+14*fn+8]=0xfd
            pset(hotkeys,4,bytes([target]),a)
        else:
            cfg[key_offset+8]=target
        if index==0:
            cfg[key_offset+10:key_offset+13]=bytes([24,125,45]) # 12.5%, 30.1%
        if index==3:
            cfg[key_offset+11:key_offset+13]=bytes([6,12]) # legacy whole percent
        configure(hotkeys,cfg);ready(hotkeys)
    pset(hotkeys,2,b'\0');ready(hotkeys)
    assert request(hotkeys,0xd3,2,b'\0')[2]==0
    for index in range(4):
        held={fn:3000} if index in (1,2) else {}
        if held:frames(hotkeys,held)
        held[a]=3000
        assert frames(hotkeys,held)==bytes(8)
        assert read(hotkeys,0xd2,0,88)[5]==(index+1)%4
        if index==0:
            assert request(hotkeys,0xd3,2,b'\0',1)[2]==5
        hotkeys.call('keyboard_service')
        assert frames(hotkeys,held)==bytes(8)
        assert read(hotkeys,0xd2,0,88)[5]==(index+1)%4
        ready(hotkeys)
    assert control(hotkeys,8)==0
    restored=reboot(saved_image(hotkeys))
    assert get_wire(restored)[key_offset+8:key_offset+13]==bytes([0xf1,254,24,125,45])
    pset(restored,2,b'\3')
    assert get_wire(restored)[key_offset+10:key_offset+13]==bytes([0,6,12])
    check('Main, Fn1 and Fn2 profile shortcuts switch all four slots once per press and preserve legacy and fine dead zones on reboot')
    check('Profile switches discard partial controller settings uploads')

# A half-programmed second page must not supersede the previous valid page.
d.cut=100
try:control(d,8)
except PowerCut:pass
else:raise AssertionError('Save was not interrupted')
e=reboot(saved_image(d));assert read(e,0xd2,0,88)[5]==0
if SRAM_WRITER:e.call('prepare_flash_worker')
assert e.call('flash_writer',0x0801d000,S+layout['library'],1)==9
check('Commit-last flash alternation and address guard')

pset(e,2,b'\1');pset(e,7,b'\1',31);ready(e)
e.call('gp_service');e.time+=144000
frames(e,{31:3000,32:3000})
e.call('gp_service')
assert e.sent[-1]==(3,bytes([0,20])+bytes(18))
frames(e,{32:3000});e.time+=144000;e.call('gp_service')
assert int.from_bytes(e.sent[-1][1][6:8],'little',signed=True)==32767
assert e.blob(S+layout['report'],n=8)[2]==0
check('XInput mode sums opposite analog sources and suppresses assigned keyboard reports')

start=fresh();start.flash[:]=saved_image(e)
start.call('firmware_main',limit=4500000,stop=lambda cpu,pc:cpu.field('frames',size=4)>=2)
assert start.calls[:4]==[0x795e,0x15e7e,0x52c0,0x5412]
assert start.latch[0x40010800]&0x600==0x600
expected_channels=[10,7,14,15,8,9,5,4,12,13,11,6] if FN_RGB else [6,7,14,15,8,9,5,4,12,13,11,10]
if manifest.get('calibration_qol'):expected_channels=[6,6,7,14,15,8,9,5,4,12,13,11,10]
assert start.conversions[:len(expected_channels)*3]==[(g,ch) for g in [2,0,1] for ch in expected_channels]
assert not start.programs and not start.erases
for _ in range(20):
    start.time+=20*144000;start.call('rgb_service')
assert {path for path,_ in start.dma_frames}=={1,2}
live=read(start,0xd1,8,123)
assert live[:3]==b'\x10'*3 and live[108:]==b'\x10'*15
assert read(start,0xd1,0,160)[:5]==b'H3L1\4'
check('Full startup uses PA9/PA10 power, banked DMA scan, both RGB chains and live pixels')
assert request(start,0xd1,4)[2]==0
for _ in range(10):
    start.time+=20*144000;start.call('rgb_service')
assert read(start,0xd1,8,123)==bytes(123)
header=bytearray(read(start,0xd1,0,160)[16:28])
header[1]=4
assert request(start,0xd1,1,header)[2]==0
for _ in range(12):
    start.time+=20*144000;start.call('rgb_service')
animated=read(start,0xd1,8,123)
assert 0<max(animated[:108])<=16 and not any(animated[108:])
check('RGB off and generated color wave reach completed frame readback')


# The web tests consume exact replies from the compiled handlers.
fixtures=[]
fixture= fresh()
for command,op,length in [(0xd0,0,208),(0xd0,1,664),(0xd1,0,160),(0xd1,8,123),(0xd2,0,89 if manifest.get('desktop_keys') else 88),(0xd2,1,976),(0xd3,0,40),(0xd3,1,292)]+([(0xd1,9,73)] if FN_RGB else [])+([(0xd1,11,4)] if manifest.get('usb_lighting_fix') else []):
    ranges=([(slot*128+off,n) for slot in range(8) for off,n in [(0,55),(55,18)]] if op==9 else
            [(slot,4) for slot in range(4)] if op==11 else [(0,8)]+[(off,min(56,length-off)) for off in range(0,length,56)])
    for off,n in ranges:
        reply=request(fixture,command,op,off=off,length=n)
        packet=fixture.blob(TEMP,n=64)
        fixtures.append(dict(phase='default',request=packet.hex(),response=reply.hex()))
(BUILD/'protocol-fixtures.json').write_text(json.dumps(dict(sha256=manifest['sha256'],fixtures=fixtures),indent=2))
report={'sha256':manifest['sha256'],'checks':checks,'hardware_tested':False,
        'limitations':'Compiled RV32IMC executed against modeled peripherals. No physical flash, scan rate, RGB fidelity, USB negotiation, or Windows driver behavior inferred.'}
(BUILD/'verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
