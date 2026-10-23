"""Independent PyMuPDF raster comparison after benchmark-native-content.mjs."""
import json
import math
from pathlib import Path
import fitz

root = Path('artifacts/native-corpus')
results = []
for index in range(26):
    docs = [fitz.open(root / f'{index}-{suffix}.pdf') for suffix in ('before', 'after')]
    try:
        images, boxes = [], []
        for doc in docs:
            page = doc[0]
            pix = page.get_pixmap(alpha=False)
            images.append((pix.width, pix.height, pix.samples))
            matches = []
            for block in page.get_text('dict')['blocks']:
                for line in block.get('lines', []):
                    text = ''.join(span['text'] for span in line['spans'])
                    if any(term in text for term in (' original ', ' updated ', 'Résumé', 'Привет')):
                        matches.append(fitz.Rect(line['bbox']) * page.rotation_matrix)
            if not matches:
                raise AssertionError(f'Case {index}: changed text not found by independent renderer')
            boxes.extend(matches)
        if images[0][:2] != images[1][:2]:
            raise AssertionError(f'Case {index}: page raster dimensions changed')
        if images[0][2] == images[1][2]:
            raise AssertionError(f'Case {index}: visible source text did not change')
        region = boxes[0]
        for box in boxes[1:]:
            region |= box
        region = region + (-3, -3, 3, 3)
        width, height = images[0][:2]
        left, top, right, bottom = (math.floor(region.x0), math.floor(region.y0), math.ceil(region.x1), math.ceil(region.y1))
        before, after = images[0][2], images[1][2]
        for y in range(height):
            start, end = y * width * 3, (y + 1) * width * 3
            ranges = [(start, end)] if y < top or y > bottom else [(start, start + max(0, left) * 3), (min(end, start + (right + 1) * 3), end)]
            if any(before[a:b] != after[a:b] for a, b in ranges):
                raise AssertionError(f'Case {index}: unrelated pixels changed on row {y}')
        results.append({'case': index, 'visible_change': True, 'unrelated_pixels_identical': True})
    finally:
        for doc in docs:
            doc.close()
summary = {'renderer': f'PyMuPDF {fitz.__version__}', 'passed': len(results), 'results': results}
(root / 'raster-verification.json').write_text(json.dumps(summary, indent=2) + '\n')
print(f'{len(results)}/26 visible replacements; unrelated rendered pixels identical.')
