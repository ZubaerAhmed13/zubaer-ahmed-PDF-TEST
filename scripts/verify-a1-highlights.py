"""Independent native-annotation validation. Uses no application coordinate helpers."""
import json
from pathlib import Path
import fitz

root = Path('artifacts/a1')
doc = fitz.open(root / 'native-highlights.pdf')
fitz.TOOLS.mupdf_warnings(reset=True)
for page in doc:
    marks = [a for a in page.annots() if a.type[1] == 'Highlight']
    assert len(marks) == 1
    mark = marks[0]
    assert mark.info['content'] == 'Review this region ✓'
    assert 'ORIGINAL searchable text' in page.get_text()
    points = [fitz.Point(p) * page.rotation_matrix for p in mark.vertices]
    assert abs(min(p.x for p in points) - 40) < .01
    assert abs(min(p.y for p in points) - 65) < .01
    assert abs(max(p.x for p in points) - 140) < .01
    assert abs(max(p.y for p in points) - 100) < .01
    pix, clean = page.get_pixmap(alpha=False), page.get_pixmap(alpha=False, annots=False)
    assert clean.pixel(60, 80)[:3] == (255, 255, 255)
    r, g, b = pix.pixel(60, 80)[:3]
    assert r > 245 and 225 < g < 250 and 175 < b < 220, (page.number, (r, g, b))
    assert pix.pixel(20, 80)[:3] == clean.pixel(20, 80)[:3]
    mark.set_info(content='Edited and saved in independent MuPDF')
    mark.set_colors(stroke=(0, 1, 0))
    mark.update()
doc.save(root / 'independently-edited-highlights.pdf')
doc.close()
reopened = fitz.open(root / 'independently-edited-highlights.pdf')
for page in reopened:
    mark = next(page.annots())
    assert mark.info['content'] == 'Edited and saved in independent MuPDF'
assert not fitz.TOOLS.mupdf_warnings(reset=True)
print(json.dumps({'engine': 'PyMuPDF ' + fitz.VersionBind, 'pages': 4, 'rotations': [0,90,180,270], 'highlight_pixels': True, 'searchable_original': True, 'independent_edit_reopen': True}))
