from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
import mistune
from PIL import Image
ROOT=Path(__file__).resolve().parent
OUT=ROOT.parent/'ReadSpace-Platform-Handbook.docx'
files=['00-Overview.md','01-Getting-Started.md','02-Web-Guide.md','03-Mobile-Guide.md','04-Cloud-Data.md','05-Walkthroughs.md','06-Use-Cases.md','07-Technical-Reference.md','08-Verification-Limitations.md','09-Quick-Reference.md','10-Workflow-Maps.md','11-Interface-Gallery.md']
md=mistune.create_markdown(renderer='ast',plugins=['table'])
doc=Document(); sec=doc.sections[0];sec.top_margin=Inches(.75);sec.bottom_margin=Inches(.72);sec.left_margin=Inches(.82);sec.right_margin=Inches(.82)
styles=doc.styles
normal=styles['Normal'];normal.font.name='Calibri';normal.font.size=Pt(10);normal.font.color.rgb=RGBColor.from_string('26334A');normal.paragraph_format.space_after=Pt(6)
for name,size,color in [('Title',30,'132544'),('Heading 1',20,'172F54'),('Heading 2',14,'2851A5'),('Heading 3',11,'1B365E')]:
 st=styles[name];st.font.name='Calibri';st.font.size=Pt(size);st.font.bold=True;st.font.color.rgb=RGBColor.from_string(color);st.paragraph_format.space_before=Pt(12);st.paragraph_format.space_after=Pt(6)
for nm in ['List Bullet','List Number']:
 styles[nm].font.name='Calibri';styles[nm].font.size=Pt(10);styles[nm].paragraph_format.space_after=Pt(3)
head=sec.header.paragraphs[0];head.alignment=WD_ALIGN_PARAGRAPH.RIGHT;r=head.add_run('READSPACE  /  PLATFORM HANDBOOK');r.font.size=Pt(8);r.font.color.rgb=RGBColor.from_string('8090AA')
foot=sec.footer.paragraphs[0];foot.alignment=WD_ALIGN_PARAGRAPH.RIGHT
r=foot.add_run('Source-based documentation  •  ');r.font.size=Pt(8);r.font.color.rgb=RGBColor.from_string('8090AA')
fld=OxmlElement('w:fldSimple');fld.set(qn('w:instr'),'PAGE');foot._p.append(fld)
# cover
doc.add_paragraph('READSPACE',style='Subtitle')
doc.add_heading('Platform Handbook',0)
p=doc.add_paragraph('Web  •  Mobile  •  Cloud  •  Backend');p.runs[0].font.size=Pt(17);p.runs[0].font.color.rgb=RGBColor.from_string('4169B1')
doc.add_paragraph('Functionality, user workflows, use cases, technical architecture and verification boundaries.')
doc.add_paragraph('Reviewed source snapshots',style='Heading 2')
doc.add_paragraph('Web/backend: ed7476c18ea6ce5db7c79778f7585dab4be7c845\nMobile: 8071a88341bbbae8ffe3c548fa18ad16165e3943')
doc.add_paragraph('Important',style='Heading 2')
doc.add_paragraph('The current mobile passkey controls are simulated, not real biometric or WebAuthn verification. A mobile password-change payload also appears inconsistent with the backend. See chapter 9 before relying on these features.')
doc.add_paragraph('Real Google Drive, cross-device restoration and current native-device flows were not tested. Repository screenshots are illustrative.')
doc.add_page_break();doc.add_heading('Contents',level=1)
for n,title in enumerate(['Platform overview and feature catalog','Getting started and accounts','Web app user guide','Mobile companion user guide','Cloud, synchronization and data','End-to-end walkthroughs','Use cases','Technical architecture and deployment reference','Verification matrix and known limitations','Quick reference, FAQ and glossary','Workflow maps','Interface gallery'],1):doc.add_paragraph(f'{n:02d}  {title}',style='List Bullet')
doc.add_paragraph('The editable Markdown chapters and image assets are supplied separately in the documentation ZIP.')

def addlink(p,text,url):
 part=p.part;rid=part.relate_to(url,'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',is_external=True)
 h=OxmlElement('w:hyperlink');h.set(qn('r:id'),rid);r=OxmlElement('w:r');pr=OxmlElement('w:rPr');c=OxmlElement('w:color');c.set(qn('w:val'),'315DC4');pr.append(c);u=OxmlElement('w:u');u.set(qn('w:val'),'single');pr.append(u);r.append(pr);t=OxmlElement('w:t');t.text=text;r.append(t);h.append(r);p._p.append(h)
def textof(nodes):
 return ''.join(n.get('raw','') if n['type'] in ('text','codespan','inline_html') else textof(n.get('children',[])) for n in nodes)
def inline(p,nodes,bold=False,italic=False):
 for n in nodes:
  typ=n['type']
  if typ in ('text','codespan','inline_html'):
   r=p.add_run(n.get('raw',''));r.bold=bold;r.italic=italic
   if typ=='codespan':r.font.name='Consolas';r.font.size=Pt(9);r.font.color.rgb=RGBColor.from_string('324F89')
  elif typ=='strong':inline(p,n.get('children',[]),True,italic)
  elif typ=='emphasis':inline(p,n.get('children',[]),bold,True)
  elif typ=='link':
   text=textof(n.get('children',[]));url=n.get('attrs',{}).get('url','')
   if url.startswith('http'):addlink(p,text,url)
   else:p.add_run(text)
  elif typ in ('softbreak','linebreak'):p.add_run('\n' if typ=='linebreak' else ' ')
  elif typ=='image':
   img=ROOT/n['attrs']['url']
   if img.exists():
    w,h=Image.open(img).size; width=min(6.5,5.4*w/h);p.alignment=WD_ALIGN_PARAGRAPH.CENTER;p.add_run().add_picture(str(img),width=Inches(width))
  else:inline(p,n.get('children',[]),bold,italic)
def shade(cell,color):
 tcPr=cell._tc.get_or_add_tcPr();shd=OxmlElement('w:shd');shd.set(qn('w:fill'),color);tcPr.append(shd)
def table(node):
 head=node['children'][0]['children']; body=node['children'][1]['children'];cols=len(head)
 t=doc.add_table(rows=1, cols=cols);t.style='Table Grid';t.alignment=WD_TABLE_ALIGNMENT.CENTER;t.autofit=True
 for i,c in enumerate(head):
  cell=t.rows[0].cells[i];shade(cell,'E8EFFA');cell.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER;p=cell.paragraphs[0];inline(p,c.get('children',[]),True)
 for row in body:
  cells=t.add_row().cells
  for i,c in enumerate(row['children']):
   if i>=cols:break
   cells[i].vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.TOP;inline(cells[i].paragraphs[0],c.get('children',[]))
 for row in t.rows:
  for cell in row.cells:
   for p in cell.paragraphs:
    p.paragraph_format.space_after=Pt(2)
    for r in p.runs:r.font.size=Pt(8 if cols>=5 else 9)
 doc.add_paragraph().paragraph_format.space_after=Pt(1)
def blocks(nodes):
 for n in nodes:
  typ=n['type']
  if typ=='heading':
   p=doc.add_heading(level=min(3,n['attrs']['level']));inline(p,n.get('children',[]))
  elif typ in ('paragraph','block_text'):
   p=doc.add_paragraph();inline(p,n.get('children',[]))
  elif typ=='list':
   style='List Number' if n.get('attrs',{}).get('ordered') else 'List Bullet'
   for item in n.get('children',[]):
    parts=item.get('children',[]);p=doc.add_paragraph(style=style)
    if parts:
     inline(p,parts[0].get('children',[]));blocks(parts[1:])
  elif typ=='table':table(n)
  elif typ=='block_code':
   p=doc.add_paragraph();p.paragraph_format.space_before=Pt(3);p.paragraph_format.space_after=Pt(8)
   r=p.add_run(n.get('raw','').rstrip());r.font.name='Consolas';r.font.size=Pt(7.5);r.font.color.rgb=RGBColor.from_string('304668')
  elif typ=='block_quote':blocks(n.get('children',[]))
for f in files:
 doc.add_page_break();blocks(md((ROOT/f).read_text(encoding='utf-8')))
doc.core_properties.title='ReadSpace — Complete Platform Handbook';doc.core_properties.subject='User guide, use cases, workflows, technical reference and verification'
doc.save(OUT)
print('Saved',OUT,'paragraphs',len(doc.paragraphs),'tables',len(doc.tables),'images',len(doc.inline_shapes))
