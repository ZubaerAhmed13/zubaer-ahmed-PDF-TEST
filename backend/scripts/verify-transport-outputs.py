"""Independently parse/render actual hosted outputs; accepts only synthetic data."""
import base64
import json
from pathlib import Path
import re
import sys
import pypdfium2 as pdfium

report_path = Path(sys.argv[1]).resolve()
report = json.loads(report_path.read_text())
fixtures = json.loads((Path(__file__).resolve().parents[1]/'fixtures'/'transport.json').read_text())
output_dir = report_path.parent/'verified'
output_dir.mkdir(exist_ok=True)
measurements = []

def normalize(value): return re.sub(r'\s+', ' ', value).strip()
def distance(left, right):
    row = list(range(len(right)+1))
    for index, first in enumerate(left):
        updated = [index+1]
        for other, second in enumerate(right):
            updated.append(min(row[other+1]+1, updated[other]+1, row[other]+(first != second)))
        row = updated
    return row[-1]

for output in report['outputs']:
    fixture = next(item for item in fixtures if output['name']==item['name']+'.pdf')
    data = base64.b64decode(output['base64'], validate=True)
    (output_dir/output['name']).write_bytes(data)
    with pdfium.PdfDocument(data) as pdf:
        assert len(pdf)==fixture['expectedPages'], output['name']
        texts, pictures = [], []
        for index in range(len(pdf)):
            page = pdf[index]
            text = page.get_textpage()
            texts.append(text.get_text_range())
            text.close()
            bitmap = page.render(scale=0.5)
            picture = bitmap.to_pil().copy()
            bitmap.close()
            picture.save(output_dir/(fixture['name']+f'-page-{index+1}.png'))
            pictures.append(picture)
            page.close()
        actual = normalize('\n'.join(texts))
        measurement = dict(name=fixture['name'], pages=len(pdf), bytes=len(data), independentlyRendered=True)
        if fixture['operation']=='ocr':
            wanted = normalize(' '.join(fixture['expectedPhrases']))
            cer = distance(wanted, actual)/len(wanted)
            wer = distance(wanted.split(), actual.split())/len(wanted.split())
            assert cer<=0.03 and wer<=0.10, (fixture['name'], actual, cer, wer)
            with pdfium.PdfDocument(base64.b64decode(fixture['base64'])) as source:
                for index in range(len(source)):
                    page = source[index]
                    bitmap = page.render(scale=0.5)
                    assert pictures[index].tobytes()==bitmap.to_pil().tobytes(), 'OCR changed visible scan pixels'
                    bitmap.close()
                    page.close()
            measurement.update(cer=cer, wer=wer, originalScanPixelsIdentical=True)
        else:
            for phrase in fixture['expectedPhrases']:
                assert phrase in actual, (fixture['name'], phrase, actual)
            measurement['expectedTextPresent'] = True
        measurements.append(measurement)

assert len(measurements)==7, 'The seven real hosted output cases were not present'
(output_dir/'independent-verification.json').write_text(json.dumps(measurements, indent=2)+'\n')
print(json.dumps(measurements, indent=2))
