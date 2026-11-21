"""Build the functional foundation against a pinned, working native USB base.
No connected-device access. Code and storage regions have explicit bounds.
"""
import argparse,hashlib,importlib.util,json,os,struct,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent
BASE=HERE.parent/'he30-v0.3'
BASE_HASH='efaad04ebbed9a32d9d11545f182338e29a5ed6d41fa89c95dd4e8c0ca55103f'
NAME='Epomaker-HE30-EXPERIMENTAL-v0.9-Pro.bin'
DEFAULT_TOOLCHAIN=Path(r'C:\Users\Fat Dogggo\Documents\ChatGPT\AE64 Pro R2\he30-lab\tools\riscv-gcc-14.2.0-3')
def sha(b):return hashlib.sha256(b).hexdigest()
def build(toolchain=DEFAULT_TOOLCHAIN):
 gcc=toolchain/'bin/riscv-none-elf-gcc.exe';objcopy=toolchain/'bin/riscv-none-elf-objcopy.exe';objdump=toolchain/'bin/riscv-none-elf-objdump.exe';nm=toolchain/'bin/riscv-none-elf-nm.exe'
 env=os.environ.copy();env['PATH']=str(toolchain/'bin')+os.pathsep+env.get('PATH','')
 command=[str(gcc),'-march=rv32imc_zicsr_zifencei','-mabi=ilp32','-mrelax','-msmall-data-limit=0','-Oz','-fno-jump-tables','-fno-inline-small-functions','-g','-ffreestanding','-fno-builtin','-fno-stack-protector','-ffunction-sections','-fdata-sections','-fno-tree-loop-distribute-patterns','-Wall','-Wextra','-Wno-misleading-indentation','-Wno-address-of-packed-member','-nostdlib','-nostartfiles','-nodefaultlibs','-Wl,--gc-sections,--no-relax-gp,-Map=foundation.map','-T','link.ld','firmware.c','-o','foundation.elf']
 subprocess.run(command,cwd=HERE,env=env,check=True)
 subprocess.run([str(objcopy),'-O','binary','-j','.text','-j','.ramcode','foundation.elf','foundation-code.bin'],cwd=HERE,env=env,check=True)
 disassembly=subprocess.check_output([str(objdump),'-d','foundation.elf'],cwd=HERE,env=env).decode()
 (HERE/'foundation-disassembly.txt').write_text(disassembly,encoding='utf-8')
 symbols={}
 for line in subprocess.check_output([str(nm),'-n','foundation.elf'],cwd=HERE,env=env).decode().splitlines():
  fields=line.split()
  if len(fields)>=3:symbols[fields[2]]=int(fields[0],16)
 (HERE/'symbols.json').write_text(json.dumps(symbols,indent=2))
 original=(BASE/'Epomaker-HE30-EXPERIMENTAL-v0.3-USB-startup.bin').read_bytes();assert sha(original)==BASE_HASH
 assert not any(original[0x16000:0x1b000]),'Code/storage was not padding'
 code=(HERE/'foundation-code.bin').read_bytes();assert len(code)<=0x3000
 assert symbols['firmware_main']==0x1b000 and 0<symbols['__ramcode_end']-symbols['__ramcode_start']<=1024
 fields='size cfg staged coverage staging raw filtered pos cal_rest cal_end noise_min noise_max sums active latched rt_state debounce peak trough enabled cal_phase rest_count scan_error dirty inhibit quiet first_frame release_pending have_last was_usb fn rollover saved_valid store_status vendor_pending report last vendor frames saved_seq accepted last_ticks cal_lo cal_hi library light rgb_frame rgb_state rgb_path rgb_error rgb_pending identify rgb_started key_frames bar_frames identify_until reactive_lo reactive_hi scan_hz scan_ticks scan_worst live_keys live_bar gp_pending'.split()
 subprocess.run([str(objcopy),'--dump-section','.layout=layout.bin','foundation.elf'],cwd=HERE,env=env,check=True)
 layout=dict(zip(fields,struct.unpack('<'+'I'*len(fields),(HERE/'layout.bin').read_bytes())))
 assert layout['library']%4==0 and 0x20004000+layout['size']<=0x20006c00
 (HERE/'layout.json').write_text(json.dumps(layout,indent=2))
 spec=importlib.util.spec_from_file_location('v03_build',BASE/'build.py');v03=importlib.util.module_from_spec(spec);spec.loader.exec_module(v03)
 image=bytearray(original);edits=[]
 def patch(offset,old,new,label):
  assert len(old)==len(new) and original[offset:offset+len(old)]==old,label
  image[offset:offset+len(new)]=new;edits.append(dict(label=label,offset=hex(offset),bytes=len(new),old_sha256=sha(old),new_sha256=sha(new)))
 for section,offset,limit in [('.early',0x14800,0x15000),('.extra',0x15200,0x16000)]:
  name=section[1:]+'.bin'
  subprocess.run([str(objcopy),'--dump-section',f'{section}={name}','foundation.elf'],cwd=HERE,env=env,check=True)
  data=(HERE/name).read_bytes()
  assert data and offset+len(data)<=limit and not any(original[offset:limit])
  patch(offset,bytes(len(data)),data,'Linked '+section+' in checked donor padding')
 patch(0x16000,bytes(len(code)),code,'Compiled RV32IM foundation and flash-writer load image')
 patch(0x19000,bytes(0x2000),bytes([255])*0x2000,'Two dedicated4KB journal pages, erased initial image')
 old_main=original[0x287e:0x2882]
 patch(0x287e,old_main,v03.jump_at(0x787e,0x1b000),'Replace diagnostic main with functional main')
 patch(0x122f4,b'\x0c\x03'+'H3B03'.encode('utf-16le'),b'\x0c\x03'+'H3K09'.encode('utf-16le'),'RGB foundation product identity')
 patch(0x122d0,b'\0\3',b'\0\11','Release0x0900')
 patch(0x13b2b,b'\xa0',b'\x80','Do not advertise unsupported remote wake')
 # Interface 2 is a generic HID gamepad. The application shortens the
 # live configuration descriptor to two interfaces unless enabled.
 gamepad=bytes.fromhex('05010905a101050919012910150025017501951081020501093009310932093516018026ff7f75109504810209330934150026ff00750895028102c0')
 patch(0x12220,original[0x12220:0x122c3],gamepad+b'\0'*(163-len(gamepad)),'EP3 gamepad report descriptor')
 for off,v in [(0x13b24+72,0),(0x13b24+73,0),(0x13b24+78,0),(0x13b24+82, len(gamepad))]:
  patch(off,original[off:off+1],bytes([v]),'EP3 HID metadata')
 assert len(image)==len(original)==155056
 allowed=set()
 for e in edits:allowed.update(range(int(e['offset'],16),int(e['offset'],16)+e['bytes']))
 changed={i for i,(a,b) in enumerate(zip(original,image)) if a!=b};assert changed<=allowed
 matrix=json.loads((HERE/'API.json').read_text())
 result=dict(name=NAME,version='0.9 HE30 Pro',sha256=sha(image),bytes=len(image),base_sha256=BASE_HASH,usb_id='19F5:FB4C',product='H3K09',release='0x0900',experimental=True,
  code_va='0x1B000',code_bytes=len(code)+sum((HERE/f'{n}.bin').stat().st_size for n in ('early','extra')),code_limit='0x1E000',state_ram='0x20004000',state_bytes=layout['size'],ram_writer='0x20007000',ram_writer_bytes=symbols['__ramcode_end']-symbols['__ramcode_start'],journal_pages=['0x0801E000','0x0801F000'],journal_page_bytes=4096,record_bytes=4096,
  scan_channels=matrix['channelsPerGroup'],physical_keys=matrix['keys'],default_group_outputs=['PB10','PC13','PC14'],group_enable_evidence='Owner continuity-confirmed PB10 -> Group1, PC13 -> Group2, PC14 -> Group3. Active-low polarity and settling remain donor-derived pending physical tests.',
  rgb=dict(key_pin='PB15',key_count=36,bar_pin='PB5',bar_count=5,evidence='Owner continuity-confirmed pins/key chain order and5 bar LEDs. Serial protocol, color order and physical timing need hardware validation.',led_order=json.loads((HERE/'wiring.json').read_text())['ledOrder']),
  features=['Four complete onboard profiles, with Main, Fn1 and Fn2','Fixed-point per-key calibration, Hall coefficients and asymmetric Rapid Trigger','SOCD, Rappy Snappy, four-phase DKS, Mod Tap, Toggle, Combination, Macro, Multi-Point Trigger and End Key','ADC1 twelve-rank DMA modes and scan timing telemetry','Saved report cadence from 125 to 8000 Hz','Optional HID gamepad with analog axes, triggers and 16 buttons','PA9/PA10 power sequence, PB15 key RGB, PB5 five-LED lightbar, six effects and transmitted-frame telemetry','CRC and commit-last two-page library'],
  limitations=['Hardware scan rate, USB enumeration/cadence and millimeter accuracy require measurement','USB report cadence is a firmware cap; inherited interrupt descriptors are unchanged for EP1 and vendor interfaces','Generic HID controller transport, no XInput-class interface','Eight action rules per profile, macros bounded to four taps','Inherited OEM recovery writer remains unverified','Full-image flash clears the journal; restore user exports separately'],
  board_evidence='User-reported working updated v0.6 RGB; image SHA256 40d1672ba9029c4afa2d7aa4b1b700ec75504e1fa7c18751cbbc636465780fab with PA9 and PA10 driven high.',
  reference_revision='Everglide AE64 Pro Webdriver c3c600e4b733375177bb4bcd5e5799755c30be55',
  compiler=subprocess.check_output([str(gcc),'--version'],env=env).decode().splitlines()[0],compile_command=command,source_sha256={name:sha((HERE/name).read_bytes()) for name in ['firmware.c','lighting.c','profiles.c','actions.c','scan.c','link.ld','build.py','API.json','wiring.json']},edits=edits,hardware_tested=False)
 (HERE/NAME).write_bytes(image);(HERE/'manifest.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
 print(json.dumps({k:result[k] for k in ['name','sha256','bytes','code_bytes','hardware_tested']},indent=2));return result
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--toolchain',type=Path,default=DEFAULT_TOOLCHAIN);args=p.parse_args();build(args.toolchain)
