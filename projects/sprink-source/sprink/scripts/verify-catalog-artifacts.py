"""Independent manufacturer nominal-stock oracle for actual browser downloads."""
import csv, hashlib, json, math, pathlib, subprocess, sys
root=pathlib.Path(sys.argv[1]);manifest=json.loads(next(root.glob('*-manifest.json')).read_text())
paths={name:next(root.glob('*'+suffix)) for name,suffix in [('work-package.pdf','-pdf.pdf'),('bom.csv','-bom_csv.csv'),('cut-list.csv','-cut_csv.csv')]}
for entry in manifest['files']:
 data=paths[entry['name']].read_bytes();assert len(data)==entry['bytes'];assert hashlib.sha256(data).hexdigest()==entry['sha256']
rows=list(csv.DictReader(paths['cut-list.csv'].open(encoding='utf-8-sig')));cuts=[r for r in rows if r['record_type']=='cut'];assert len(cuts)==1
assert math.isclose(float(cuts[0]['cut_length']),15*.3048,abs_tol=1e-9)
for r in rows:
 assert int(r['input_revision'])==manifest['binding']['inputRevision'];assert r['package_id']==manifest['binding']['packageId']
text=subprocess.check_output(['pdftotext',str(paths['work-package.pdf']),'-'],text=True);assert 'spears/CP-010' in text
render=root/'pdf-render';render.mkdir(exist_ok=True);subprocess.run(['pdftoppm','-f','1','-l','3','-scale-to','1200','-png',str(paths['work-package.pdf']),str(render/'page')],check=True)
(root/'artifact-checks.json').write_text(json.dumps({'checks':['one cut = nominal 15 ft = 4.572 m','file SHA-256 and bytes','CSV package/revision','PDF rendered'],'binding':manifest['binding']},indent=2))
print('PASS nominal cut CSV, manifest and PDF')
