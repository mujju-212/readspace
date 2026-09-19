#!/usr/bin/env python3
"""Generate public/sample-workspace/papers/sample-report.docx with zero deps.

Minimal but valid OOXML: content types, rels, document.xml, styles.xml with
Heading1/Heading2/Title styles so mammoth maps them to h1/h2.
"""
import pathlib
import zipfile

CT = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>"""

RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>"""

NUMBERING = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0">
  <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>"""

STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>
  <w:rPr><w:b/><w:sz w:val="52"/><w:color w:val="1F3864"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
  <w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>
  <w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="2E5496"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>
  <w:pPr><w:spacing w:before="200" w:after="100"/></w:pPr>
  <w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="2E5496"/></w:rPr></w:style>
</w:styles>"""


def esc(t: str) -> str:
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def p(text="", style=None, bold=False, italic=False, bullet=False):
    parts = ['<w:p>']
    if style or bullet:
        parts.append('<w:pPr>' + (f'<w:pStyle w:val="{style}"/>' if style else '')
                     + ('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' if bullet else '')
                     + '</w:pPr>')
    if text:
        rpr = ''
        if bold or italic:
            rpr = '<w:rPr>' + ('<w:b/>' if bold else '') + ('<w:i/>' if italic else '') + '</w:rPr>'
        parts.append(f'<w:r>{rpr}<w:t xml:space="preserve">{esc(text)}</w:t></w:r>')
    parts.append('</w:p>')
    return ''.join(parts)


def cell(text, bold=False):
    return ('<w:tc><w:tcPr><w:tcW w:w="2800" w:type="dxa"/></w:tcPr>'
            + p(text, bold=bold) + '</w:tc>')


def row(cells):
    return '<w:tr>' + ''.join(cells) + '</w:tr>'


def table(rows_xml):
    return ('<w:tbl><w:tblPr><w:tblBorders>'
            '<w:top w:val="single" w:sz="4" w:color="999999"/><w:left w:val="single" w:sz="4" w:color="999999"/>'
            '<w:bottom w:val="single" w:sz="4" w:color="999999"/><w:right w:val="single" w:sz="4" w:color="999999"/>'
            '<w:insideH w:val="single" w:sz="4" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:color="999999"/>'
            '</w:tblBorders></w:tblPr>' + rows_xml + '</w:tbl>')


body = [
    p("ReadSpace Sample Report", style="Title"),
    p("A Word document rendered by mammoth.js — version 1.0, October 2026", italic=True),
    p(),
    p("1. Purpose", style="Heading1"),
    p("This .docx file exists so you can check the Word viewer inside ReadSpace. "
      "Mammoth converts the document to clean semantic HTML: headings, bold and "
      "italic runs, lists and tables all map to standard elements, then the result "
      "is sanitised and displayed with the reader typography you configured."),
    p(),
    p("2. Formatting checklist", style="Heading1"),
    p("Bold text renders as <strong>.", bold=True),
    p("Italic text renders as <em>.", italic=True),
    p("Bold and italic together work too.", bold=True, italic=True),
    p("First bullet item — mapped to an HTML list", bullet=True),
    p("Second bullet item", bullet=True),
    p("Third bullet item", bullet=True),
    p(),
    p("3. Semester schedule", style="Heading1"),
    table(
        row([cell("Week", bold=True), cell("Milestone", bold=True), cell("Owner", bold=True)])
        + row([cell("1"), cell("Requirements + wireframe"), cell("Mujju")])
        + row([cell("2-3"), cell("Core viewers (MD, PDF, DOCX)"), cell("Mujju")])
        + row([cell("4"), cell("Layout, themes, session restore"), cell("Mujju")])
        + row([cell("5"), cell("Testing, report writing, demo"), cell("Team")])
    ),
    p(),
    p("4. Limitations to mention in the viva", style="Heading2"),
    p("Complex Word features (text boxes, columns, SmartArt) are intentionally "
      "out of scope for v1 — the goal is comfortable reading of semantic content, "
      "not pixel-perfect Word reproduction."),
    p(),
    p("If you can read this comfortably, the DOCX viewer works. ✔", italic=True),
]

DOCUMENT = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    '<w:body>' + ''.join(body) +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
    '</w:body></w:document>'
)

if __name__ == "__main__":
    dest = pathlib.Path(__file__).resolve().parents[1] / "public/sample-workspace/papers/sample-report.docx"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CT)
        z.writestr("_rels/.rels", RELS)
        z.writestr("word/document.xml", DOCUMENT)
        z.writestr("word/_rels/document.xml.rels", DOC_RELS)
        z.writestr("word/styles.xml", STYLES)
        z.writestr("word/numbering.xml", NUMBERING)
    print(f"wrote {dest} ({dest.stat().st_size} bytes)")
