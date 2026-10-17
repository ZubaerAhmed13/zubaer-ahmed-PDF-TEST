"""Independent MuPDF assertions. No application code or pdf-lib coordinate helpers."""
import json
import sys
import fitz
from pathlib import Path
root = Path('artifacts/r2')
if len(sys.argv) > 1 and sys.argv[1] == 'forms':
    filled, flat = fitz.open(root/'filled-form.pdf'), fitz.open(root/'flat-form.pdf')
    fitz.TOOLS.mupdf_warnings(reset=True)
    fields = {w.field_name:w.field_value for w in filled[0].widgets()}
    assert fields['Name'] == 'Ada' and fields['Locked'] == 'Original'
    # Same rendered appearance, even though widgets have become page content.
    a,b = filled[0].get_pixmap(alpha=False),flat[0].get_pixmap(alpha=False)
    assert a.samples == b.samples
    assert list(flat[0].widgets()) == []
    assert flat.xref_get_key(flat.pdf_catalog(), 'AcroForm')[0] == 'null'
    for xref,kind,_ in flat[0].annot_xrefs():
        assert kind != fitz.PDF_ANNOT_WIDGET
        assert flat.xref_object(xref).strip()
    assert not fitz.TOOLS.mupdf_warnings(reset=True)
    print(json.dumps({'form_values_reopen':True,'flatten_pixel_match':True,'flatten_no_widget_refs_or_warnings':True}))
else:
    doc = fitz.open(root/'geometry-comments-unicode.pdf')
    rotations = []
    for index,page in enumerate(doc):
        pix=page.get_pixmap(alpha=False)
        # These are visual coordinates in the rotated page, independent of PDF user space.
        assert pix.pixel(60,80)[:3] == (255,0,0), (index,pix.pixel(60,80))
        assert pix.pixel(215,70)[:3] == (0,0,255), (index,pix.pixel(215,70))
        assert pix.pixel(20,80)[:3] == (255,255,255)
        assert 'Grüße Ελληνικά Привет' in page.get_text()
        notes=list(page.annots())
        assert len(notes)==1 and notes[0].type[1]=='Text'
        assert notes[0].info['content']=='Editable native comment ✓'
        notes[0].set_info(content='Edited and saved in MuPDF')
        notes[0].update()
        rotations.append(page.rotation)
    doc.save(root/'mupdf-edited-comments.pdf')
    doc.close()
    reopened=fitz.open(root/'mupdf-edited-comments.pdf')
    for page in reopened:
        assert list(page.annots())[0].info['content']=='Edited and saved in MuPDF'
    crop=fitz.open(root/'cropped.pdf')
    assert all(abs(p.rect.width-150)<.01 and abs(p.rect.height-210)<.01 for p in crop)
    print(json.dumps({'engine':'PyMuPDF '+fitz.VersionBind,'rotations':rotations,'shape_pixels':True,'unicode_extraction':True,'crop_visible_dimensions':True,'comment_edit_reopen':True}))
