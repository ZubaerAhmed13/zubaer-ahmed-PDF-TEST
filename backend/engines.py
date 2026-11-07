"""Bounded processing engines. Production execution requires an isolated, offline VM.

This module deliberately does not implement secure redaction, PDF/A or editable Office.
"""
from __future__ import annotations

import hashlib
import importlib.metadata
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import time
import zipfile
import zlib

from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException
from PIL import Image
import pikepdf
import pypdfium2 as pdfium

INPUT_BYTES = 25 * 1024 * 1024
OUTPUT_BYTES = 50 * 1024 * 1024
MAX_PAGES = 100
MAX_IMAGE_PIXELS = 40_000_000
MAX_TOTAL_IMAGE_PIXELS = 80_000_000
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


class EngineError(ValueError):
    """Expected, safe-to-present processing rejection."""


def bounded_file(path: Path, maximum: int, magic: bytes | None = None):
    size = path.stat().st_size
    if size < 8 or size > maximum:
        raise EngineError('File size is outside the processing limit')
    if magic:
        with path.open('rb') as source:
            if not source.read(len(magic)).startswith(magic):
                raise EngineError('File contents do not match the declared format')
    return size


def inspect_pdf(path: Path, maximum=INPUT_BYTES):
    bounded_file(path, maximum, b'%PDF-')
    try:
        with pikepdf.open(path, attempt_recovery=False) as pdf:
            if pdf.is_encrypted:
                raise EngineError('Encrypted PDFs must be unlocked before processing')
            if not 1 <= len(pdf.pages) <= MAX_PAGES:
                raise EngineError('PDF page count exceeds the 100-page limit')
            if pdf.check_pdf_syntax():
                raise EngineError('PDF requires repair before processing')
            if '/Perms' in pdf.Root:
                raise EngineError('Signed or certified PDFs are not supported')
            for obj in pdf.objects:
                if not isinstance(obj, (pikepdf.Dictionary, pikepdf.Stream)):
                    continue
                if obj.get('/FT') == '/Sig' or obj.get('/Type') == '/Sig':
                    raise EngineError('PDF signature fields are not supported')
                if obj.get('/S') in ('/JavaScript', '/Launch', '/SubmitForm', '/ImportData', '/GoToR') or '/JS' in obj:
                    raise EngineError('PDF active content is not supported')
                if '/EF' in obj or '/XFA' in obj:
                    raise EngineError('PDF embedded files and XFA forms are not supported')
            return {'pages': len(pdf.pages), 'forms': bool(pdf.Root.get('/AcroForm')), 'annotations': sum(len(p.obj.get('/Annots', [])) for p in pdf.pages)}
    except pikepdf.PasswordError as error:
        raise EngineError('Encrypted PDFs must be unlocked before processing') from error
    except pikepdf.PdfError as error:
        raise EngineError('PDF could not be parsed safely') from error


def inspect_office(path: Path, extension: str):
    bounded_file(path, INPUT_BYTES, b'PK')
    budget = {'expandedBytes': 0, 'entries': 0}
    try:
        with zipfile.ZipFile(path) as archive:
            scan_office_archive(archive, extension, budget)
        return {'format': extension, **budget}
    except EngineError:
        raise
    except (zipfile.BadZipFile, RuntimeError, ElementTree.ParseError, DefusedXmlException, ValueError) as error:
        raise EngineError('Office archive is invalid or unsafe') from error


def scan_office_archive(archive, extension, budget, depth=0):
    required = {'docx': 'word/document.xml', 'pptx': 'ppt/presentation.xml', 'xlsx': 'xl/workbook.xml'}
    if extension not in required or depth > 1:
        raise EngineError('Only DOCX, PPTX and XLSX with bounded chart data are supported')
    entries = archive.infolist()
    budget['entries'] += len(entries)
    if budget['entries'] > 10_000 or len({entry.filename for entry in entries}) != len(entries):
        raise EngineError('Office archive has too many or duplicate entries')
    names = {entry.filename for entry in entries}
    if '[Content_Types].xml' not in names or required[extension] not in names:
        raise EngineError('Office contents do not match the declared format')
    for entry in entries:
        name, lower = entry.filename, entry.filename.lower()
        parts = PurePosixPath(name).parts
        if name.startswith('/') or '\\' in name or any(part in ('.', '..') for part in parts) or ':' in name or any(ord(char) < 32 for char in name):
            raise EngineError('Office archive contains an unsafe path')
        budget['expandedBytes'] += entry.file_size
        if entry.flag_bits & 1 or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raise EngineError('Encrypted or unsupported Office archive')
        if entry.file_size > 50*1024*1024 or budget['expandedBytes'] > 200*1024*1024 or entry.file_size > max(1, entry.compress_size)*100:
            raise EngineError('Office decompression budget exceeded')
        if any(part in lower for part in ('vbaproject', 'vbadata', '/activex/')) or lower.endswith(('.exe', '.dll', '.js', '.vbs')):
            raise EngineError('Office macros and embedded executable objects are not supported')
        data = archive.read(entry)  # CRC checked inside the shared expansion budget.
        if '/embeddings/' in lower:
            if extension not in ('docx','pptx') or not lower.endswith('.xlsx'):
                raise EngineError('Office embedded executable/OLE objects are not supported')
            with zipfile.ZipFile(io.BytesIO(data)) as nested:
                scan_office_archive(nested, 'xlsx', budget, depth+1)
        elif lower.endswith(('.xml', '.rels')):
            if len(data) > 20*1024*1024:
                raise EngineError('Office XML part exceeds the size limit')
            root = ElementTree.fromstring(data, forbid_dtd=True)
            for element in root.iter():
                if element.attrib.get('TargetMode', '').lower() == 'external':
                    raise EngineError('Office external links must be removed before upload')
                for value in element.attrib.values():
                    if 'macroenabled' in value.lower() or 'vbaproject' in value.lower():
                        raise EngineError('Office macro-enabled content is not supported')


def multiply(left, right):
    a, b, c, d, e, f = left
    g, h, i, j, k, l = right
    return (a*g+c*h, b*g+d*h, a*i+c*j, b*i+d*j, a*k+c*l+e, b*k+d*l+f)


def stream_size_bounded(stream, maximum):
    """Measure decompressed bytes with bounded chunks before qpdf/Pillow can allocate them."""
    raw = stream.read_raw_bytes()
    filter_name = stream.get('/Filter')
    if isinstance(filter_name, pikepdf.Array) and len(filter_name) == 1:
        filter_name = filter_name[0]
    if filter_name is None:
        size = len(raw)
    elif filter_name == '/FlateDecode':
        decoder, size, pending = zlib.decompressobj(), 0, raw
        try:
            while pending:
                chunk = decoder.decompress(pending, min(1024*1024, maximum-size+1))
                size += len(chunk)
                if size > maximum:
                    raise EngineError('PDF decoded content/image budget exceeded')
                pending = decoder.unconsumed_tail
            if not decoder.eof or decoder.unused_data:
                raise EngineError('PDF compressed stream is malformed')
        except zlib.error as error:
            raise EngineError('PDF compressed stream is malformed') from error
    else:
        raise EngineError('PDF content stream encoding is not supported')
    if size > maximum:
        raise EngineError('PDF decoded content/image budget exceeded')
    return size


def protected_image_ids(pdf):
    """Conservatively leave images shared with unmeasured appearance contexts intact."""
    protected, visited, direct_count = set(), set(), 0

    def visit(obj, depth=0):
        nonlocal direct_count
        if not isinstance(obj, (pikepdf.Dictionary, pikepdf.Stream, pikepdf.Array)):
            return
        if depth > 64:
            raise EngineError('PDF resource nesting exceeds the limit')
        direct_count += 1
        if direct_count > 100_000:
            raise EngineError('PDF resource complexity exceeds the limit')
        key = obj.objgen
        if key != (0, 0):
            if key in visited:
                return
            visited.add(key)
        if isinstance(obj, pikepdf.Array):
            children = list(obj)
        else:
            if obj.get('/Subtype') == '/Image':
                protected.add(key)
            children = [value for _, value in obj.items()]
        for child in children:
            visit(child, depth+1)

    for obj in pdf.objects:
        if isinstance(obj, (pikepdf.Dictionary, pikepdf.Stream)):
            if obj.get('/Subtype') == '/Type3' or obj.get('/Type') == '/Pattern':
                visit(obj)
            for key in ('/AP', '/Pattern', '/Thumb', '/SMask', '/Mask'):
                if key in obj:
                    visit(obj[key])
    return protected


def image_placements(pdf):
    placements = {}
    count = 0
    decoded_bytes = 0

    def visit(stream, resources, matrix, ancestors=()):
        nonlocal count, decoded_bytes
        if len(ancestors) > 32:
            raise EngineError('PDF graphics nesting exceeds the limit')
        contents = stream.obj.get('/Contents', []) if isinstance(stream, pikepdf.Page) else stream
        parts = list(contents) if isinstance(contents, pikepdf.Array) else [contents]
        page_bytes = 0
        for part in parts:
            if not isinstance(part, pikepdf.Stream):
                raise EngineError('PDF content stream is malformed')
            page_bytes += stream_size_bounded(part, 256*1024-page_bytes)
        decoded_bytes += page_bytes
        if decoded_bytes > 2*1024*1024:
            raise EngineError('PDF decoded content budget exceeded')
        stack = []
        for operands, operator in pikepdf.parse_content_stream(stream):
            count += 1
            if count > 100_000:
                raise EngineError('PDF graphics complexity exceeds the limit')
            op = str(operator)
            if op == 'q':
                stack.append(matrix)
                if len(stack) > 128:
                    raise EngineError('PDF graphics stack exceeds the limit')
            elif op == 'Q':
                if not stack:
                    raise EngineError('PDF graphics state is malformed')
                matrix = stack.pop()
            elif op == 'cm':
                if len(operands) != 6 or not all(math.isfinite(float(v)) and abs(float(v)) < 1e8 for v in operands):
                    raise EngineError('PDF transformation is unsupported')
                matrix = multiply(matrix, tuple(float(v) for v in operands))
            elif op == 'Do':
                objects = resources.get('/XObject', {})
                obj = objects.get(operands[0]) if len(operands) == 1 else None
                if obj is None:
                    raise EngineError('PDF references a missing graphics object')
                key = obj.objgen
                if obj.get('/Subtype') == '/Image':
                    width, height = math.hypot(matrix[0], matrix[1]), math.hypot(matrix[2], matrix[3])
                    previous = placements.get(key, (obj, 0, 0))
                    placements[key] = (obj, max(previous[1], width), max(previous[2], height))
                elif obj.get('/Subtype') == '/Form':
                    if key in ancestors:
                        raise EngineError('PDF contains a cyclic graphics object')
                    form_matrix = tuple(float(v) for v in obj.get('/Matrix', [1, 0, 0, 1, 0, 0]))
                    if len(form_matrix) != 6 or not all(math.isfinite(v) for v in form_matrix):
                        raise EngineError('PDF form transformation is unsupported')
                    visit(obj, obj.get('/Resources', resources), multiply(matrix, form_matrix), ancestors + (key,))
        if stack:
            raise EngineError('PDF graphics state is unbalanced')

    for page in pdf.pages:
        unit = float(page.obj.get('/UserUnit', 1))
        if not math.isfinite(unit) or not 0 < unit <= 100:
            raise EngineError('PDF page scale is unsupported')
        visit(page, page.Resources, (unit, 0, 0, unit, 0, 0))
    return placements.values()


def compress_pdf(source: Path, output: Path, options: dict):
    measured = inspect_pdf(source)
    stats = {'imagesChanged': 0, 'imagesSkipped': 0, 'bytesSaved': 0}
    total_pixels = 0
    with pikepdf.open(source, attempt_recovery=False) as pdf:
        protected = protected_image_ids(pdf)
        for image, physical_width, physical_height in image_placements(pdf):
            width, height = int(image.get('/Width', 0)), int(image.get('/Height', 0))
            total_pixels += width * height
            if min(width, height) <= 0 or width * height > MAX_IMAGE_PIXELS or total_pixels > MAX_TOTAL_IMAGE_PIXELS:
                raise EngineError('PDF image pixel budget exceeded')
            filters = image.get('/Filter')
            unsupported = image.objgen in protected or any(key in image for key in ('/SMask', '/Mask', '/Decode', '/Alternates', '/OPI', '/Matte', '/SMaskInData'))
            unsupported |= bool(image.get('/ImageMask', False)) or image.get('/BitsPerComponent') != 8
            unsupported |= image.get('/ColorSpace') not in ('/DeviceRGB', '/DeviceGray')
            unsupported |= filters not in (None, '/FlateDecode', '/DCTDecode')
            unsupported |= filters == '/DCTDecode' and image.get('/DecodeParms') is not None
            if unsupported or physical_width <= 0 or physical_height <= 0:
                stats['imagesSkipped'] += 1
                continue
            # Preserve the largest use of a shared image, including nested form matrices.
            ratio = min(1, options['maxImagePixels']/max(width, height), max(max(1, math.ceil(physical_width*options['dpi']/72))/width, max(1, math.ceil(physical_height*options['dpi']/72))/height))
            new_size = (max(1, math.ceil(width*ratio)), max(1, math.ceil(height*ratio)))
            try:
                if filters == '/DCTDecode':
                    picture = Image.open(io.BytesIO(image.read_raw_bytes()))
                    if picture.size != (width, height) or picture.width*picture.height > MAX_IMAGE_PIXELS:
                        raise EngineError('JPEG dimensions do not match the bounded PDF image')
                else:
                    channels = 3 if image.ColorSpace == '/DeviceRGB' else 1
                    stream_size_bounded(image, (width*channels+1)*height)
                    picture = pikepdf.PdfImage(image).as_pil_image()
                picture.load()
                if picture.mode not in ('RGB', 'L'):
                    stats['imagesSkipped'] += 1
                    continue
                if new_size != picture.size:
                    picture = picture.resize(new_size, Image.Resampling.LANCZOS)
                buffer = io.BytesIO()
                picture.save(buffer, format='JPEG', quality=options['jpegQuality'], optimize=True)
                data = buffer.getvalue()
                if len(data) >= len(image.read_raw_bytes()):
                    stats['imagesSkipped'] += 1
                    continue
                image.write(data, filter=pikepdf.Name.DCTDecode)
                image.Width, image.Height = new_size
                if '/DecodeParms' in image:
                    del image['/DecodeParms']
                stats['imagesChanged'] += 1
            except EngineError:
                raise
            except (pikepdf.PdfError, OSError, ValueError, NotImplementedError, Image.DecompressionBombError) as error:
                raise EngineError('PDF image could not be decoded safely') from error
        pdf.save(output, compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.preserve)
    if output.stat().st_size >= source.stat().st_size:
        shutil.copyfile(source, output)
        stats['imagesChanged'] = 0
    stats['bytesSaved'] = source.stat().st_size - output.stat().st_size
    verify_output(output, expected_pages=measured['pages'])
    return stats


def run_tool(argv: list[str], directory: Path, timeout=160):
    # Fixed argv only. The outer VM supplies the actual isolation and hard deadline.
    with (directory / 'engine.log').open('ab') as log:
        try:
            result = subprocess.run(argv, cwd=directory, stdin=subprocess.DEVNULL, stdout=log, stderr=log, timeout=timeout, check=False, env={**os.environ, 'HOME': str(directory), 'TMPDIR': str(directory / 'tmp')})
        except subprocess.TimeoutExpired as error:
            raise EngineError('Processing deadline exceeded') from error
    if result.returncode != 0:
        raise EngineError('Processing engine rejected this file')


def office_to_pdf(source: Path, output: Path, extension: str):
    inspected = inspect_office(source, extension)
    executable = shutil.which('libreoffice')
    if not executable:
        raise EngineError('Office conversion engine is not installed')
    directory = output.parent
    profile = (directory / 'lo-profile').as_uri()
    # The generated profile disables macro execution and link updates as a second boundary.
    user = directory / 'lo-profile' / 'user'
    user.mkdir(parents=True, exist_ok=True)
    (user / 'registrymodifications.xcu').write_text('''<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Common/Load"><prop oor:name="UpdateLinks" oor:op="fuse"><value>0</value></prop></item></oor:items>''')
    conversion = directory / 'converted'
    conversion.mkdir()
    run_tool([executable, f'-env:UserInstallation={profile}', '--headless', '--nologo', '--nodefault', '--nolockcheck', '--norestore', '--convert-to', 'pdf', '--outdir', str(conversion), str(source)], directory)
    converted = conversion / f'{source.stem}.pdf'
    if not converted.is_file():
        raise EngineError('Office engine did not produce a PDF')
    shutil.move(converted, output)
    verify_output(output)
    return {**inspected, 'fontSubstitution': 'Open replacement fonts may change pagination; review the converted document.'}


def ocr_pdf(source: Path, output: Path, options: dict):
    inspected = inspect_pdf(source)
    if inspected['forms'] or inspected['annotations']:
        raise EngineError('OCR of forms or annotations is not yet supported; flatten a copy first')
    languages = options['languages']
    available = subprocess.run(['tesseract', '--list-langs'], capture_output=True, text=True, timeout=10, check=True).stdout.splitlines()
    if any(language not in available for language in languages):
        raise EngineError('Requested OCR language is not installed')
    # PDFium rasterization and PDF output avoid an implicit Ghostscript/PDF-A dependency.
    argv = [sys.executable, '-m', 'ocrmypdf', '--output-type', 'pdf', '--rasterizer', 'pypdfium', '--optimize', '0', '--skip-text', '--jobs', '1', '--tesseract-timeout', '60', '--max-image-mpixels', '40', '--language', '+'.join(languages)]
    if options['deskew']:
        argv.append('--deskew')
    if options['rotate']:
        argv.append('--rotate-pages')
    run_tool([*argv, str(source), str(output)], output.parent)
    verify_output(output, expected_pages=inspected['pages'])
    return {'languages': languages, 'deskew': options['deskew'], 'rotate': options['rotate']}


def verify_output(path: Path, expected_pages=None):
    measured = inspect_pdf(path, OUTPUT_BYTES)
    if expected_pages is not None and measured['pages'] != expected_pages:
        raise EngineError('Output page count changed unexpectedly')
    try:
        # Independent parser plus bounded thumbnail renders detect broken output objects.
        with pdfium.PdfDocument(path) as pdf:
            if len(pdf) != measured['pages']:
                raise EngineError('Independent output page count disagrees')
            for page in pdf:
                width, height = page.get_size()
                if not all(math.isfinite(v) and 0 < v <= 100_000 for v in (width, height)):
                    raise EngineError('Output page size is unsupported')
                bitmap = page.render(scale=min(0.25, 160/max(width, height)))
                bitmap.close()
                page.close()
    except EngineError:
        raise
    except Exception as error:
        raise EngineError('Independent output verification failed') from error
    with path.open('rb') as data:
        digest = hashlib.file_digest(data, 'sha256').hexdigest()
    return {'name': 'result.pdf', 'type': 'application/pdf', 'size': path.stat().st_size, 'sha256': digest, 'pages': measured['pages']}


def versions():
    packages = {name: importlib.metadata.version(name) for name in ('pikepdf', 'Pillow', 'pypdfium2', 'ocrmypdf')}
    return {'python': sys.version.split()[0], 'packages': packages, 'qpdf': pikepdf.__libqpdf_version__}


def main():
    if len(sys.argv) != 2:
        raise EngineError('Exactly one fixed job directory is required')
    directory = Path(sys.argv[1]).resolve()
    if not directory.is_dir():
        raise EngineError('Job directory does not exist')
    request = json.loads((directory / 'request.json').read_text())
    operation, options = request['operation'], request['options']
    file = request['files'][0]
    extension = file['name'].rsplit('.', 1)[-1].lower()
    source, output = directory / f'input.{extension}', directory / 'result.pdf'
    bounded_file(source, INPUT_BYTES)
    with source.open('rb') as data:
        if source.stat().st_size != file['size'] or hashlib.file_digest(data, 'sha256').hexdigest() != file['sha256']:
            raise EngineError('Uploaded bytes do not match the declared size and hash')
    (directory / 'tmp').mkdir(exist_ok=True)
    started = time.monotonic()
    if operation == 'compress':
        details = compress_pdf(source, output, options)
    elif operation == 'ocr':
        details = ocr_pdf(source, output, options)
    elif operation == 'office-to-pdf':
        details = office_to_pdf(source, output, extension)
    else:
        raise EngineError('Unsupported operation')
    result = {'output': verify_output(output), 'details': details, 'engines': versions(), 'processingMs': round((time.monotonic()-started)*1000)}
    (directory / 'result.json').write_text(json.dumps(result))
    print(json.dumps({'status': 'verified', 'processingMs': result['processingMs']}))


if __name__ == '__main__':
    try:
        main()
    except EngineError as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        sys.exit(2)
