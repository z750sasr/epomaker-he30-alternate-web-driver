"""Execute the actual generated RV32I hook bytes in a bounded instruction model.
This verifies decoding/control flow/bounds, not hardware or the OEM loader.
"""
import json
import struct
from pathlib import Path
from build import SOURCE, SOURCE_HASH, ALIAS, CAVE, RETURN, RAW_ADC, REPORT_GP, HEADER, NAME, sha

HERE=Path(__file__).resolve().parent
original=SOURCE.read_bytes(); image=(HERE/NAME).read_bytes(); manifest=json.loads((HERE/'manifest.json').read_text())
assert sha(original)==SOURCE_HASH and sha(image)==manifest['sha256']
assert len(original)==len(image)==155056
assert len([1 for a,b in zip(original,image) if a!=b])==manifest['changed_bytes']
assert struct.unpack_from('<I',image,0x16DDC-ALIAS+0xDB*4)[0]==CAVE
assert original[0x38:0x160]==image[0x38:0x160], 'Interrupt vectors modified'

def sx(n,bits): return n-(1<<bits) if n&(1<<(bits-1)) else n
RAW=struct.pack('<36H',*[1000+i*79 for i in range(36)])
PAYLOAD=HEADER+RAW
BASE=0x20000A30+REPORT_GP

def execute(offset,count):
    memory={BASE+i:0 for i in range(64)}
    memory.update({RAW_ADC+i:b for i,b in enumerate(RAW)})
    memory.update({CAVE+i:b for i,b in enumerate(image[CAVE-ALIAS:CAVE-ALIAS+manifest['code_bytes']])})
    memory[BASE]=0xAA; memory[BASE+1]=0xDB; memory[BASE+4]=count
    memory[BASE+5]=offset&255; memory[BASE+6]=offset>>8
    regs=[(0x12300000+i*13)&0xffffffff for i in range(32)];regs[0]=0;regs[3]=0x20000A30
    preserved=regs[:];writes=[];pc=CAVE
    def read(a):
        if a not in memory: raise AssertionError(f'Unmapped read {a:#x}')
        return memory[a]
    def store(a,v):
        assert a in {BASE+2,BASE+4,BASE+7} or BASE+8<=a<BASE+64,f'Illegal write {a:#x}'
        writes.append(a); memory[a]=v&255
    for step in range(3000):
        if pc==RETURN: break
        assert CAVE<=pc<CAVE+manifest['code_bytes']-8 and pc%4==0
        w=sum(read(pc+i)<<(i*8) for i in range(4));op=w&127;rd=(w>>7)&31;f=(w>>12)&7;a=(w>>15)&31;b=(w>>20)&31
        nextpc=pc+4;value=None
        if op==0x37: value=w&0xfffff000
        elif op==0x13:
            n=sx(w>>20,12)
            if f==0:value=regs[a]+n
            elif f==1:value=regs[a]<<((w>>20)&31)
            else:raise AssertionError('Unexpected ALU immediate')
        elif op==3:
            assert f==4; value=read((regs[a]+sx(w>>20,12))&0xffffffff)
        elif op==0x23:
            assert f==0; n=sx(((w>>25)<<5)|((w>>7)&31),12);store((regs[a]+n)&0xffffffff,regs[b])
        elif op==0x33:
            if f==0:value=regs[a]+regs[b]
            elif f==6:value=regs[a]|regs[b]
            else:raise AssertionError('Unexpected ALU register')
        elif op==0x63:
            n=sx(((w>>31)&1)<<12|((w>>7)&1)<<11|((w>>25)&63)<<5|((w>>8)&15)<<1,13)
            take={0:regs[a]==regs[b],1:regs[a]!=regs[b],6:regs[a]<regs[b],7:regs[a]>=regs[b]}[f]
            if take:nextpc=pc+n
        elif op==0x6f:
            assert rd==0;n=sx(((w>>31)&1)<<20|((w>>12)&255)<<12|((w>>20)&1)<<11|((w>>21)&1023)<<1,21);nextpc=pc+n
        else:raise AssertionError(f'Unsupported opcode {op:#x} at {pc:#x}')
        if value is not None and rd:regs[rd]=value&0xffffffff
        regs[0]=0;pc=nextpc
    else:raise AssertionError('Hook did not return')
    for i in [1,2,3,4,8,9,*range(18,28)]:assert regs[i]==preserved[i],f'ABI register x{i} changed'
    valid=count<=56 and offset+count<=80
    if valid:
        assert memory[BASE+2]==0 and memory[BASE+4]==count
        assert bytes(memory[BASE+8+i] for i in range(count))==PAYLOAD[offset:offset+count]
    else:assert memory[BASE+2]==1 and memory[BASE+4]==0
    return step+1

cases=0;max_steps=0
for offset in range(82):
    for count in range(58):max_steps=max(max_steps,execute(offset,count));cases+=1
for offset in [255,256,65535]:
    for count in [0,1,56,57,255]:max_steps=max(max_steps,execute(offset,count));cases+=1
result={'sha256':sha(image),'changed_bytes':manifest['changed_bytes'],'hook_cases':cases,'max_hook_instructions':max_steps,
        'checks':['Byte-exact source and output identity','Unchanged interrupt vectors','Dispatch points at actual hook','Every byte returned across all valid offsets/lengths','Invalid ranges fail without raw reads','Writes limited to response fields','Callee-saved registers and stack preserved'],
        'hardware_tested':False}
(HERE/'verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result,indent=2))
