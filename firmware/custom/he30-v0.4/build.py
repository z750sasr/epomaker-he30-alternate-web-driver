"""Pinned v0.3 -> opt-in ADC/bank and dim SPI/DMA LED diagnostics.

No connected-device access. Peripheral addresses/bitfields are checked against
the retained WCH SDK; board pin routing remains a donor-based hypothesis.
"""
from pathlib import Path
import importlib.util
import hashlib
import json
import struct

HERE=Path(__file__).resolve().parent
PREVIOUS=HERE.parent/'he30-v0.3'
spec=importlib.util.spec_from_file_location('he30_v03_builder',PREVIOUS/'build.py')
base=importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
BASE_HASH='efaad04ebbed9a32d9d11545f182338e29a5ed6d41fa89c95dd4e8c0ca55103f'
NAME='Epomaker-HE30-EXPERIMENTAL-v0.4-Mapping-RGB.bin'
ALIAS=base.ALIAS; CAVE=0x1B000; STATUS=base.STATUS; GP=base.GP; REPORT=base.REPORT
FRAME=0x20004400; FRAME_BYTES=896
CHANNELS=[10,11,12,13,4,5,6,7,14,15,8,9]

class Assembler(base.Assembler):
    def __init__(self):super().__init__(CAVE)
    def la(self,rd,label): self.fixups.append((len(self.words),'address',label,rd,0,0));self.emit(0);self.emit(0)
    def finish(self):
        rest=[]
        for i,k,target,rd,a,b in self.fixups:
            if k!='address':rest.append((i,k,target,rd,a,b));continue
            n=self.labels[target]; upper=(n+0x800)>>12;lo=n-(upper<<12)
            self.words[i]=(upper&0xfffff)<<12|rd<<7|0x37
            self.words[i+1]=base.signed(lo,12)<<20|rd<<15|rd<<7|0x13
        self.fixups=rest;return super().finish()
    def shift(self,rd,rs,n,right=False):self.imm(0x13,rd,5 if right else 1,rs,n)
    def write_reg(self,address,value):self.li(5,address);self.li(6,value);self.store(6,5)
    def modify(self,address,clear,setbits=0):
        self.li(5,address);self.load(6,5);self.li(7,(~clear)&0xffffffff);self.op(6,6,7,7)
        if setbits:self.li(7,setbits);self.op(6,6,7,6)
        self.store(6,5)
    def delay(self,count,label):
        self.li(5,count);self.label(label);self.addi(5,5,-1);self.branch(1,5,0,label)
    def save(self,regs):
        n=((len(regs)*4+15)//16)*16;self.addi(2,2,-n)
        for i,r in enumerate(regs):self.store(r,2,n-4-i*4)
        return n
    def restore(self,regs,n):
        for i,r in enumerate(regs):self.load(r,2,n-4-i*4)
        self.addi(2,2,n)

def hardware_code(old_labels):
    a=Assembler(); a.label('request')
    a.lbu(5,9);a.addi(6,0,0x55);a.branch(1,5,6,'legacy')
    a.lbu(5,9,1);a.addi(6,0,0xdb);a.branch(0,5,6,'custom')
    a.addi(6,0,0xdd);a.branch(0,5,6,'custom')
    a.label('legacy');a.lbu(5,3,-0x7c7);a.jump(old_labels['request']+4)
    a.label('custom')
    a.lbu(5,3,-0x7c7);a.addi(6,0,1);a.branch(1,5,6,'return')
    a.lbu(5,3,-0x7bc);a.branch(1,5,0,'return')
    a.lbu(5,3,-0x7bd);a.branch(1,5,6,'return')
    regs=[1,18,19,20,21];frame=a.save(regs)
    a.sb(0,3,-0x7bd);a.load(5,8,12);a.addi(5,5,1);a.store(5,8,12)
    a.addi(5,0,0x55);a.sb(5,8,7)
    a.li(5,int.from_bytes(b'H3M1','little'));a.store(5,8,64);a.addi(5,0,1);a.sb(5,8,68)
    a.lbu(5,3,-0x7bb);a.addi(6,0,64);a.branch(1,5,6,'reject')
    for offset in [2,6,7]:a.lbu(5,9,offset);a.branch(1,5,0,'reject')
    a.lbu(10,9,4);a.addi(5,0,56);a.branch(6,5,10,'reject')
    a.addi(5,9,4);a.addi(6,10,4);a.addi(7,0,0)
    a.label('request_sum');a.lbu(28,5);a.op(7,7,28);a.addi(5,5,1);a.addi(6,6,-1);a.branch(1,6,0,'request_sum')
    a.andi(7,7,255);a.lbu(5,9,3);a.branch(1,7,5,'reject')
    a.lbu(12,9,1);a.addi(5,0,0xdd);a.branch(0,12,5,'action')
    a.lbu(11,9,5);a.op(5,10,11);a.addi(6,0,160);a.branch(6,6,5,'reject')
    # Bounded snapshot reads touch SRAM only; they never start peripherals.
    a.addi(13,0,0);a.jump('reply')

    a.label('action')
    a.addi(5,0,12);a.branch(1,10,5,'reject');a.lbu(5,9,5);a.branch(1,5,0,'reject')
    for i,v in enumerate(b'TEST',8):a.lbu(5,9,i);a.addi(6,0,v);a.branch(1,5,6,'reject')
    a.addi(5,9,19);a.addi(6,0,45)
    a.label('check_padding');a.lbu(7,5);a.branch(1,7,0,'reject');a.addi(5,5,1);a.addi(6,6,-1);a.branch(1,6,0,'check_padding')
    a.lbu(18,9,12);a.addi(5,0,1);a.branch(6,18,5,'reject');a.addi(5,0,4);a.branch(6,5,18,'reject')
    a.addi(5,0,3);a.branch(6,18,5,'validate_adc')
    a.lbu(5,9,13);a.addi(6,0,1);a.branch(6,5,6,'reject');a.addi(6,0,2);a.branch(6,6,5,'reject')
    a.lbu(5,9,14);a.addi(6,0,255);a.branch(0,5,6,'index_ok');a.addi(6,0,64);a.branch(7,5,6,'reject')
    a.label('index_ok')
    for offset in [15,16,17]:a.lbu(5,9,offset);a.addi(6,0,16);a.branch(6,6,5,'reject')
    a.lbu(5,9,18);a.addi(6,0,1);a.branch(6,6,5,'reject');a.jump('run_action')
    a.label('validate_adc')
    for offset in range(13,19):a.lbu(5,9,offset);a.branch(1,5,0,'reject')
    a.label('run_action')
    a.sb(0,8,71);a.store(18,8,76)
    a.addi(5,0,3);a.branch(6,18,5,'run_adc')
    a.stage(0x34);a.jump('rgb',1);a.jump('action_done')
    a.label('run_adc');a.stage(0x31);a.jump('adc',1)
    a.label('action_done');a.stage(48)
    a.addi(12,0,0xdd);a.addi(10,0,8);a.addi(11,0,64);a.lbu(13,8,71);a.jump('reply')
    a.label('reject');a.lbu(12,9,1);a.addi(10,0,0);a.addi(11,0,0);a.addi(13,0,1)
    a.label('reply')
    a.addi(5,9,0);a.addi(6,0,64)
    a.label('clear_reply');a.sb(0,5);a.addi(5,5,1);a.addi(6,6,-1);a.branch(1,6,0,'clear_reply')
    a.addi(5,0,0xaa);a.sb(5,9);a.sb(12,9,1);a.sb(13,9,2);a.sb(10,9,4)
    # Action ACK carries header64..71 but reports offset zero to the host.
    a.addi(5,0,0xdd);a.branch(0,12,5,'ack_offset');a.sb(11,9,5)
    a.label('ack_offset');a.op(5,8,11);a.addi(6,9,8);a.addi(7,10,0)
    a.branch(0,7,0,'reply_done')
    a.label('copy_reply');a.lbu(28,5);a.sb(28,6);a.addi(5,5,1);a.addi(6,6,1);a.addi(7,7,-1);a.branch(1,7,0,'copy_reply')
    a.label('reply_done');a.lbu(11,9,5);a.restore(regs,frame);a.jump(old_labels['checksum'])
    a.label('return');a.ret()

    # ADC1 single-shot reads. No donor Hall/calibration/settings routines or IRQs.
    a.label('adc');adc_regs=[1,18,19,20,21,22];adc_frame=a.save(adc_regs)
    a.li(18,0x40012400);a.addi(19,8,80);a.addi(21,0,0);a.lbu(22,9,12);a.sb(22,8,69)
    a.addi(5,0,72);a.addi(6,19,0);a.addi(7,0,-1)
    a.label('invalidate_samples');a.sb(7,6);a.addi(6,6,1);a.addi(5,5,-1);a.branch(1,5,0,'invalidate_samples')
    a.modify(0x40021018,0,0x21c) # GPIOA/B/C + ADC1 clocks.
    a.modify(0x40021004,0xc000,0xc000) # ADC clock PCLK2 /8.
    for address,mask in [(0x40010800,0xffff0000),(0x40010c00,0xff),(0x40011000,0xffffff)]:a.modify(address,mask)
    a.addi(5,0,2);a.branch(1,22,5,'adc_config')
    # Only action2 drives the three donor bank hypotheses; debug pins untouched.
    a.write_reg(0x40011010,0x6000);a.write_reg(0x40010c10,0x400)
    a.modify(0x40011004,0x0ff00000,0x02200000);a.modify(0x40010c04,0xf00,0x200)
    a.label('adc_config')
    for offset,value in [(4,0),(8,0xe0001),(12,0xffffff),(16,0x3fffffff),(44,0),(48,0),(52,0)]:a.li(5,value);a.store(5,18,offset)
    a.delay(2000,'adc_power_settle')
    for mask,error,label in [(8,1,'reset_cal'),(4,2,'cal')]:
        a.load(5,18,8);a.li(6,mask);a.op(5,5,6,6);a.store(5,18,8);a.li(7,25000)
        a.label(label+'_wait');a.load(5,18,8);a.andi(5,5,mask);a.branch(0,5,0,label+'_ok');a.addi(7,7,-1);a.branch(1,7,0,label+'_wait')
        a.addi(5,0,error);a.sb(5,8,71);a.jump('adc_cleanup');a.label(label+'_ok')
    a.label('adc_bank')
    a.addi(5,0,2);a.branch(1,22,5,'adc_channel_start')
    a.write_reg(0x40011010,0x6000);a.write_reg(0x40010c10,0x400)
    a.branch(0,21,0,'bank0');a.addi(5,0,1);a.branch(0,21,5,'bank1')
    a.write_reg(0x40010c14,0x400);a.jump('bank_settle')
    a.label('bank0');a.write_reg(0x40011014,0x2000);a.jump('bank_settle')
    a.label('bank1');a.write_reg(0x40011014,0x4000)
    a.label('bank_settle');a.delay(16000,'bank_settle_loop')
    a.label('adc_channel_start');a.addi(20,0,0)
    a.label('adc_channel');a.la(5,'channels');a.op(5,5,20);a.lbu(6,5);a.store(6,18,52)
    a.store(0,18,0);a.load(5,18,8);a.li(6,0x500000);a.op(5,5,6,6);a.store(5,18,8);a.li(7,25000)
    a.label('eoc_wait');a.load(5,18);a.andi(5,5,2);a.branch(1,5,0,'eoc_ok');a.addi(7,7,-1);a.branch(1,7,0,'eoc_wait')
    a.addi(5,0,3);a.sb(5,8,71);a.jump('adc_cleanup')
    a.label('eoc_ok');a.load(5,18,76);a.li(6,0xfff);a.op(5,5,6,7);a.store(5,19,0,1);a.addi(19,19,2)
    a.addi(20,20,1);a.addi(5,0,12);a.branch(6,20,5,'adc_channel')
    a.addi(5,0,2);a.branch(1,22,5,'adc_complete');a.addi(21,21,1);a.addi(5,0,3);a.branch(6,21,5,'adc_bank')
    a.label('adc_complete');a.load(5,8,72);a.addi(5,5,1);a.store(5,8,72)
    a.label('adc_cleanup');a.store(0,18,8)
    a.addi(5,0,2);a.branch(1,22,5,'adc_return');a.write_reg(0x40011010,0x6000);a.write_reg(0x40010c10,0x400)
    a.label('adc_return');a.restore(adc_regs,adc_frame);a.ret()

    # Two bounded DMA-driven waveform hypotheses. No I2C or guessed enable pins.
    a.label('rgb');rgb_regs=[1,18,19,20,21,22,23,24,25];rgb_frame=a.save(rgb_regs)
    a.lbu(5,9,13);a.sb(5,8,70);a.addi(6,0,1);a.branch(1,5,6,'rgb_path2')
    a.li(18,0x40003800);a.li(19,0x40020058);a.li(24,0x20000);a.li(25,0xf0000)
    a.modify(0x4002101c,0,0x4000);a.modify(0x40021018,0,8);a.modify(0x40010c04,0xf0000000,0xa0000000)
    a.addi(23,0,0x35c);a.jump('rgb_common')
    a.label('rgb_path2');a.li(18,0x40013000);a.li(19,0x40020030);a.li(24,0x200);a.li(25,0xf00)
    a.modify(0x40021018,0,0x1009);a.modify(0x40010004,0,1);a.modify(0x40010c00,0xf00000,0xa00000)
    a.addi(23,0,0x364)
    a.label('rgb_common');a.modify(0x40021014,0,1);a.store(0,19);a.store(0,18,4,1);a.store(0,18,0,1)
    a.lbu(5,9,18);a.shift(5,5,3);a.op(23,23,5)
    a.store(23,18,0,1) # SPI registers are 16-bit in the SDK.
    a.li(20,FRAME);a.li(5,FRAME_BYTES);a.addi(6,20,0)
    a.label('clear_frame');a.sb(0,6);a.addi(6,6,1);a.addi(5,5,-1);a.branch(1,5,0,'clear_frame')
    a.lbu(22,9,16);a.shift(22,22,16);a.lbu(5,9,15);a.shift(5,5,8);a.op(22,22,5,6);a.lbu(5,9,17);a.op(22,22,5,6)
    a.lbu(5,9,12);a.addi(6,0,4);a.branch(1,5,6,'rgb_color_ready');a.addi(22,0,0)
    a.label('rgb_color_ready');a.lbu(23,9,14);a.addi(21,0,0);a.addi(20,20,64)
    a.label('rgb_pixel');a.addi(14,0,0);a.addi(5,0,255);a.branch(0,23,5,'rgb_selected');a.branch(1,21,23,'rgb_encode')
    a.label('rgb_selected');a.addi(14,22,0)
    a.label('rgb_encode');a.addi(15,0,12)
    a.label('rgb_pair');a.shift(5,14,22,True);a.andi(5,5,3);a.la(6,'waveforms');a.op(5,5,6);a.lbu(5,5);a.sb(5,20)
    a.addi(20,20,1);a.shift(14,14,2);a.addi(15,15,-1);a.branch(1,15,0,'rgb_pair')
    a.addi(21,21,1);a.addi(5,0,64);a.branch(6,21,5,'rgb_pixel')
    a.li(5,0x40020004);a.store(25,5);a.li(5,FRAME_BYTES);a.store(5,19,4);a.addi(5,18,12);a.store(5,19,8);a.li(5,FRAME);a.store(5,19,12)
    a.li(5,0x2090);a.store(5,19);a.addi(5,0,2);a.store(5,18,4,1);a.li(5,0x2091);a.store(5,19)
    a.li(7,300000);a.li(6,0x40020000)
    a.label('dma_wait');a.load(5,6);a.op(28,5,24,7);a.branch(1,28,0,'dma_done');a.addi(7,7,-1);a.branch(1,7,0,'dma_wait')
    a.addi(5,0,4);a.sb(5,8,71);a.jump('rgb_cleanup')
    a.label('dma_done');a.store(5,8,156);a.li(7,30000)
    a.label('spi_wait');a.load(5,18,8,5);a.andi(5,5,128);a.branch(0,5,0,'rgb_complete');a.addi(7,7,-1);a.branch(1,7,0,'spi_wait')
    a.addi(5,0,5);a.sb(5,8,71);a.jump('rgb_cleanup')
    a.label('rgb_complete');a.load(5,8,152);a.addi(5,5,1);a.store(5,8,152)
    a.label('rgb_cleanup');a.store(0,19);a.store(0,18,4,1)
    a.restore(rgb_regs,rgb_frame);a.ret()
    a.label('channels')
    for i in range(0,12,4):a.emit(int.from_bytes(bytes(CHANNELS[i:i+4]),'little'))
    a.label('waveforms');a.emit(0xeee88e88)
    return a.finish(),a.labels

def build():
    original=(PREVIOUS/base.NAME).read_bytes()
    if hashlib.sha256(original).hexdigest()!=BASE_HASH:raise ValueError('v0.3 baseline mismatch')
    old_manifest=json.loads((PREVIOUS/'manifest.json').read_text(encoding='utf-8'))
    old_labels={k:int(v,16) for k,v in old_manifest['labels'].items()}
    code,labels=hardware_code(old_labels); image=bytearray(original);edits=[]
    def patch(off,old,new,label):
        if len(old)!=len(new) or original[off:off+len(old)]!=old:raise ValueError(label)
        image[off:off+len(new)]=new;edits.append(dict(label=label,offset=hex(off),old=old.hex(),new=new.hex()))
    if len(code)>0x2000 or any(original[CAVE-ALIAS:CAVE-ALIAS+0x2000]):raise ValueError('Extension cave is not available')
    patch(CAVE-ALIAS,bytes(len(code)),code,'explicit mapping/RGB diagnostic extension')
    patch(old_labels['request']-ALIAS,bytes.fromhex('83c29183'),base.jump_at(old_labels['request'],CAVE),'dispatch opt-in diagnostics before legacy read/status/recovery')
    # Clear all extension state on reset; retain v0.3's boot and clock path.
    patch(old_labels['reset']-ALIAS+8,bytes.fromhex('13030004'),bytes.fromhex('1303000a'),'zero160 status bytes')
    patch(old_labels['reset']-ALIAS+0x38,bytes.fromhex('1303f000'),bytes.fromhex('13033000'),'flags: diagnostic + retained clock')
    patch(0x122F4,b'\x0c\x03'+'H3B03'.encode('utf-16le'),b'\x0c\x03'+'H3M04'.encode('utf-16le'),'v0.4 product')
    patch(0x122D0,b'\x00\x03',b'\x00\x04','v0.4 release')
    patch(old_labels['fill_version']-ALIAS+4,bytes.fromhex('93023000'),bytes.fromhex('93024000'),'v0.4 version reply')
    allowed=set()
    for e in edits:allowed.update(range(int(e['offset'],16),int(e['offset'],16)+len(bytes.fromhex(e['new']))))
    changed={i for i,(x,y) in enumerate(zip(original,image)) if x!=y}
    assert len(original)==len(image)==155056 and changed<=allowed
    result=dict(name=NAME,version='0.4 mapping and RGB tests',sha256=hashlib.sha256(image).hexdigest(),bytes=len(image),
        base_sha256=BASE_HASH,usb_id='19F5:FB4C',product='H3M04',release='0x0400',experimental=True,changed_bytes=len(changed),
        extension_va=hex(CAVE),extension_bytes=len(code),labels={k:hex(v) for k,v in labels.items()},legacy_labels=old_manifest['labels'],
        status_ram=hex(STATUS),snapshot_bytes=160,rgb_frame_ram=hex(FRAME),rgb_frame_bytes=FRAME_BYTES,
        adc_channels=CHANNELS,bank_hypotheses=['PC13 active low','PC14 active low','PB10 active low'],
        rgb_hypotheses=['PB15 / SPI2 / DMA1 CH5','PB5 / remapped SPI1 / DMA1 CH3'],
        commands={'55/DC':'Legacy startup status, read-only','55/DB':'Read-only bounded160-byte H3M1 snapshot','55/DD':'12-byte TEST-tagged action:1 passive ADC,2 banked ADC,3 dim LED frame,4 black LED frame'},
        limits=['Per-channel LED brightness <=16','64 LED slots, one index or255 for all','Only two fixed SPI paths; no arbitrary pins/addresses','ADC/SPI/DMA waits bounded','No scanning or RGB on boot','No keyboard/mouse reports','No persistent mapping/calibration/settings writes; legacy exact recovery request retains its unverified donor flash-writing path'],
        cave_note='New extension lies in checked zero padding at alias1B000..1D000, below alias20000. Existing boot-flag locations1A100/20100 and data/settings tables are untouched.',
        hardware_tested=False,edits=edits)
    (HERE/NAME).write_bytes(image);(HERE/'manifest.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({k:result[k] for k in ['name','sha256','bytes','extension_bytes','changed_bytes','hardware_tested']},indent=2))
    return original,bytes(image),result

if __name__=='__main__':build()
