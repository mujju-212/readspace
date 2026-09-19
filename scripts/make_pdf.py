#!/usr/bin/env python3
"""Generate public/sample-workspace/papers/readspace-demo.pdf with zero deps."""
import pathlib

PAGES = [
    ("ReadSpace — PDF Viewer Demo", [
        "This three-page document exists to exercise the ReadSpace PDF viewer.",
        "",
        "Things to try with this file open:",
        "  1. Scroll continuously — pages render lazily as they approach view.",
        "  2. Use the zoom controls; 'Fit width' is the default.",
        "  3. Jump pages with the arrows in the toolbar.",
        "  4. Select this text with the mouse — the pdf.js text layer is active.",
        "",
        "The viewer runs pdf.js in a Web Worker, so the UI stays responsive even",
        "for large documents. Pages are rendered at your device pixel ratio.",
    ]),
    ("Page 2 — Typography", [
        "PDF rendering happens on <canvas>, so what you see is exactly what a",
        "print shop would see: embedded fonts, vector shapes and images all",
        "drawn by the browser at full fidelity.",
        "",
        "Readable software should stay out of your way. That is the design brief",
        "for ReadSpace: low chrome, calm colors, and typography you can tune -",
        "font family, size, line height and reading width - from the settings",
        "menu in the title bar.",
        "",
        "Reading is the product; everything else is plumbing.",
    ]),
    ("Page 3 — Session Notes", [
        "Checklist for the v0.1 milestone:",
        "  [x] Open a folder and browse its file tree",
        "  [x] Tabs: preview tabs, pinning, reorder, unsaved indicator",
        "  [x] Viewers: Markdown, PDF, DOCX, HTML, TXT, images",
        "  [x] Preview / Edit toggle with save back to disk",
        "  [x] Resizable sidebar and independent content scrolling",
        "  [x] Light / dark / sepia themes with session restore",
        "",
        "Next up: outline panel, find-in-document, split view and global search.",
        "",
        "                                              - ReadSpace team, Oct 2026",
    ]),
]

PAGE_W, PAGE_H = 612, 792  # US Letter
MARGIN, TITLE_SIZE, BODY_SIZE, LEADING = 72, 20, 11.5, 17


def wrap(line: str, width: int) -> list[str]:
    out, cur = [], ""
    for word in line.split(" "):
        cand = (cur + " " + word).strip()
        if len(cand) * 0.52 > width:
            out.append(cur)
            cur = word
        else:
            cur = cand
    if cur:
        out.append(cur)
    return out or [""]


def esc(s: str) -> str:
    # transliterate to characters the base-14 fonts (latin-1) can show
    table = str.maketrans({
        "\u2014": "--", "\u2013": "-", "\u2018": "'", "\u2019": "'",
        "\u201c": '"', "\u201d": '"', "\u2192": "->", "\u00b7": "-",
        "\u2022": "*", "\u2713": "v", "\u2026": "...",
    })
    s = s.translate(table)
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def content_stream(title: str, lines: list[str]) -> bytes:
    y = PAGE_H - MARGIN - TITLE_SIZE
    parts = [f"BT /F1 {TITLE_SIZE} Tf {MARGIN} {y:.1f} Td ({esc(title)}) Tj ET",
             f"0.4 w {MARGIN} {y - 8:.1f} m {PAGE_W - MARGIN} {y - 8:.1f} l S"]
    y -= LEADING * 2
    for raw in lines:
        for line in (wrap(raw, 84) if raw else [""]):
            if not line:
                y -= LEADING * 0.7
                continue
            parts.append(f"BT /F2 {BODY_SIZE} Tf {MARGIN} {y:.1f} Td ({esc(line)}) Tj ET")
            y -= LEADING
    return ("\n".join(parts)).encode("latin-1")


def build() -> bytes:
    objs: list[bytes] = []
    n = len(PAGES)
    # object ids: 1 catalog, 2 pages, 3 font1, 4 font2,
    # then per page i: page = 5+2i, content = 6+2i
    kids = " ".join(f"{5 + 2 * i} 0 R" for i in range(n))
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {n} >>".encode())
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for i, (title, lines) in enumerate(PAGES):
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
            f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {6 + 2 * i} 0 R >>".encode()
        )
        objs.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content_stream(title, lines)), content_stream(title, lines)))
    # assemble with xref
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0] * (len(objs) + 1)
    for i, obj in enumerate(objs, start=1):
        offsets[i] = len(out)
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref_pos = len(out)
    count = len(objs) + 1
    out += f"xref\n0 {count}\n".encode()
    out += b"0000000000 65535 f \n"
    for i in range(1, count):
        out += f"{offsets[i]:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {count} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode()
    )
    return bytes(out)


if __name__ == "__main__":
    dest = pathlib.Path(__file__).resolve().parents[1] / "public/sample-workspace/papers/readspace-demo.pdf"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(build())
    print(f"wrote {dest} ({dest.stat().st_size} bytes)")
