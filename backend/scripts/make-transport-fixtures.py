"""Reproducible, synthetic-only inputs for the explicitly invoked hosted probe."""
import base64
import io
import json
import tempfile
from pathlib import Path
from docx import Document
from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from PIL import Image, ImageDraw, ImageFont
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.util import Inches

fixtures = []
def add(name, data, operation, options, phrases, pages):
    fixtures.append(dict(name=name, base64=base64.b64encode(data).decode(), operation=operation,
                         options=options, expectedPhrases=phrases, expectedPages=pages))

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    doc = Document()
    doc.add_heading('DocFlow hosted acceptance', 0)
    table = doc.add_table(rows=2, cols=2)
    for row, values in zip(table.rows, [('Item', 'Amount'), ('Alpha', '125.50')]):
        for cell, value in zip(row.cells, values): cell.text = value
    doc.add_page_break()
    doc.add_heading('Second page preserved', 1)
    doc.save(root/'office.docx')
    add('office.docx', (root/'office.docx').read_bytes(), 'office-to-pdf', {}, ['Alpha', '125.50', 'Second page preserved'], 2)

    deck = Presentation()
    first = deck.slides.add_slide(deck.slide_layouts[1])
    first.shapes.title.text = 'DocFlow slide one'
    first.placeholders[1].text = 'Hosted conversion preserves editable content'
    second = deck.slides.add_slide(deck.slide_layouts[5])
    second.shapes.title.text = 'DocFlow slide two'
    chart = CategoryChartData()
    chart.categories = ['Alpha', 'Beta', 'Gamma']
    chart.add_series('Revenue', [10, 20, 30])
    second.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(1), Inches(1.5), Inches(7), Inches(4), chart)
    deck.save(root/'office.pptx')
    add('office.pptx', (root/'office.pptx').read_bytes(), 'office-to-pdf', {}, ['DocFlow slide one', 'DocFlow slide two', 'Gamma'], 2)

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = 'Revenue'
    for row in [('Category', 'Amount'), ('Alpha', 10), ('Beta', 20), ('Gamma', 30)]: sheet.append(row)
    bar = BarChart()
    bar.title = 'Revenue chart'
    bar.add_data(Reference(sheet, min_col=2, min_row=1, max_row=4), titles_from_data=True)
    bar.set_categories(Reference(sheet, min_col=1, min_row=2, max_row=4))
    sheet.add_chart(bar, 'D2')
    workbook.create_sheet('Summary')['A1'] = 'DocFlow workbook summary'
    for tab in workbook:
        tab.print_area = 'A1:M24'
        tab.sheet_properties.pageSetUpPr.fitToPage = True
        tab.page_setup.fitToWidth = 1
        tab.page_setup.fitToHeight = 1
    workbook.save(root/'office.xlsx')
    add('office.xlsx', (root/'office.xlsx').read_bytes(), 'office-to-pdf', {}, ['Alpha', 'Revenue chart', 'DocFlow workbook summary'], 2)

    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 42)
    for language, text in [('eng', 'DocFlow makes scanned documents searchable.\nInvoice number 2026 1042 and total 125.50.'),
                           ('deu', 'DocFlow macht gescannte Dokumente durchsuchbar.\nRechnung Nummer 2026 1042 und Summe 125,50.')]:
        image = Image.new('RGB', (1800, 600), 'white')
        ImageDraw.Draw(image).multiline_text((80, 100), text, font=font, fill='black', spacing=35)
        content = io.BytesIO()
        image.save(content, 'PDF', resolution=200, quality=98)
        add('ocr-'+language+'.pdf', content.getvalue(), 'ocr', {'languages': ['eng'] if language=='eng' else ['eng','deu'], 'deskew': False, 'rotate': False}, text.split('\n'), 1)
    # A large uncompressed RGB raster gives compression a measurable reduction.
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import ImageReader
    cancellation = io.BytesIO()
    scan = ImageReader(image)
    pages = canvas.Canvas(cancellation, pagesize=(648, 216), invariant=True)
    for _ in range(20):
        pages.drawImage(scan, 0, 0, width=648, height=216)
        pages.showPage()
    pages.save()
    add('cancellation.pdf', cancellation.getvalue(), 'ocr', {'languages': ['eng','deu'], 'deskew': False, 'rotate': False}, [], 20)
    fixtures[-1]['cancellationOnly'] = True
    image = Image.linear_gradient('L').resize((1800, 1800)).convert('RGB')
    content = io.BytesIO()
    pdf = canvas.Canvas(content, pagesize=(600, 600), invariant=True, pageCompression=0)
    pdf.drawImage(ImageReader(image), 0, 0, width=600, height=600)
    pdf.drawString(30, 30, 'DocFlow compression keeps searchable text')
    pdf.showPage()
    pdf.save()
    add('compression.pdf', content.getvalue(), 'compress', {'jpegQuality': 75, 'dpi': 96, 'maxImagePixels': 1200}, ['DocFlow compression keeps searchable text'], 1)

target = Path(__file__).resolve().parents[1]/'fixtures'/'transport.json'
target.parent.mkdir(exist_ok=True)
target.write_text(json.dumps(fixtures, separators=(',', ':'))+'\n')
print(f'Wrote {len(fixtures)} synthetic fixtures ({target.stat().st_size} bytes)')
