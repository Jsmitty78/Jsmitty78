"""Reproducible FS-01 mezzanine vector extraction. Requires PyMuPDF 1.28.2.
Usage: python extract-reference.py /path/FM32361.pdf
Coordinates come from PDF paths, not rendered pixels. No remote download occurs here.
"""
import copy,hashlib,json,math,sys,xml.etree.ElementTree as ET
from pathlib import Path
import pymupdf as fitz
pdf=Path(sys.argv[1]);doc=fitz.open(pdf);page=doc[0]
crop=fitz.Rect(1460,1500,2020,2060);factor=96*25.4/72
all_drawings=page.get_drawings()
source_words=page.get_text('words',clip=crop)
page.set_cropbox(crop)
root=ET.fromstring(page.get_svg_image(text_as_path=True))
ns={'s':'http://www.w3.org/2000/svg'};ET.register_namespace('',ns['s'])
all_paths=root.findall('.//s:path',ns)[1:]
assert len(all_paths)==len(all_drawings), 'Path/drawing order must be reverified for other PDFs or library versions'
selected=[i for i,d in enumerate(all_drawings) if not (d['rect'].x1<crop.x0 or d['rect'].x0>crop.x1 or d['rect'].y1<crop.y0 or d['rect'].y0>crop.y1)]
pipes=[i for i in selected if all_drawings[i]['width'] and abs(all_drawings[i]['width']-1.68)<.001 and all_drawings[i]['color']==(0,0,0) and len(all_drawings[i]['items'])==1 and all_drawings[i]['items'][0][0]=='l']
heads=[i for i in selected if all_drawings[i]['width'] and abs(all_drawings[i]['width']-1.44)<.001 and all_drawings[i]['color']==(0,0,0) and len(all_drawings[i]['items'])==4 and all(item[0]=='c' for item in all_drawings[i]['items']) and 8.8<all_drawings[i]['rect'].width<8.9 and 8.8<all_drawings[i]['rect'].height<8.9]
assert len(pipes)==32 and len(heads)==19,(len(pipes),len(heads))
centers={i:((all_drawings[i]['rect'].x0+all_drawings[i]['rect'].x1)/2,(all_drawings[i]['rect'].y0+all_drawings[i]['rect'].y1)/2) for i in heads}
def rounded(p):return tuple(round(v,2) for v in p)
def normalize(p):
 for center in centers.values():
  if math.dist(p,center)<4.46:return rounded(center)
 return rounded(p)
segments=[]
for i in pipes:
 _,a,b=all_drawings[i]['items'][0]
 segments.append((i,normalize(a),normalize(b)))
points=sorted(set(p for _,a,b in segments for p in [a,b])|set(rounded(c) for c in centers.values()))
node_ids={p:f'N{i+1}' for i,p in enumerate(points)}
source=dict(id='itd-fs01-mezzanine',document='FM32361 / FS-01',title='FIRE SPRINKLER PLAN - MEZZANINE',url='https://apps.itd.idaho.gov/Apps/NonHwyConstructionProjects/PDFS/FM32361_ITB_Drawings_Fire_Sprinkler_Plan.pdf',page=1,sha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),cropPdfPoints=list(crop),mmPerPdfPoint=factor,scale='1/8 inch = 1 foot (1:96)',method='PDF vector path extraction; symbol-edge endpoints extended to symbol centers; T-junctions split',scope='FS-01 mezzanine plan only; main floor and details excluded',coordinateTolerancePdfPoints=.02,physicalAccuracy='unverified')
model=dict(version=1,width=round(crop.width*factor,4),height=round(crop.height*factor,4),source=source,nodes=[dict(id=node_ids[p],x=round((p[0]-crop.x0)*factor,4),y=round((p[1]-crop.y0)*factor,4)) for p in points],pipes=[],heads=[],walls=[],doors=[],rooms=[])
provenance={}
oneinch={16488,16492,16493,16494,16495,16510,16511}
for index,a,b in segments:
 dx,dy=b[0]-a[0],b[1]-a[1];l=math.hypot(dx,dy)
 on=[]
 for p in points:
  fraction=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(l*l)
  error=abs((p[0]-a[0])*dy-(p[1]-a[1])*dx)/l
  if -.00001<=fraction<=1.00001 and error<.02:on.append((fraction,p))
 on.sort()
 for (_,p),(_,q) in zip(on,on[1:]):
  if math.dist(p,q)<.02:continue
  id=f'P{len(model["pipes"])+1}';inch=3 if index==16352 else 1 if index in oneinch else 2
  model['pipes'].append(dict(id=id,**{'from':node_ids[p],'to':node_ids[q]},diameter={1:25,2:50,3:80}[inch],nominalInches=inch))
  provenance[id]=dict(pdfPathIndex=index,originalPdfEndpoints=[list(a),list(b)],sourceNominal=f'{inch} inch')
for j,index in enumerate(heads):
 id=f'H{j+1}';p=rounded(centers[index]);model['heads'].append(dict(id=id,nodeId=node_ids[p],orientation='upright',model='UNSPECIFIED'))
 provenance[id]=dict(pdfPathIndex=index,pdfCenter=list(centers[index]),symbol='open circle; upright per FS-01 legend; product model unspecified')
# Original paths are preserved exactly. Only pipe/head paths are removed from the
# architectural base; every such path is represented by the editable model.
editable=set(pipes+heads)
# Nominal sizes and elevation text are PDF glyph outlines. Isolate them so a
# changed drawing cannot retain obsolete source annotations as current values.
annotation_boxes=[fitz.Rect(w[:4]) for w in source_words if '"' in w[4] or w[4]=='BD']
annotation_ids={i for i in selected if all_drawings[i]['type']=='f' and all_drawings[i]['fill']==(0,0,0) and any(box.contains(all_drawings[i]['rect']) for box in annotation_boxes)}
base=''.join(ET.tostring(all_paths[i],encoding='unicode') for i in selected if i not in editable and i not in annotation_ids)
annotations=''.join(ET.tostring(all_paths[i],encoding='unicode') for i in selected if i in annotation_ids)
original=''.join(ET.tostring(all_paths[i],encoding='unicode') for i in selected if i in editable)
# Avoid repeating namespace attributes on every path.
base=base.replace(' xmlns="http://www.w3.org/2000/svg"','');original=original.replace(' xmlns="http://www.w3.org/2000/svg"','')
annotations=annotations.replace(' xmlns="http://www.w3.org/2000/svg"','')
result=dict(annotations=annotations,source=source,model=model,provenance=provenance,background=base,original=original,counts=dict(backgroundPaths=len(selected)-len(editable),sourcePipePaths=len(pipes),editableSegments=len(model['pipes']),heads=len(heads)))
out=Path(__file__).resolve().parents[1]/'packages/core/src/reference/itd-mezzanine.json';out.write_text(json.dumps(result,separators=(',',':')))
# Crop rendered straight from the PDF is the independent visual reference.
page.get_pixmap(matrix=fitz.Matrix(2,2)).save(str(Path(__file__).resolve().parents[1]/'docs/drawing/reference/pdf-mezzanine.png'))
print(json.dumps(result['counts']), 'bytes',out.stat().st_size)
