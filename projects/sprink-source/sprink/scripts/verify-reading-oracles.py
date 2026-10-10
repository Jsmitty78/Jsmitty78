"""Independent source annotations, not candidate-generator output."""
import json, math, pathlib, sys
path=pathlib.Path(sys.argv[1]);s=json.loads(path.read_text());readings=s['siteWork']['readings']
items=readings[0]['originalItems'];pipes=[i for i in items if i['kind']=='pipe'];heads=[i for i in items if i['kind']=='head'];assert len(pipes)==1 and len(heads)==2
expected=[(1830.4,1784.07),(1830.4,1874.06)]
points=sorted([(p['x']*3024,p['y']*2160) for p in pipes[0]['points']],key=lambda p:p[1]);assert len(points)==2
assert all(math.dist(a,b)<=3 for a,b in zip(points,expected)),(points,expected)
head_points=sorted([(i['points'][0]['x']*3024,i['points'][0]['y']*2160) for i in heads],key=lambda p:p[1]);assert all(math.dist(a,b)<=3 for a,b in zip(head_points,expected))
values={'duct.min.x':1200,'duct.max.x':1800,'duct.min.y':-250,'duct.max.y':250,'duct.min.z':-300,'duct.max.z':300,'workEnvelope.min.x':-150,'workEnvelope.max.x':3200,'workEnvelope.min.y':-1400,'workEnvelope.max.y':1200,'workEnvelope.min.z':-200,'workEnvelope.max.z':200,'requiredPipeClearance':100,'fittingEnvelopeRadius':100,'assemblyEnvelopeRadius':150}
site=readings[1]['originalItems']
for field,value in values.items():
 matches=[i for i in site if i['field']==field];assert len(matches)==1,(field,len(matches));assert matches[0]['value']==value and matches[0]['unit']=='mm',(field,matches[0])
report={'packageId':s['id'],'checks':['one target pipe and both endpoint heads within 3 PDF points of independent FS01 annotations','all 15 AI-proposed fixture dimensions match independently written values before human adoption'],'observedPipeEndpointsPdfPoints':points}
path.with_name(path.stem+'-reading-oracles.json').write_text(json.dumps(report,indent=2))
print('PASS source endpoint annotations and all 15 AI dimensions')
