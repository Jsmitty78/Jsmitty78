"""Verify actual browser downloads, independently of application arithmetic."""
import csv, hashlib, json, math, pathlib, subprocess, sys
root, prefix = pathlib.Path(sys.argv[1]), sys.argv[2]
manifest_path = next(root.glob(prefix + '*-manifest.json'))
m = json.loads(manifest_path.read_text())
paths = {name: next(root.glob(prefix + '*' + suffix)) for name, suffix in
         [('work-package.pdf', '-pdf.pdf'), ('bom.csv', '-bom_csv.csv'), ('cut-list.csv', '-cut_csv.csv')]}
for entry in m['files']:
    data = paths[entry['name']].read_bytes()
    assert len(data) == entry['bytes']
    assert hashlib.sha256(data).hexdigest() == entry['sha256']
assert len(m['snapshotHash']) == 64
rows = list(csv.DictReader(paths['cut-list.csv'].open(encoding='utf-8-sig')))
cuts = [r for r in rows if r['record_type'] == 'cut']
assert len(cuts) == 5
assert all(r['cut_length'] == '' and r['status'] == 'unresolved' for r in cuts)
assert math.isclose(sum(float(r['centerline_length']) for r in cuts), 3.047661333333333 + 1.55, abs_tol=1e-8)
for r in rows:
    assert int(r['input_revision']) == m['binding']['inputRevision']
    assert r['package_id'] == m['binding']['packageId']
    assert r['selected_plan_id'] == m['binding']['selectionId']
bom = list(csv.DictReader(paths['bom.csv'].open(encoding='utf-8-sig')))
assert any(r['description'] == 'anvil/351-black-nps2' and r['quantity'] == '4' for r in bom)
assert sum(r['record_type'] == 'retained_context' for r in bom) == 2
text = subprocess.check_output(['pdftotext', str(paths['work-package.pdf']), '-'], text=True)
assert 'SYNTHETIC' in text and 'human review required' in text
assert 'Site change and designer response' in text
assert 'Alternative comparison' in text and 'Route A' in text and 'Route B' in text
render = root / (prefix + 'pdf-render'); render.mkdir(exist_ok=True)
subprocess.run(['pdftoppm', '-f', '1', '-l', '3', '-scale-to', '1400', '-png', str(paths['work-package.pdf']), str(render / 'page')], check=True)
report = {'binding': m['binding'], 'snapshotHash': m['snapshotHash'], 'checks': ['file hashes and sizes', 'revision and plan binding', 'independent centerline sum', 'four steel elbows', 'two retained heads', 'unknown cuts stay blank', 'PDF text and first three pages rendered']}
(root / (prefix + 'artifact-checks.json')).write_text(json.dumps(report, indent=2))
print('PASS artifact hashes, CSV oracles, PDF rendering')
