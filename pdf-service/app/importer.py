"""PDF -> editable HTML, keeping as much structure/format as can be recovered:
headings, bold/italic/colour/size, alignment, line spacing, lists, tables and images."""
import base64
import re
from collections import Counter
from html import escape
from statistics import median

import fitz  # PyMuPDF

BULLET_RE = re.compile(r"^\s*([•●▪◦‣⁃·\-–\*])\s+")
NUMBER_RE = re.compile(r"^\s*(\d{1,3}|[a-zA-Z])[.)]\s+")
MARKER_ONLY_RE = re.compile(r"^\s*(?:[•●▪◦‣⁃·\-–\*]|\d{1,3}[.)]|[a-zA-Z][.)])\s*$")
MAX_IMAGE_BYTES = 8 * 1024 * 1024


def _color(c: int) -> str | None:
    if c is None:
        return None
    r, g, b = (c >> 16) & 255, (c >> 8) & 255, c & 255
    if 0.299 * r + 0.587 * g + 0.114 * b < 70:  # near-black is just the default text colour
        return None
    return f"#{c & 0xFFFFFF:06x}"


def _family(font: str) -> str | None:
    f = font.lower()
    if any(k in f for k in ("courier", "mono", "consolas", "menlo")):
        return "'Courier New', monospace"
    if any(k in f for k in ("times", "georgia", "serif", "garamond", "palatino", "cambria", "book")) and "sans" not in f:
        return "'Times New Roman', serif"
    return None


def _is_bold(span: dict) -> bool:
    return bool(span["flags"] & 16) or "bold" in span["font"].lower() or "black" in span["font"].lower()


def _is_italic(span: dict) -> bool:
    return bool(span["flags"] & 2) or "italic" in span["font"].lower() or "oblique" in span["font"].lower()


def _body_size(doc: fitz.Document) -> float:
    sizes: Counter = Counter()
    for page in doc:
        for b in page.get_text("dict")["blocks"]:
            for line in b.get("lines", []):
                for s in line["spans"]:
                    sizes[round(s["size"], 1)] += len(s["text"].strip())
    return sizes.most_common(1)[0][0] if sizes else 11.0


def _span_html(span: dict, body: float, heading: bool) -> str:
    text = escape(span["text"])
    if not text.strip():
        return text
    styles = []
    if not heading and abs(span["size"] - body) / body > 0.08:
        styles.append(f"font-size: {round(span['size'] * 2) / 2:g}pt")
    fam = _family(span["font"])
    if fam:
        styles.append(f"font-family: {fam}")
    col = _color(span["color"])
    if col and col != "#000000":
        styles.append(f"color: {col}")
    if styles:
        text = f'<span style="{"; ".join(styles)}">{text}</span>'
    if _is_bold(span) and not heading:
        text = f"<strong>{text}</strong>"
    if _is_italic(span):
        text = f"<em>{text}</em>"
    return text


def _merge_adjacent(html: str) -> str:
    # <strong>a</strong><strong>b</strong> -> <strong>ab</strong> (same for em)
    for tag in ("strong", "em"):
        html = html.replace(f"</{tag}><{tag}>", "")
    return html


def _line_html(line: dict, body: float, heading: bool) -> str:
    return "".join(_span_html(s, body, heading) for s in line["spans"])


def _line_text(line: dict) -> str:
    return "".join(s["text"] for s in line["spans"])


def _group_lines(lines: list[dict]) -> list[list[dict]]:
    """Split a text block into paragraphs/list items."""
    groups: list[list[dict]] = []
    prev = None
    for ln in lines:
        text = _line_text(ln).strip()
        if not text:
            continue
        size = max(s["size"] for s in ln["spans"])
        starts_item = bool(BULLET_RE.match(text) or NUMBER_RE.match(text))
        gap_break = prev is not None and (ln["bbox"][1] - prev["bbox"][3]) > size * 1.8
        if prev is None or starts_item or gap_break:
            groups.append([ln])
        else:
            groups[-1].append(ln)
        prev = ln
    return groups


def _join(lines: list[dict], body: float, heading: bool) -> str:
    out = ""
    for i, ln in enumerate(lines):
        h = _line_html(ln, body, heading)
        t = _line_text(ln).rstrip()
        if i < len(lines) - 1:
            nxt = _line_text(lines[i + 1]).lstrip()
            if t.endswith("-") and nxt[:1].islower():  # re-join hyphenated words
                h = re.sub(r"-(</[a-z]+>)*\s*$", lambda m: m.group(0)[1:], h)
                out += h
                continue
            h += " "
        out += h
    return _merge_adjacent(out.strip())


def _line_height(lines: list[dict], size: float) -> float | None:
    if len(lines) < 2:
        return None
    gaps = [b["bbox"][3] - a["bbox"][3] for a, b in zip(lines, lines[1:]) if b["bbox"][3] > a["bbox"][3]]
    if not gaps:
        return None
    ratio = median(gaps) / size
    return round(min(max(ratio, 1.0), 2.5), 2)


def _repeated_margins(doc: fitz.Document) -> set[str]:
    """Running headers/footers: same text (digits normalised) in the page margins of many pages."""
    if doc.page_count < 3:
        return set()
    seen: Counter = Counter()
    for page in doc:
        h = page.rect.height
        keys = set()
        for b in page.get_text("blocks"):
            if b[6] != 0:
                continue
            if b[3] < h * 0.09 or b[1] > h * 0.91:
                keys.add(re.sub(r"\d+", "#", b[4].strip())[:80])
        seen.update(keys)
    return {k for k, n in seen.items() if k and n >= max(3, doc.page_count * 0.5)}


def _table_html(rows: list[list[str | None]]) -> str:
    def cell(tag: str, v: str | None) -> str:
        return f"<{tag}><p>{escape(v or '').replace(chr(10), ' ')}</p></{tag}>"

    body = []
    for i, row in enumerate(rows):
        tag = "th" if i == 0 else "td"
        body.append("<tr>" + "".join(cell(tag, c) for c in row) + "</tr>")
    return "<table><tbody>" + "".join(body) + "</tbody></table>"


def pdf_to_html(data: bytes) -> dict:
    doc = fitz.open(stream=data, filetype="pdf")
    if doc.needs_pass:
        raise ValueError("el PDF está protegido con contraseña")
    body = _body_size(doc)
    running = _repeated_margins(doc)
    warnings: list[str] = []
    parts: list[str] = []
    title = (doc.metadata or {}).get("title", "").strip()
    first_heading = ""
    list_kind: str | None = None  # currently open list: 'ul' | 'ol'
    list_items: list[str] = []
    text_chars = 0

    def flush_list():
        nonlocal list_kind, list_items
        if list_kind:
            parts.append(f"<{list_kind}>" + "".join(f"<li><p>{i}</p></li>" for i in list_items) + f"</{list_kind}>")
        list_kind, list_items = None, []

    for page in doc:
        pw = page.rect.width
        d = page.get_text("dict", sort=True)
        tables = []
        try:
            tables = list(page.find_tables().tables)
        except Exception:
            pass
        text_blocks = [b for b in d["blocks"] if b["type"] == 0 and b.get("lines")]
        left = min((b["bbox"][0] for b in text_blocks), default=0)
        right = max((b["bbox"][2] for b in text_blocks), default=pw)

        pending_marker: str | None = None
        items: list[tuple] = []  # (y, x, html, kind, meta)
        for t in tables:
            try:
                rows = t.extract()
                if rows and len(rows) >= 1 and len(rows[0]) >= 2:
                    items.append((t.bbox[1], t.bbox[0], _table_html(rows), "table", None))
            except Exception:
                continue
        tbboxes = [fitz.Rect(t.bbox) for t in tables]

        for b in d["blocks"]:
            x0, y0, x1, y1 = b["bbox"]
            center = fitz.Point((x0 + x1) / 2, (y0 + y1) / 2)
            if any(r.contains(center) for r in tbboxes) and b["type"] == 0:
                continue
            if b["type"] == 1:
                if len(b["image"]) > MAX_IMAGE_BYTES or (x1 - x0) < 12 or (y1 - y0) < 12:
                    continue
                ext = b["ext"] if b["ext"] in ("png", "jpeg", "jpg", "gif", "webp") else None
                raw = b["image"]
                if not ext:
                    try:
                        raw = fitz.Pixmap(raw).tobytes("png")
                        ext = "png"
                    except Exception:
                        continue
                mime = "jpeg" if ext == "jpg" else ext
                uri = f"data:image/{mime};base64,{base64.b64encode(raw).decode()}"
                align = "center" if abs(center.x - pw / 2) < pw * 0.03 else ""
                style = f' style="text-align: {align}"' if align else ""
                items.append((y0, x0, f'<p{style}><img src="{uri}" width="{round((x1 - x0) * 1.333)}"></p>', "img", None))
                continue

            key = re.sub(r"\d+", "#", " ".join(_line_text(ln) for ln in b["lines"]).strip())[:80]
            if key in running:
                continue
            for group in _group_lines(b["lines"]):
                text = " ".join(_line_text(ln).strip() for ln in group).strip()
                if MARKER_ONLY_RE.match(text):  # bullet drawn as its own block: it belongs to the next one
                    pending_marker = "ol" if text[:1].isalnum() else "ul"
                    continue
                text_chars += len(text)
                size = max(s["size"] for ln in group for s in ln["spans"])
                bold_all = all(_is_bold(s) for ln in group for s in ln["spans"] if s["text"].strip())
                ratio = size / body
                gx0 = min(ln["bbox"][0] for ln in group)
                gx1 = max(ln["bbox"][2] for ln in group)
                is_heading = len(text) < 220 and len(group) <= 3 and (ratio >= 1.15 or (bold_all and ratio >= 1.0 and len(group) == 1 and len(text) < 90 and gx0 - left < 6 and not BULLET_RE.match(text)))
                bm, nm = BULLET_RE.match(text), NUMBER_RE.match(text)
                kind = "ul" if bm else "ol" if nm else pending_marker
                if pending_marker:
                    pending_marker, is_heading = None, False
                if kind:
                    # strip the marker from the first line's first span
                    first = group[0]["spans"][0]
                    first["text"] = (BULLET_RE if bm else NUMBER_RE).sub("", first["text"], count=1)
                html = _join(group, body, is_heading)
                if not html:
                    continue
                if is_heading:
                    level = 1 if ratio >= 1.7 else 2 if ratio >= 1.35 else 3
                    if not first_heading:
                        first_heading = text
                    items.append((y0, x0, f"<h{level}{_align(gx0, gx1, left, right, pw, len(group))}>{html}</h{level}>", None, None))
                elif kind:
                    items.append((y0, x0, html, kind, None))
                else:
                    meta = {"lines": list(group), "html": html, "size": size, "gx0": gx0, "gx1": gx1, "y1": max(ln["bbox"][3] for ln in group)}
                    items.append((y0, x0, "", "p", meta))

        items.sort(key=lambda i: (round(i[0] / 2), i[1]))
        items = _merge_wrapped(items, left, right)
        for _, _, html, kind, meta in items:
            if kind == "p":
                lh = _line_height(meta["lines"], meta["size"])
                html = f"<p{_align_style(meta['gx0'], meta['gx1'], left, right, pw, meta['lines'], lh)}>{meta['html']}</p>"
            if kind in ("ul", "ol"):
                if list_kind != kind:
                    flush_list()
                    list_kind = kind
                list_items.append(html)
            else:
                flush_list()
                parts.append(html)
        flush_list()

    if text_chars < 20:
        warnings.append("El PDF parece escaneado o sin texto seleccionable: se importaron solo las imágenes de las páginas.")
    if any(len(p.get_drawings()) > 150 for p in doc):
        warnings.append("Algunos gráficos vectoriales (diagramas, gráficas) no se pueden importar como imagen editable.")
    warnings.append("Revisa el resultado: el diseño de maquetación compleja (columnas, cuadros de texto) puede variar respecto al PDF original.")

    return {
        "html": "\n".join(parts) or "<p></p>",
        "title": title or first_heading[:120],
        "pages": doc.page_count,
        "warnings": warnings,
    }


def _merge_wrapped(items: list[tuple], left: float, right: float) -> list[tuple]:
    """Some PDFs (wide line spacing) emit every line as its own block: glue back lines of a wrapped paragraph."""
    out: list[tuple] = []
    width = right - left
    for it in items:
        if out and it[3] == "p" and out[-1][3] == "p":
            a, b = out[-1][4], it[4]
            wrapped = a["gx1"] >= right - width * 0.08 and abs(a["gx0"] - b["gx0"]) < 4
            close = 0 <= b["lines"][0]["bbox"][1] - a["y1"] < a["size"] * 1.4
            if wrapped and close and abs(a["size"] - b["size"]) < 0.5:
                a["lines"] += b["lines"]
                a["html"] += " " + b["html"]
                a["gx1"] = max(a["gx1"], b["gx1"])
                a["y1"] = b["y1"]
                continue
        out.append(it)
    return out


def _align_name(x0: float, x1: float, left: float, right: float, pw: float, lines: int, justified: bool) -> str | None:
    width = right - left
    if width <= 0:
        return None
    mid_off = abs((x0 + x1) / 2 - (left + right) / 2)
    if mid_off < width * 0.03 and (x0 - left) > width * 0.06 and (right - x1) > width * 0.06:
        return "center"
    if (right - x1) < width * 0.02 and (x0 - left) > width * 0.25:
        return "right"
    if justified:
        return "justify"
    return None


def _align(x0, x1, left, right, pw, lines) -> str:
    a = _align_name(x0, x1, left, right, pw, lines, False)
    return f' style="text-align: {a}"' if a else ""


def _align_style(x0, x1, left, right, pw, group, lh) -> str:
    justified = len(group) >= 3 and sum(1 for ln in group[:-1] if right - ln["bbox"][2] < (right - left) * 0.015) >= len(group[:-1]) * 0.8
    a = _align_name(x0, x1, left, right, pw, len(group), justified)
    styles = []
    if a:
        styles.append(f"text-align: {a}")
    if lh and abs(lh - 1.5) > 0.08:
        styles.append(f"line-height: {lh}")
    return f' style="{"; ".join(styles)}"' if styles else ""
