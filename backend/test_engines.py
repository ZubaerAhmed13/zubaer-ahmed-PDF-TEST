"""Synthetic, offline engine acceptance. Run in the pinned processing venv."""
import hashlib
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

import pikepdf
import pypdfium2 as pdfium
from PIL import Image

from engines import EngineError, compress_pdf, inspect_pdf, inspect_office, verify_output


def make_pdf(path, *, transparent=False, pages=1, image=True):
    pdf = pikepdf.Pdf.new()
    font = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica))
    photo = None
    if image:
        # Deterministic rich pixels, with enough resolution to exercise real resampling.
        width, height = 1800, 1200
        raw = bytes((x * 13 + y * 31 + c * 71) % 256 for y in range(height) for x in range(width) for c in range(3))
        photo = pdf.make_stream(raw, Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image, Width=width, Height=height, ColorSpace=pikepdf.Name.DeviceRGB, BitsPerComponent=8)
        if transparent:
            photo.SMask = pdf.make_stream(bytes([180]) * (width * height), Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image, Width=width, Height=height, ColorSpace=pikepdf.Name.DeviceGray, BitsPerComponent=8)
    for _ in range(pages):
        page = pdf.add_blank_page(page_size=(612, 792))
        page.Resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font), XObject=pikepdf.Dictionary(Im1=photo) if photo is not None else pikepdf.Dictionary())
        page.Contents = pdf.make_stream(b'BT /F1 18 Tf 40 740 Td (DocFlow preservation 123) Tj ET\n' + (b'q 360 0 0 240 40 400 cm /Im1 Do Q\n' if photo is not None else b''))
        page.Annots = pikepdf.Array([pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Text, Rect=pikepdf.Array([40, 360, 60, 380]), Contents='Keep this note'))])
    pdf.docinfo['/Title'] = 'Synthetic preservation fixture'
    pdf.save(path)


class EnginesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name)
        self.source = self.directory / 'input.pdf'
        self.output = self.directory / 'result.pdf'

    def tearDown(self):
        self.tmp.cleanup()

    def test_compression_really_resamples_and_preserves_text_annotation_metadata(self):
        make_pdf(self.source)
        original = self.source.read_bytes()
        result = compress_pdf(self.source, self.output, {'jpegQuality': 70, 'dpi': 100, 'maxImagePixels': 1000})
        self.assertGreater(result['imagesChanged'], 0)
        self.assertLess(self.output.stat().st_size, len(original))
        self.assertEqual(self.source.read_bytes(), original)
        with pikepdf.open(self.output) as pdf:
            image = pdf.pages[0].Resources.XObject.Im1
            self.assertLessEqual(int(image.Width), 502)
            self.assertGreaterEqual(int(image.Height), 334)
            self.assertEqual(str(pdf.pages[0].Annots[0].Contents), 'Keep this note')
            self.assertEqual(str(pdf.docinfo.Title), 'Synthetic preservation fixture')
        with pdfium.PdfDocument(self.output) as pdf:
            self.assertIn('DocFlow preservation 123', pdf[0].get_textpage().get_text_range())
        measured = verify_output(self.output, expected_pages=1)
        self.assertEqual(measured['sha256'], hashlib.sha256(self.output.read_bytes()).hexdigest())

    def test_quality_and_dpi_controls_change_actual_output(self):
        make_pdf(self.source)
        compress_pdf(self.source, self.output, {'jpegQuality': 50, 'dpi': 72, 'maxImagePixels': 900})
        other = self.directory / 'other.pdf'
        compress_pdf(self.source, other, {'jpegQuality': 95, 'dpi': 300, 'maxImagePixels': 2200})
        with pikepdf.open(self.output) as low, pikepdf.open(other) as high:
            self.assertLess(int(low.pages[0].Resources.XObject.Im1.Width), int(high.pages[0].Resources.XObject.Im1.Width))
        self.assertLess(self.output.stat().st_size, other.stat().st_size)

    def test_anisotropic_placement_preserves_both_axis_dpi(self):
        make_pdf(self.source)
        with pikepdf.open(self.source) as pdf:
            pdf.pages[0].Contents = pdf.make_stream(b'q 72 0 0 720 0 0 cm /Im1 Do Q')
            pdf.save(self.directory / 'stretched.pdf')
        compress_pdf(self.directory / 'stretched.pdf', self.output, {'jpegQuality':70,'dpi':100,'maxImagePixels':2200})
        with pikepdf.open(self.output) as pdf:
            self.assertGreaterEqual(int(pdf.pages[0].Resources.XObject.Im1.Height), 1000)

    def test_shared_annotation_image_is_not_rewritten(self):
        make_pdf(self.source)
        with pikepdf.open(self.source) as pdf:
            page = pdf.pages[0]
            image = page.Resources.XObject.Im1
            page.Contents = pdf.make_stream(b'q 36 0 0 24 0 0 cm /Im1 Do Q')
            appearance = pdf.make_stream(b'q 360 0 0 240 0 0 cm /Im1 Do Q', Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Form, BBox=pikepdf.Array([0,0,360,240]), Resources=pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im1=image)))
            page.Annots[0].AP = pikepdf.Dictionary(N=appearance)
            pdf.save(self.directory / 'shared.pdf')
        result = compress_pdf(self.directory / 'shared.pdf', self.output, {'jpegQuality':70,'dpi':100,'maxImagePixels':2200})
        self.assertEqual(result['imagesChanged'], 0)
        with pikepdf.open(self.output) as pdf:
            self.assertEqual(int(pdf.pages[0].Annots[0].AP.N.Resources.XObject.Im1.Width), 1800)

    def test_jpeg_actual_dimensions_must_match_declared_pixel_budget(self):
        make_pdf(self.source, image=False)
        data = io.BytesIO()
        Image.new('RGB',(7000,6000)).save(data,format='JPEG')
        with pikepdf.open(self.source) as pdf:
            image = pdf.make_stream(data.getvalue(), Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image, Width=100, Height=100, BitsPerComponent=8, ColorSpace=pikepdf.Name.DeviceRGB, Filter=pikepdf.Name.DCTDecode)
            pdf.pages[0].Resources.XObject.Im1 = image
            pdf.pages[0].Contents = pdf.make_stream(b'q 360 0 0 240 0 0 cm /Im1 Do Q')
            pdf.save(self.directory / 'mismatch.pdf')
        with self.assertRaisesRegex(EngineError,'dimension|pixel'):
            compress_pdf(self.directory / 'mismatch.pdf',self.output,{'jpegQuality':70,'dpi':100,'maxImagePixels':2200})

    def test_content_decompression_is_bounded_before_instruction_parsing(self):
        make_pdf(self.source,image=False)
        with pikepdf.open(self.source) as pdf:
            pdf.pages[0].Contents = pdf.make_stream(b'q Q ' * 1_000_001)
            pdf.save(self.directory / 'complex.pdf')
        with self.assertRaisesRegex(EngineError,'content.*budget'):
            compress_pdf(self.directory / 'complex.pdf',self.output,{'jpegQuality':70,'dpi':100,'maxImagePixels':2200})

    def test_explicit_jpeg_color_transform_is_preserved_unchanged(self):
        make_pdf(self.source,image=False)
        data = io.BytesIO()
        Image.new('RGB',(1000,1000),(240,50,60)).save(data,format='JPEG',quality=95)
        with pikepdf.open(self.source) as pdf:
            image = pdf.make_stream(data.getvalue(), Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image, Width=1000, Height=1000, BitsPerComponent=8, ColorSpace=pikepdf.Name.DeviceRGB, Filter=pikepdf.Name.DCTDecode, DecodeParms=pikepdf.Dictionary(ColorTransform=0))
            pdf.pages[0].Resources.XObject.Im1 = image
            pdf.pages[0].Contents = pdf.make_stream(b'q 360 0 0 360 0 0 cm /Im1 Do Q')
            pdf.save(self.directory / 'color.pdf')
        result = compress_pdf(self.directory / 'color.pdf',self.output,{'jpegQuality':70,'dpi':100,'maxImagePixels':2200})
        self.assertEqual(result['imagesChanged'],0)
        with pikepdf.open(self.output) as pdf:
            image = pdf.pages[0].Resources.XObject.Im1
            self.assertEqual(image.DecodeParms.ColorTransform,0)
            self.assertEqual(image.read_raw_bytes(),data.getvalue())

    def test_masks_are_preserved_and_reported_as_skipped(self):
        make_pdf(self.source, transparent=True)
        result = compress_pdf(self.source, self.output, {'jpegQuality': 70, 'dpi': 100, 'maxImagePixels': 1000})
        self.assertEqual(result['imagesChanged'], 0)
        self.assertGreater(result['imagesSkipped'], 0)
        with pikepdf.open(self.output) as pdf:
            self.assertIn('/SMask', pdf.pages[0].Resources.XObject.Im1)

    def test_no_benefit_returns_exact_original(self):
        make_pdf(self.source, image=False)
        result = compress_pdf(self.source, self.output, {'jpegQuality': 85, 'dpi': 150, 'maxImagePixels': 2200})
        if not result['bytesSaved']:
            self.assertEqual(self.source.read_bytes(), self.output.read_bytes())
        self.assertLessEqual(self.output.stat().st_size, self.source.stat().st_size)

    def test_limits_encryption_signatures_and_invalid_outputs_are_rejected(self):
        make_pdf(self.source, pages=101, image=False)
        with self.assertRaisesRegex(EngineError, 'page'):
            inspect_pdf(self.source)
        pdf = pikepdf.Pdf.new()
        pdf.add_blank_page()
        pdf.Root.AcroForm = pikepdf.Dictionary(Fields=pikepdf.Array([pdf.make_indirect(pikepdf.Dictionary(FT=pikepdf.Name.Sig, T='Signed', V=pikepdf.Dictionary(Type=pikepdf.Name.Sig)))]))
        pdf.save(self.source)
        with self.assertRaisesRegex(EngineError, 'sign'):
            inspect_pdf(self.source)
        self.output.write_text('<html>not a pdf</html>')
        with self.assertRaises(EngineError):
            verify_output(self.output)

    def office(self, entries):
        path = self.directory / 'input.docx'
        with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, data in entries.items():
                archive.writestr(name, data)
        return path

    def test_office_container_rejects_macros_external_links_traversal_and_bombs(self):
        normal = {'[Content_Types].xml': '<Types/>', 'word/document.xml': '<document/>'}
        self.assertEqual(inspect_office(self.office(normal), 'docx')['format'], 'docx')
        bad = [
            {'word/vbaProject.bin': b'macro'},
            {'word/_rels/document.xml.rels': '<Relationships><Relationship TargetMode="External" Target="https://evil.test"/></Relationships>'},
            {'../payload': b'bad'},
            {'word/bomb.xml': b'0' * 2_000_000},
            {'word/embeddings/oleObject1.bin': b'embedded object'},
            {'word/_rels/document.xml.rels': '<!DOCTYPE x [<!ENTITY x "bad">]><Relationships/>'},
        ]
        for entries in bad:
            with self.subTest(entries=list(entries)), self.assertRaises(EngineError):
                inspect_office(self.office({**normal, **entries}), 'docx')

    def test_embedded_chart_workbooks_share_archive_budget_and_validation(self):
        workbook = io.BytesIO()
        with zipfile.ZipFile(workbook,'w',zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('[Content_Types].xml','<Types/>')
            archive.writestr('xl/workbook.xml','<workbook/>')
        office = self.office({'[Content_Types].xml':'<Types/>','word/document.xml':'<document/>','word/embeddings/chart.xlsx':workbook.getvalue()})
        self.assertEqual(inspect_office(office,'docx')['entries'],5)
        with zipfile.ZipFile(workbook,'a',zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('xl/vbaProject.bin',b'blocked')
        with self.assertRaises(EngineError):
            inspect_office(self.office({'[Content_Types].xml':'<Types/>','word/document.xml':'<document/>','word/embeddings/chart.xlsx':workbook.getvalue()}),'docx')


if __name__ == '__main__':
    unittest.main()
