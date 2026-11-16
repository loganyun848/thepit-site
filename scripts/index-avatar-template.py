"""Index Blender SDNA fields used by the browser's narrow, data-only exporter."""
import json
import pathlib
import re
import struct

root = pathlib.Path(__file__).resolve().parents[1]
source = root / 'assets/avatar/avatar-template.blend'
data = source.read_bytes()
assert data[:12] == b'BLENDER-v293'
blocks = []
offset = 12
while offset < len(data):
    code, size, address, sdna, count = struct.unpack_from('<4sIQII', data, offset)
    blocks.append(dict(code=code.rstrip(b'\0').decode(), offset=offset, size=size, address=str(address), sdna=sdna, count=count))
    offset += 24+size
dna = next(b for b in blocks if b['code']=='DNA1')
p = dna['offset']+24
assert data[p:p+8]==b'SDNANAME'
p+=8
def strings():
    global p
    n, = struct.unpack_from('<I',data,p); p+=4
    result=[]
    for _ in range(n):
        end=data.index(b'\0',p); result.append(data[p:end].decode()); p=end+1
    p=(p+3)//4*4
    return result
names=strings()
assert data[p:p+4]==b'TYPE'; p+=4
types=strings()
assert data[p:p+4]==b'TLEN'; p+=4
lengths=struct.unpack_from('<'+'H'*len(types),data,p); p+=2*len(types); p=(p+3)//4*4
assert data[p:p+4]==b'STRC'; p+=4
n,=struct.unpack_from('<I',data,p); p+=4
structs=[]
for _ in range(n):
    typ,nf=struct.unpack_from('<HH',data,p); p+=4
    fields={}; off=0
    for _ in range(nf):
        ft,fn=struct.unpack_from('<HH',data,p); p+=4
        name=names[fn]; size=8 if '*' in name else lengths[ft]
        for dim in re.findall(r'\[(\d+)\]',name): size*=int(dim)
        key=re.sub(r'\[.*','',name).lstrip('*')
        fields[key]={'offset':off,'size':size,'type':types[ft]}; off+=size
    assert off==lengths[typ], (types[typ],off,lengths[typ])
    structs.append({'name':types[typ],'size':off,'fields':fields})
for b in blocks:
    b['type']=structs[b['sdna']]['name'] if b['code'] not in ('DNA1','ENDB') else b['code']
# Remove workstation-specific file-browser and packed-image paths. This does not
# alter block lengths, addresses or DNA; packed images remain embedded.
clean=bytearray(data)
for match in re.finditer(rb'[A-Za-z]:\\Users\\[^\0]*',data):
    raw=match.group().replace(b'\\',b'/')
    basename=raw.rsplit(b'/',1)[-1]
    replacement=b'//'+basename if b'.' in basename else b'//'
    clean[match.start():match.end()]=replacement+b'\0'*(len(match.group())-len(replacement))
source.write_bytes(clean)
needed=['Mesh','MVert','MEdge','MLoop','MPoly','MLoopUV','CustomData','CustomDataLayer','Image','ImagePackedFile','PackedFile','ListBase','Object','ID']
result={'blocks':blocks,'structs':{s['name']:s for s in structs if s['name'] in needed}}
(root/'assets/avatar/template-index.json').write_text(json.dumps(result,separators=(',',':')),encoding='utf-8')
print(json.dumps([b for b in blocks if b['type'] in needed],indent=2))
