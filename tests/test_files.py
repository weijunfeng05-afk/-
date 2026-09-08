from io import BytesIO
import pytest
from pypdf import PdfWriter
from reportlab.pdfgen import canvas
from backend.files import extract, check_file, redact_blocks, MAX_FILE_BYTES
from backend.domain import AppError
from conftest import docx_bytes


def test_docx_order_and_tables():
    blocks = extract('resume.docx', docx_bytes('Alice\nPython engineer', table=True))
    assert [b['text'] for b in blocks] == ['Alice','Python engineer','Project experience','Built a Python API']
    assert '表格单元格' in blocks[-1]['location']
    assert len({b['id'] for b in blocks}) == len(blocks)


def pdf_bytes(blank=False):
    out = BytesIO()
    c = canvas.Canvas(out)
    if not blank:
        c.drawString(70, 750, 'Python engineer')
    c.showPage(); c.save()
    return out.getvalue()


def test_pdf_page_locator():
    blocks = extract('resume.pdf', pdf_bytes())
    assert blocks[0]['id'] == 'p1-b1'
    assert 'Python engineer' in blocks[0]['text']


@pytest.mark.parametrize('name,data,code', [('scan.pdf',pdf_bytes(True),'scanned_pdf'), ('wrong.pdf',b'not a pdf','invalid_file'),('wrong.docx',b'corrupt','invalid_file'),('file.txt',b'text','unsupported_file'),('empty.pdf',b'','empty_file'),('empty.docx',docx_bytes(''),'empty_text'),('damaged.pdf',b'%PDF-1.7\nbroken','parse_failed')], ids=['scan','wrong-pdf','wrong-docx','unsupported','empty-file','empty-docx','damaged-pdf'])
def test_invalid_files(name,data,code):
    with pytest.raises(AppError) as exc:
        extract(name, data)
    assert exc.value.code == code


def test_encrypted_pdf():
    w=PdfWriter(); w.add_blank_page(width=500,height=500); w.encrypt('password'); out=BytesIO();w.write(out)
    with pytest.raises(AppError) as exc: extract('encrypted.pdf',out.getvalue())
    assert exc.value.code == 'encrypted_pdf'


def test_file_and_context_limits():
    with pytest.raises(AppError,match='10 MB'): check_file('big.pdf',b'%PDF-'+b'a'*MAX_FILE_BYTES)
    with pytest.raises(AppError,match='60,000'): extract('long.docx',docx_bytes('x'*60001))


def test_contact_and_identity_redaction():
    blocks=[{'id':'d1','text':'姓名：Alice Chen\nPython developer\n电话：13812345678\nalice@example.com'}]
    redacted=redact_blocks(blocks,'Alice Chen')[0]['text']
    assert all(x not in redacted for x in ['Alice Chen','13812345678','alice@example.com'])
    assert 'Python developer' in redacted
    assert 'Alice Chen' in redact_blocks(blocks,hide_identity=False)[0]['text']
