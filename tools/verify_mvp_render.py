"""Rasterize the Word-exported PDFs and verify page count and text coverage."""
from pathlib import Path
import json
import pypdfium2 as pdf

ROOT=Path(__file__).resolve().parents[1]
QA=ROOT/'.qa'
manifest=json.loads((QA/'manifest.json').read_text(encoding='utf-8'))
report=[]
for item in manifest['outputs']:
    path=Path(item['path'])
    doc=pdf.PdfDocument(QA/(path.stem+'.pdf'))
    folder=QA/path.stem
    folder.mkdir(exist_ok=True)
    texts=[]
    for i,page in enumerate(doc):
        textpage=page.get_textpage()
        texts.append(textpage.get_text_range())
        page.render(scale=1.5).to_pil().save(folder/f'page-{i+1}.png')
    assert len(doc)==item['expected_pages'], (path.name,len(doc),item['expected_pages'])
    alltext='\n'.join(texts)
    for forbidden in ['Organization Name','System Design RFC','[Draft','[Team Name','[Summarize']:
        assert forbidden not in alltext, (path.name,forbidden)
    assert 'MVP' in alltext and 'Git commit' in alltext
    report.append({'file':path.name,'pages':len(doc),'text_characters':len(alltext),'page_text_lengths':[len(t) for t in texts]})
(QA/'render_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
