"""Bounded PDF / DOCX extraction, including tables and stable source locators."""
import re
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile, BadZipFile
from docx import Document
from docx.oxml.ns import qn
from pypdf import PdfReader
from .domain import AppError

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TEXT_CHARS = 60000


def check_file(name, data):
    ext = Path(name).suffix.lower()
    if ext not in ('.pdf', '.docx'):
        raise AppError('unsupported_file', '仅支持 PDF 和 DOCX 文件。')
    if len(data) > MAX_FILE_BYTES:
        raise AppError('file_too_large', '单个文件不能超过 10 MB。')
    if not data:
        raise AppError('empty_file', '文件为空，请重新选择。')
    if ext == '.pdf' and not data.startswith(b'%PDF-'):
        raise AppError('invalid_file', '文件内容不是有效 PDF。')
    if ext == '.docx':
        try:
            with ZipFile(BytesIO(data)) as z:
                if 'word/document.xml' not in z.namelist() or sum(i.file_size for i in z.infolist()) > 40 * 1024 * 1024:
                    raise AppError('invalid_file', 'DOCX 结构无效或解压后过大。')
        except BadZipFile:
            raise AppError('invalid_file', 'DOCX 文件已损坏。') from None
    return ext


def extract(name, data):
    ext = check_file(name, data)
    blocks = []
    try:
        if ext == '.pdf':
            reader = PdfReader(BytesIO(data))
            if reader.is_encrypted:
                raise AppError('encrypted_pdf', '暂不支持加密 PDF，请先解除密码。')
            if len(reader.pages) > 100:
                raise AppError('file_too_large', 'PDF 不能超过 100 页。')
            for page_no, page in enumerate(reader.pages, 1):
                text = page.extract_text() or ''
                if not text.strip():
                    raise AppError('scanned_pdf', f'第 {page_no} 页无法提取文字，扫描件或混合扫描页暂不支持 OCR。')
                for n, part in enumerate(re.split(r'\n\s*\n', text), 1):
                    if part.strip():
                        blocks.append({'id': f'p{page_no}-b{n}', 'location': f'第 {page_no} 页 · 文本块 {n}', 'text': part.strip()})
        else:
            doc = Document(BytesIO(data))
            # XML traversal preserves order and includes nested table cell paragraphs.
            for n, p in enumerate(doc.element.body.iter(qn('w:p')), 1):
                text = ''.join(t.text or '' for t in p.iter(qn('w:t'))).strip()
                if text:
                    cell = any(a.tag == qn('w:tc') for a in p.iterancestors())
                    blocks.append({'id': f'd{n}', 'location': f'{"表格单元格" if cell else "段落"} {n}', 'text': text})
    except AppError:
        raise
    except Exception:
        raise AppError('parse_failed', '文件损坏或格式无法解析，请尝试重新导出。') from None
    if not blocks:
        raise AppError('empty_text', '文件没有可提取的正文。')
    if sum(len(b['text']) for b in blocks) > MAX_TEXT_CHARS:
        raise AppError('text_too_long', '正文超过 60,000 字符，当前模型输入上限不支持该文件。')
    return blocks


def redact_blocks(blocks, name='', hide_identity=True):
    """Remove contact details / known name before resume facts and matching calls."""
    result = []
    for b in blocks:
        text = b['text']
        if name:
            text = text.replace(name, '[姓名已隐藏]')
        text = re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', '[邮箱已隐藏]', text)
        text = re.sub(r'(?<!\d)(?:\+?86[- ]?)?1[3-9]\d[ -]?\d{4}[ -]?\d{4}(?!\d)', '[电话已隐藏]', text)
        fields = '电话|手机|邮箱|email|phone|微信|地址|性别|年龄|出生日期|民族|婚姻状况'
        if hide_identity:
            fields = '姓名|name|' + fields
        text = re.sub(r'(?im)(' + fields + r')\s*[:：][^\n|｜;；]*', r'\1：[已隐藏]', text)
        result.append({**b, 'text': text})
    return result
