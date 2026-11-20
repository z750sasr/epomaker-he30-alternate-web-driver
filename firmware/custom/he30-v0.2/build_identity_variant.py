"""One controlled loader-identity hypothesis test; no hardware access.

Changes ONLY the USB PID and native identity PID of the pinned v0.2 image.
The loader's actual identity-validation behavior is not yet established.
"""
from pathlib import Path
import hashlib,json
HERE=Path(__file__).resolve().parent
source=HERE/'Epomaker-HE30-EXPERIMENTAL-v0.2-Zuoya115.bin'
original=source.read_bytes()
assert hashlib.sha256(original).hexdigest()=='e918651f5a81bd487bf61566d94a12e4cbc8a93a6e44ac13ddd5d962825f5e70'
image=bytearray(original)
edits=[]
for name,offset in [('USB device identity',0x122CC),('native onboard identity',0x1B000)]:
    assert original[offset:offset+4]==bytes.fromhex('f51950fd')
    image[offset+2:offset+4]=bytes.fromhex('4cfb')
    edits.append({'name':name,'offset':hex(offset),'old':'f51950fd','new':'f5194cfb'})
changed=[i for i,(a,b) in enumerate(zip(original,image)) if a!=b]
assert changed==[0x122CE,0x122CF,0x1B002,0x1B003]
name='Epomaker-HE30-EXPERIMENTAL-v0.2b-FB4C-identity.bin'
(HERE/name).write_bytes(image)
manifest={'name':name,'source':source.name,'source_sha256':hashlib.sha256(original).hexdigest(),'sha256':hashlib.sha256(image).hexdigest(),'bytes':len(image),'changed_bytes_vs_v02':len(changed),'edits':edits,'usb_id':'19F5:FB4C','product':'H3D02','release':'0x0115','hypothesis':'Loader may validate the USB/native identity against the Epomaker board. Not established by loader code or hardware test.','unchanged':'All v0.2 executable instructions, raw-ADC hook, donor hardware initialization and calibration retained.','next_if_failure':'Do not flash more variants without probe-assisted diagnosis.'}
(HERE/'identity-variant-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps(manifest,indent=2))
