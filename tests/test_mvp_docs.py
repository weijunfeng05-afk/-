"""Document regression checks: requirements coverage and template preservation."""
import unittest
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E

ROOT=Path(__file__).resolve().parents[1]
BASELINE=json.loads((ROOT/'docs'/'template_baseline.json').read_text(encoding='utf-8'))
NS={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

class DocumentTests(unittest.TestCase):
    def test_deliverables_and_requirements(self):
        for kind in ['产品方案','技术方案']:
            with self.subTest(kind=kind), ZipFile(ROOT/'docs'/f'简历筛选助手_MVP_{kind}_V1.0.docx') as z:
                self.assertIsNone(z.testzip())
                xml=E.fromstring(z.read('word/document.xml'))
                text=''.join(xml.xpath('//w:t/text()',namespaces=NS))
                for token in ['PDF','DOCX','硬性条件','加分','原文','API','待补充信息','重试','Git commit']:
                    self.assertIn(token,text)
                for placeholder in ['[Describe','[Name','[Goal','System Name','Title of Proposal','[Component','[Link']:
                    self.assertNotIn(placeholder,text)
                self.assertFalse(xml.xpath('//w:footnoteReference|//w:drawing|//w:hyperlink',namespaces=NS))
                for row in xml.xpath('//w:tbl[position()>2]/w:tr[w:trPr/w:tblHeader[not(@w:val="0")]]',namespaces=NS):
                    for p in row.xpath('./w:tc/w:p',namespaces=NS):
                        self.assertEqual(p.xpath('./w:r/w:rPr/w:color/@w:val',namespaces=NS),['FFFFFF'])
                if kind=='技术方案':
                    for token in ['React','FastAPI','SQLite','input_snapshot','lease_until','unknown','60 分','80 分','scoring_version','config_version']:
                        self.assertIn(token,text)

    def test_template_parts_and_geometry(self):
        for path in (ROOT/'docs').glob('*.docx'):
            with self.subTest(path=path.name),ZipFile(path) as out:
                self.assertEqual(set(BASELINE['parts']),set(out.namelist()))
                for name, digest in BASELINE['parts'].items():
                    if name in ['word/document.xml','docProps/core.xml'] or name.startswith('word/footer'):
                        continue
                    self.assertEqual(digest,hashlib.sha256(out.read(name)).hexdigest(),name)
                target=E.fromstring(out.read('word/document.xml'))
                for attr, expected in BASELINE['geometry'].items():
                    self.assertEqual(expected,[dict(e.attrib) for e in target.xpath('//w:sectPr/w:'+attr,namespaces=NS)])

if __name__=='__main__': unittest.main()
