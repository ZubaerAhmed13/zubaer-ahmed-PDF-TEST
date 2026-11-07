"""Independently verify actual PDF choice values, labels and selected-row pixels."""
import json
from pathlib import Path
import fitz

root = Path('artifacts/form-choices')
for name in ('editable', 'flattened'):
    document = fitz.open(root / (name + '.pdf'))
    page = document[0]
    text = page.get_text()
    assert 'Belgium' in text and 'Leave this value' in text
    assert ('Custom value' if name == 'editable' else 'Germany') in text
    widgets = list(page.widgets() or [])
    if name == 'editable':
        country = next(widget for widget in widgets if widget.field_name == 'Country')
        regions = next(widget for widget in widgets if widget.field_name == 'Regions')
        assert country.field_value == 'BE'
        assert document.xref_get_key(regions.xref, 'Parent/V') == ('array', '[<FEFF00520032><FEFF005200310030>]')
        assert document.xref_get_key(regions.xref, 'Parent/I') == ('array', '[2 10]')
    else:
        assert not widgets
        assert document.xref_get_key(document.pdf_catalog(), 'AcroForm')[0] == 'null'
    pixmap = page.get_pixmap(alpha=False)
    selected = []
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines', []):
            for span in line['spans']:
                if span['text'].startswith('Region '):
                    y = round((span['bbox'][1] + span['bbox'][3]) / 2)
                    pixel = pixmap.pixel(230, y)
                    if pixel == (153, 193, 218):
                        selected.append(span['text'])
                    else:
                        assert pixel == (255, 255, 255), (span['text'], pixel)
    assert selected == ['Region 2', 'Region 10'], selected
    page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(root / (name + '.png'))
    document.close()

for name in ('editable', 'flattened'):
    document = fitz.open(root / ('wrapped-' + name + '.pdf'))
    page = document[0]
    pixmap = page.get_pixmap(alpha=False)
    spans = [span for block in page.get_text('dict')['blocks']
             for line in block.get('lines', []) for span in line['spans']]
    assert [span['text'] for span in spans] == ['A selected', 'long region', 'name', 'A unselected', 'long region', 'name']
    for index, span in enumerate(spans):
        y = round((span['bbox'][1] + span['bbox'][3]) / 2)
        assert pixmap.pixel(115, y) == ((153, 193, 218) if index < 3 else (255, 255, 255)), (index, span['text'])
    document.close()

for rotation in (0, 90, 180, 270):
    with fitz.open(root / f'style-{rotation}-codes.pdf') as codes, fitz.open(root / f'style-{rotation}-reference.pdf') as reference:
        actual, expected = codes[0].get_pixmap(), reference[0].get_pixmap()
        assert actual.samples == expected.samples, ('style/rotation changed', rotation)

print(json.dumps({'engine': 'PyMuPDF ' + fitz.VersionBind, 'pdfs': 12,
                  'export_codes': True, 'numerical_indices': True,
                  'readable_labels': True, 'selected_row_pixels': True,
                  'wrapped_selection_pixels': True, 'styled_rotation_pixel_parity': True,
                  'flattened_widgets_removed': True}))
