"""Build the functional foundation against a pinned, working native USB base.
No connected-device access. Code and storage regions have explicit bounds.
"""
import argparse,hashlib,json,os,struct,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent
BASE='firmware/custom/he30-v0.3/Epomaker-HE30-EXPERIMENTAL-v0.3-USB-startup.bin'
BASE_REVISION='893e4ea'
DIAGNOSTIC_WINDOW_HASH='d2bd902a67a12e59f31fda2585f5f520a469b049411c06bbe4af0f2ac8fe8208'
BASE_HASH='efaad04ebbed9a32d9d11545f182338e29a5ed6d41fa89c95dd4e8c0ca55103f'
def sha(b):return hashlib.sha256(b).hexdigest()
def jump_at(pc,target):
 delta=target-pc
 assert delta%2==0 and -(1<<20)<=delta<(1<<20)
 bits=((delta>>20)&1)<<31|((delta>>1)&1023)<<21|((delta>>11)&1)<<20|((delta>>12)&255)<<12
 return struct.pack('<I',bits|0x6f)

def read_base(path=None):
 repo=HERE.parents[2]
 if path is not None:
  return path.read_bytes()
 if (repo/BASE).exists():
  return (repo/BASE).read_bytes()
 return subprocess.check_output(['git','show',f'{BASE_REVISION}:{BASE}'],cwd=repo)

def build(toolchain, output=HERE, diagnostics=False, base=None, lock_fix=False, user_mode_save=False, flash_resident_save=False, profile_keys=False, nkro=False, fn_rgb=False, adc_rgb_fix=False):
 output.mkdir(parents=True,exist_ok=True)
 fn_rgb=fn_rgb or adc_rgb_fix
 nkro=nkro or fn_rgb
 profile_keys=profile_keys or nkro
 flash_resident_save=flash_resident_save or profile_keys
 user_mode_save=user_mode_save or flash_resident_save
 lock_fix=lock_fix or user_mode_save
 diagnostics=diagnostics or lock_fix
 sram_writer=diagnostics and not flash_resident_save
 release='23' if adc_rgb_fix else '22' if fn_rgb else '21' if nkro else '20' if profile_keys else '19' if flash_resident_save else '18' if user_mode_save else '17' if lock_fix else '16' if diagnostics else '15'
 product='H3K'+release
 version_byte=int(release,16)
 variant='Scanner-RGB-Fix' if adc_rgb_fix else 'Fn-RGB-DMA' if fn_rgb else 'NKRO' if nkro else 'Profile-Keys' if profile_keys else 'Onboard-Save' if user_mode_save else 'Live-Save-Test' if lock_fix else 'Save-Diagnostics' if diagnostics else 'Pro'
 name=f'Epomaker-HE30-EXPERIMENTAL-v0.{release}-{variant}.bin'
 gcc=toolchain/'bin/riscv-none-elf-gcc.exe';objcopy=toolchain/'bin/riscv-none-elf-objcopy.exe';objdump=toolchain/'bin/riscv-none-elf-objdump.exe';nm=toolchain/'bin/riscv-none-elf-nm.exe'
 env=os.environ.copy();env['PATH']=str(toolchain/'bin')+os.pathsep+env.get('PATH','')
 command=[str(gcc),'-march=rv32imc_zicsr_zifencei','-mabi=ilp32','-mrelax','-msmall-data-limit=0','-Oz','-fno-jump-tables','-fno-inline-small-functions','-g','-ffreestanding','-fno-builtin','-fno-stack-protector','-ffunction-sections','-fdata-sections','-fno-tree-loop-distribute-patterns','-Wall','-Wextra','-Wno-misleading-indentation','-Wno-address-of-packed-member','-nostdlib','-nostartfiles','-nodefaultlibs','-Wl,--gc-sections,--no-relax-gp,-Map=foundation.map']
 if diagnostics:command+=['-flto','-fno-partial-inlining','-fno-ipa-sra','-DHE30_SAVE_DIAGNOSTICS',f'-DFIRMWARE_VERSION=0x{release}']
 if lock_fix:command+=['-DHE30_FLASH_LOCK_FIX']
 if user_mode_save:command+=['-DHE30_USER_MODE_SAVE']
 if flash_resident_save:command+=['-DHE30_FLASH_RESIDENT_SAVE']
 if profile_keys:command+=['-fno-optimize-sibling-calls','-DHE30_PROFILE_KEYS']
 if nkro:command+=['-DHE30_NKRO','-fno-tree-dominator-opts','-fno-tree-tail-merge']
 if fn_rgb:command+=['-DHE30_FN_RGB','-DHE30_FN_PAGE_A=0xf900','-DHE30_FN_PAGE_B=0xfc00']
 if adc_rgb_fix:command+=['-DHE30_ADC_RGB_FIX']
 command+=['-T',str(HERE/'link.ld'),str(HERE/'firmware.c'),str(HERE/'usb-hook.S'),'-o','foundation.elf']
 subprocess.run(command,cwd=output,env=env,check=True)
 code_sections=['-j','.text','-j','.flashwriter']+(['-j','.ramflash'] if sram_writer else [])
 subprocess.run([str(objcopy),'-O','binary',*code_sections,'foundation.elf','foundation-code.bin'],cwd=output,env=env,check=True)
 disassembly=subprocess.check_output([str(objdump),'-d','foundation.elf'],cwd=output,env=env).decode()
 (output/'foundation-disassembly.txt').write_text(disassembly,encoding='utf-8')
 symbols={}
 for line in subprocess.check_output([str(nm),'-n','foundation.elf'],cwd=output,env=env).decode().splitlines():
  fields=line.split()
  if len(fields)>=3:symbols[fields[2]]=int(fields[0],16)
 (output/'symbols.json').write_text(json.dumps(symbols,indent=2))
 original=read_base(base);assert sha(original)==BASE_HASH
 assert not any(original[0x16000:0x1b000]),'Code/storage was not padding'
 code=(output/'foundation-code.bin').read_bytes();assert len(code)<=0x3000
 assert symbols['firmware_main']==0x1b000
 if sram_writer:
  assert symbols['__ramflash_begin']==0x20007000 and symbols['__ramflash_end']<=0x20007400
  for symbol in ('flash_writer','flash_wait','stored_byte'):
   assert symbols['__ramflash_begin']<=symbols[symbol]<symbols['__ramflash_end']
 else:assert all(0x1b000 <= symbols[symbol] < 0x1e000 for symbol in ('stored_byte','flash_writer','flash_wait'))
 fields='size cfg staged coverage staging raw filtered pos cal_rest cal_end noise_min noise_max sums active latched rt_state debounce peak trough enabled cal_phase rest_count scan_error dirty inhibit quiet first_frame release_pending have_last was_usb fn rollover saved_valid store_status vendor_pending report last vendor frames saved_seq accepted last_ticks cal_lo cal_hi library light rgb_frame rgb_state rgb_path rgb_error rgb_pending identify rgb_started key_frames bar_frames identify_until reactive_lo reactive_hi scan_hz scan_ticks scan_worst live_keys live_bar gp_pending gp_last'.split()
 subprocess.run([str(objcopy),'--dump-section','.layout=layout.bin','foundation.elf'],cwd=output,env=env,check=True)
 layout=dict(zip(fields,struct.unpack('<'+'I'*len(fields),(output/'layout.bin').read_bytes())))
 assert layout['library']%4==0 and 0x20004000+layout['size']<=0x20006c00
 (output/'layout.json').write_text(json.dumps(layout,indent=2))
 image=bytearray(original);edits=[]
 def patch(offset,old,new,label):
  assert len(old)==len(new) and original[offset:offset+len(old)]==old,label
  image[offset:offset+len(new)]=new;edits.append(dict(label=label,offset=hex(offset),bytes=len(new),old_sha256=sha(old),new_sha256=sha(new)))
 sections=[('.spare',0x13c7c,0x14000),('.early',0x14158,0x15000),('.extra',0x15200,0x16000)]
 for section,offset,limit in sections:
  section_file=section[1:]+'.bin'
  subprocess.run([str(objcopy),'--dump-section',f'{section}={section_file}','foundation.elf'],cwd=output,env=env,check=True)
  data=(output/section_file).read_bytes()
  assert data and offset+len(data)<=limit
  if section=='.early':
   assert sha(original[0x14158:0x15000])==DIAGNOSTIC_WINDOW_HASH
  else:assert not any(original[offset:limit])
  patch(offset,original[offset:offset+len(data)],data,'Linked '+section+' in pinned unused region')
 patch(0x16000,bytes(len(code)),code,'Compiled RV32IM foundation and flash-writer load image')
 if fn_rgb:
  # Only the replaced donor Hall engine calls or uses this range. Keep an
  # explicit return at its entry so the old DMA ISR cannot run reclaimed code.
  patch(0x99f4,bytes.fromhex('5d71'),bytes.fromhex('8280'),'Retire the original Hall engine entry')
  subprocess.run([str(objcopy),'--dump-section','.fncode=fncode.bin','foundation.elf'],cwd=output,env=env,check=True)
  fn_code=(output/'fncode.bin').read_bytes()
  assert 0<len(fn_code)<=0xf00
  patch(0x9a00,original[0x9a00:0x9a00+len(fn_code)],fn_code,'Fn lighting and ADC code in retired Hall engine')
  patch(0xa900,original[0xa900:0xaf00],bytes([255])*0x600,'Two three-row Fn lighting journal sidecars')
 patch(0x19000,bytes(0x2000),bytes([255])*0x2000,'Two dedicated4KB journal pages, erased initial image')
 old_main=original[0x287e:0x2882]
 patch(0x287e,old_main,jump_at(0x787e,0x1b000),'Replace diagnostic main with functional main')
 patch(0x122f4,b'\x0c\x03'+'H3B03'.encode('utf-16le'),b'\x0c\x03'+product.encode('utf-16le'),'RGB foundation product identity')
 patch(0x122d0,b'\0\3',bytes([0,version_byte]),'Release 0x'+release+'00')
 patch(0x13b2b,b'\xa0',b'\x80','Do not advertise unsupported remote wake')
 if nkro:
  # Report protocol reads modifiers and 168 usage bits. The middle 56 bits
  # are the reserved byte and six key slots used by boot protocol.
  descriptor=bytes.fromhex('05 01 09 06 a1 01 05 07 19 e0 29 e7 15 00 25 01 75 01 95 08 81 02 '
   '95 38 81 01 19 00 29 a7 95 a8 81 02 05 08 19 01 29 03 95 03 91 02 95 05 91 01 c0')
  assert len(descriptor)==49
  old_descriptor=bytes.fromhex('05 01 09 06 a1 01 05 07 19 e0 29 e7 15 00 25 01 75 01 95 08 81 02 '
   '95 01 75 08 81 01 95 03 75 01 05 08 19 01 29 03 91 02 95 05 75 01 91 01 '
   '95 06 75 08 26 ff 00 05 07 19 00 29 91 81 00 c0')
  patch(0x121c0,old_descriptor,descriptor.ljust(62,b'\0'),'Keyboard report descriptor with boot prefix and NKRO bitmap')
  patch(0xf6c,bytes.fromhex('9307e003'),struct.pack('<I',len(descriptor)<<20|0x793),'Native report descriptor response length')
  patch(0x13b3d,b'\x3e',bytes([len(descriptor)]),'Native keyboard HID descriptor report length')
  patch(0x13b43,b'\x08',b'\x1d','Native keyboard EP1 maximum packet size')
 # Native USB control, RX3 initialization and RX3 OUT acknowledgment hooks.
 patch(0x30c,bytes.fromhex('37071100'),bytes.fromhex('37071900'),'Enable RX3 alongside original USB endpoints')
 for offset,old,hook in [(0x408,'0100b240','usb_endpoint_init_hook'),(0xa54,'11476390e712','usb_out_hook'),(0xc2e,'83c7d182','usb_setup_hook')]:
  replacement=jump_at(offset+0x5000,symbols[hook])
  if len(bytes.fromhex(old))==6:replacement+=bytes.fromhex('0100')
  patch(offset,bytes.fromhex(old),replacement,'Native USB hook '+hook)
 assert len(image)==len(original)==155056
 allowed=set()
 for e in edits:allowed.update(range(int(e['offset'],16),int(e['offset'],16)+e['bytes']))
 changed={i for i,(a,b) in enumerate(zip(original,image)) if a!=b};assert changed<=allowed
 matrix=json.loads((HERE/'API.json').read_text())
 result=dict(name=name,version='0.'+release+' '+variant.replace('-',' '),sha256=sha(image),bytes=len(image),base_sha256=BASE_HASH,usb_id='19F5:FB4C',product=product,release='0x'+release+'00',experimental=True,
  code_va='0x1B000',code_bytes=len(code)+sum((output/(section[1:]+'.bin')).stat().st_size for section,_,_ in sections),code_limit='0x1E000',state_ram='0x20004000',state_bytes=layout['size'],journal_writer=hex(symbols['flash_writer']),journal_pages=['0x0801E000','0x0801F000'],journal_page_bytes=4096,record_bytes=4096,
  scan_channels=matrix['channelsPerGroup'],physical_keys=matrix['keys'],default_group_outputs=['PB10','PC13','PC14'],group_enable_evidence='Owner continuity-confirmed PB10 -> Group1, PC13 -> Group2, PC14 -> Group3. Active-low polarity and settling remain donor-derived pending physical tests.',
  rgb=dict(key_pin='PB15',key_count=36,bar_pin='PB5',bar_count=5,evidence='Owner continuity-confirmed pins/key chain order and5 bar LEDs. Serial protocol, color order and physical timing need hardware validation.',led_order=json.loads((HERE/'wiring.json').read_text())['ledOrder']),
  features=['Automatic typing after a stable released startup baseline','Four profiles with the physical 36-key Main map and transparent Fn1/Fn2 defaults','Fixed-point per-key calibration, Hall coefficients and asymmetric Rapid Trigger','SOCD, Rappy Snappy, four-phase DKS, Mod Tap, Toggle, Combination, Macro, Multi-Point Trigger and End Key','ADC1 twelve-rank DMA modes and scan timing telemetry','Immediate report pacing from 125 to 8000 Hz and verified journal saves at a reduced flash clock','Optional Xbox-compatible XInput controller, both sticks, triggers, ten buttons and D-pad', 'AE64 analog ranges, four-point curves, digital hysteresis, opposition and radial dead zones', 'Controller-only, mixed and off modes with release guards and automatic USB visibility switching','PA9/PA10 power sequence, PB15 key RGB, PB5 five-LED lightbar, six effects and bounded transfer retry','CRC and commit-last two-page library'],
  limitations=['Hardware scan rate, USB enumeration/cadence and millimeter accuracy require measurement','USB report cadence is a firmware cap; inherited interrupt descriptors are unchanged for EP1 and vendor interfaces','Windows XInput binding and physical controller reports require hardware validation','Eight action rules per profile, macros bounded to four taps','Inherited OEM recovery writer remains unverified','Full-image flash clears the journal; restore user exports separately'],
  board_evidence='User-reported working updated v0.6 RGB; image SHA256 40d1672ba9029c4afa2d7aa4b1b700ec75504e1fa7c18751cbbc636465780fab with PA9 and PA10 driven high.',
  reference_revision='Everglide AE64 Pro Webdriver c3c600e4b733375177bb4bcd5e5799755c30be55',
  compiler=subprocess.check_output([str(gcc),'--version'],env=env).decode().splitlines()[0],compile_command=[gcc.name,*command[1:]],source_sha256={name:sha((HERE/name).read_bytes()) for name in ['firmware.c','lighting.c','profiles.c','actions.c','scan.c','gamepad.c','gamepad.h','controller.c','persistence.c','usb.c','usb-hook.S','startup-reference.h','link.ld','build.py','API.json','wiring.json']},edits=edits,hardware_tested=False)
 if diagnostics:
  result.update(save_diagnostics=True,save_trace_ram='0x20007400')
  if sram_writer:
   result.update(flash_worker_ram=hex(symbols['__ramflash_begin']),flash_worker_bytes=symbols['__ramflash_end']-symbols['__ramflash_begin'])
  result['source_sha256']['save-writer.c']=sha((HERE/'save-writer.c').read_bytes())
  result['limitations'].append('Diagnostic build. Physical onboard Save remains unverified.')
 if lock_fix:result['flash_lock_fix']=True
 if user_mode_save:result['user_mode_save']=True
 if flash_resident_save:result['flash_resident_save']=True
 if profile_keys:result['profile_keys']=True
 if nkro:
  result['nkro']=True
  result['features'].append('29-byte NKRO report with an eight-byte boot report on the host’s SET_PROTOCOL request')
 if fn_rgb:
  result.update(fn_rgb=True,fn_light_pages=['0x0800F900','0x0800FC00'])
  result['code_bytes']+=len(fn_code)
 if adc_rgb_fix:
  result['adc_rgb_fix']=True
  result['features']+=['DMA1 clock and ADC source verification before the first scan', 'Independent lightbar timing and fixed half-rate keyboard LED signaling']
 (output/name).write_bytes(image);(output/'manifest.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
 print(json.dumps({k:result[k] for k in ['name','sha256','bytes','code_bytes','hardware_tested']},indent=2));return result
if __name__=='__main__':
 p=argparse.ArgumentParser()
 p.add_argument('--toolchain',type=Path,required=True)
 p.add_argument('--output',type=Path)
 p.add_argument('--base',type=Path,help='Optional copy of the pinned v0.3 donor image')
 variant=p.add_mutually_exclusive_group()
 variant.add_argument('--save-diagnostics',action='store_true')
 variant.add_argument('--live-save-fix',action='store_true')
 variant.add_argument('--user-mode-save',action='store_true')
 variant.add_argument('--flash-resident-save',action='store_true')
 variant.add_argument('--profile-keys',action='store_true')
 variant.add_argument('--nkro',action='store_true')
 variant.add_argument('--fn-rgb',action='store_true')
 variant.add_argument('--adc-rgb-fix',action='store_true')
 args=p.parse_args()
 output=args.output or (HERE.with_name('he30-v0.23') if args.adc_rgb_fix else HERE.with_name('he30-v0.22') if args.fn_rgb else HERE.with_name('he30-v0.21') if args.nkro else HERE.with_name('he30-v0.20') if args.profile_keys else HERE.with_name('he30-v0.19') if args.flash_resident_save else HERE.with_name('he30-v0.18') if args.user_mode_save else HERE.with_name('he30-v0.17') if args.live_save_fix else HERE.with_name('he30-v0.16') if args.save_diagnostics else HERE)
 build(args.toolchain.resolve(),output.resolve(),args.save_diagnostics,args.base,args.live_save_fix,args.user_mode_save,args.flash_resident_save,args.profile_keys,args.nkro,args.fn_rgb,args.adc_rgb_fix)
