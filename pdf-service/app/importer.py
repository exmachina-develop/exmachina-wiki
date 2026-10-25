"""PDF -> editable HTML, keeping as much of the original look as can be recovered:
exact font sizes / colours / bold / italic per run, headings, alignment, line spacing, lists,
tables (with cell styles), coloured cards & banners (as shaded table cells, side-by-side layouts as rows),
highlighted "pills", embedded images, and page size / orientation / margins.
Pages that are mostly vector diagrams (org charts, charts) are inserted as an image of the page."""
import base64
import re
from collections import Counter
from html import escape
from statistics import median

import fitz  # PyMuPDF

BULLET_RE = re.compile(r"^\s*([•●▪◦‣⁃·\-–\*])\s+")
NUMBER_RE = re.compile(r"^\s*(\d{1,3}|[a-zA-Z])[.)]\s+")
MARKER_ONLY_RE = re.compile(r"^\s*(?:[•●▪◦‣⁃·\-–\*]|\d{1,3}[.)]|[a-zA-Z][.)])\s*$")
PAGE_NUM_RE = re.compile(r"^(?:p[aá]g(?:ina)?\.?\s*)?\d{1,4}(?:\s*(?:/|de|of)\s*\d{1,4})?$", re.I)
MAX_IMAGE_BYTES = 8 * 1024 * 1024
PX = 96 / 72  # pt -> css px


# ----------------------------------------------------------------------------- spans
def _rgb(c: int) -> tuple[int, int, int]:
    return (c >> 16) & 255, (c >> 8) & 255, c & 255


def _color(c: int | None) -> str | None:
    if c is None:
        return None
    r, g, b = _rgb(c)
    if 0.299 * r + 0.587 * g + 0.114 * b < 70:  # near-black is just the default text colour
        return None
    return f"#{c & 0xFFFFFF:06x}"


def _family(font: str) -> str | None:
    f = font.lower()
    if any(k in f for k in ("courier", "mono", "consolas", "menlo")):
        return "'Courier New', monospace"
    if any(k in f for k in ("times", "georgia", "serif", "garamond", "palatino", "cambria", "book")) and "sans" not in f:
        return "'Times New Roman', serif"
    if any(k in f for k in ("arial", "helvetica")):
        return "Arial, sans-serif"
    return None


def _is_bold(span: dict) -> bool:
    n = span["font"].lower()
    return bool(span["flags"] & 16) or "bold" in n or "black" in n


def _is_italic(span: dict) -> bool:
    n = span["font"].lower()
    return bool(span["flags"] & 2) or "italic" in n or "oblique" in n


def _hex(rgb: tuple[float, float, float]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*(round(max(0, min(1, v)) * 255) for v in rgb))


class Ctx:
    """Per-page drawing info: shaded rectangles used for cards/banners and pills."""

    def __init__(self, page: fitz.Page, body: float):
        self.page = page
        self.body = body
        self.pw, self.ph = page.rect.width, page.rect.height
        self.fills: list[tuple[fitz.Rect, str]] = []
        self.dots: list[tuple[float, float]] = []
        self.hlines: list[tuple[fitz.Rect, str]] = []
        self.drawings = 0
        self.strokes = 0
        try:
            drawings = page.get_drawings()
        except Exception:
            drawings = []
        self.drawings = len(drawings)
        seen = set()
        for d in drawings:
            r = d["rect"]
            fill = d.get("fill")
            if fill is None:
                if r.width < 2 or r.height < 2:
                    self.strokes += 1
                continue
            op = d.get("fill_opacity")
            op = 1.0 if op is None else op
            fill = tuple(1 - op * (1 - v) for v in fill)  # effective colour over white paper
            if min(fill) >= 0.965:
                continue  # white / fully transparent: that is just paper
            if 1.5 <= r.width <= 7 and abs(r.width - r.height) < 1.5:  # vector bullet
                self.dots.append(((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2))
                continue
            if r.height < 2 and r.width >= 25:  # thin horizontal rule (table row border)
                self.hlines.append((fitz.Rect(r), _hex(fill)))
                continue
            if r.width < 3 or r.height < 3 or r.width * r.height > self.pw * self.ph * 0.92:
                continue
            key = (round(r.x0), round(r.y0), round(r.x1), round(r.y1), tuple(round(v, 2) for v in fill))
            if key in seen:
                continue
            seen.add(key)
            self.fills.append((fitz.Rect(r), _hex(fill)))
        area = self.pw * self.ph
        # cards/banners vs. pills (small highlighted labels)
        self.containers = [(r, c) for r, c in self.fills if r.width * r.height >= area * 0.012 and min(r.width, r.height) >= 24 and r.width >= self.pw * 0.12]
        self.pills = [(r, c) for r, c in self.fills if (r.width * r.height < area * 0.012 or min(r.width, r.height) < 24) and 8 <= r.height <= 34 and r.width <= self.pw * 0.45]

    def has_dot(self, gx0: float, y0: float, y1: float) -> bool:
        return any(gx0 - 16 <= cx <= gx0 - 0.5 and y0 - 3 <= cy <= y1 + 3 for cx, cy in self.dots)

    def is_diagram(self) -> bool:
        return self.drawings > 90 or (len(self.containers) >= 6 and self.strokes >= 4) or (len(self.pills) >= 12 and self.strokes >= 4 and len(self.containers) >= 3)

    def pill_for(self, bbox) -> str | None:
        cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
        best = None
        for r, c in self.pills:
            if r.x0 - 1 <= cx <= r.x1 + 1 and r.y0 - 1 <= cy <= r.y1 + 1 and (best is None or r.width * r.height < best[0]):
                best = (r.width * r.height, c)
        return best[1] if best else None

    def container_for(self, cx: float, cy: float):
        best = None
        for i, (r, c) in enumerate(self.containers):
            if r.x0 - 1 <= cx <= r.x1 + 1 and r.y0 - 1 <= cy <= r.y1 + 1 and (best is None or r.width * r.height < best[1]):
                best = (i, r.width * r.height)
        return best[0] if best else None


def _style_key(span: dict, ctx: Ctx, heading: bool):
    return (
        round(span["size"] * 2) / 2,
        _color(span["color"]),
        _family(span["font"]),
        _is_bold(span) and not heading,
        _is_italic(span),
        ctx.pill_for(span["bbox"]),
    )


def _render_runs(runs: list[tuple[tuple, str]]) -> str:
    out = []
    for (size, col, fam, bold, ital, pill), text in runs:
        t = escape(text)
        if not t.strip():
            out.append(t)
            continue
        styles = [f"font-size: {size:g}pt"]
        if fam:
            styles.append(f"font-family: {fam}")
        if col:
            styles.append(f"color: {col}")
        t = f'<span style="{"; ".join(styles)}">{t}</span>'
        if bold:
            t = f"<strong>{t}</strong>"
        if ital:
            t = f"<em>{t}</em>"
        if pill:
            t = f'<mark style="background-color: {pill}">{t}</mark>'
        out.append(t)
    return "".join(out)


def _line_runs(line: dict, ctx: Ctx, heading: bool) -> list[tuple[tuple, str]]:
    runs: list[tuple[tuple, str]] = []
    for s in line["spans"]:
        if not s["text"]:
            continue
        k = _style_key(s, ctx, heading)
        if not s["text"].strip() and runs:
            k = runs[-1][0]  # whitespace takes the style of its neighbour so runs merge
        if runs and runs[-1][0] == k:
            runs[-1] = (k, runs[-1][1] + s["text"])
        else:
            runs.append((k, s["text"]))
    return runs


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


def _join(lines: list[dict], ctx: Ctx, heading: bool) -> str:
    runs: list[tuple[tuple, str]] = []
    for i, ln in enumerate(lines):
        lr = _line_runs(ln, ctx, heading)
        if not lr:
            continue
        if i < len(lines) - 1:
            t = _line_text(ln).rstrip()
            nxt = _line_text(lines[i + 1]).lstrip()
            k, txt = lr[-1]
            if t.endswith("-") and nxt[:1].islower():  # re-join hyphenated words
                lr[-1] = (k, txt.rstrip()[:-1])
            else:
                lr[-1] = (k, txt.rstrip() + " ")
        for k, txt in lr:
            if runs and runs[-1][0] == k:
                runs[-1] = (k, runs[-1][1] + txt)
            else:
                runs.append((k, txt))
    return _render_runs(runs).strip()


def _line_height(lines: list[dict], size: float) -> float | None:
    if len(lines) < 2:
        return None
    gaps = [b["bbox"][3] - a["bbox"][3] for a, b in zip(lines, lines[1:]) if b["bbox"][3] > a["bbox"][3]]
    if not gaps:
        return None
    return round(min(max(median(gaps) / size, 1.0), 2.5), 2)


def _align_name(x0: float, x1: float, left: float, right: float, justified: bool) -> str | None:
    width = right - left
    if width <= 0:
        return None
    if abs((x0 + x1) / 2 - (left + right) / 2) < width * 0.03 and (x0 - left) > width * 0.06 and (right - x1) > width * 0.06:
        return "center"
    if (right - x1) < width * 0.02 and (x0 - left) > width * 0.25:
        return "right"
    return "justify" if justified else None


def _p_style(meta: dict, left: float, right: float) -> str:
    lines = meta["lines"]
    justified = len(lines) >= 3 and sum(1 for ln in lines[:-1] if right - ln["bbox"][2] < (right - left) * 0.015) >= len(lines[:-1]) * 0.8
    a = _align_name(meta["gx0"], meta["gx1"], left, right, justified)
    lh = _line_height(lines, meta["size"])
    st = []
    if a:
        st.append(f"text-align: {a}")
    if lh and abs(lh - 1.5) > 0.08:
        st.append(f"line-height: {lh}")
    return f' style="{"; ".join(st)}"' if st else ""


# ----------------------------------------------------------------------------- items
def _split_columns(blocks: list[dict]) -> list[dict]:
    """PDF blocks sometimes interleave several columns (label | description) that share baselines.
    Split such blocks into one pseudo-block per column so each column becomes its own item."""
    out: list[dict] = []
    for b in blocks:
        if b["type"] != 0 or not b.get("lines"):
            out.append(b)
            continue
        # 1) break every line into segments at wide horizontal gaps
        pseudo: list[dict] = []
        for ln in b["lines"]:
            segs: list[list[dict]] = []
            last_x1 = None  # right edge of the last visible (non-blank) span
            for sp in ln["spans"]:
                if not sp["text"]:
                    continue
                visible = bool(sp["text"].strip())
                if segs and visible and last_x1 is not None and sp["bbox"][0] - last_x1 > max(10, sp["size"] * 1.4):
                    segs.append([sp])
                else:
                    if not segs:
                        segs.append([])
                    segs[-1].append(sp)
                if visible:
                    last_x1 = sp["bbox"][2]
            for seg in segs:
                if not "".join(s["text"] for s in seg).strip():
                    continue
                bx = [s["bbox"] for s in seg]
                pseudo.append({"bbox": (min(v[0] for v in bx), min(v[1] for v in bx), max(v[2] for v in bx), max(v[3] for v in bx)),
                               "spans": seg, "dir": ln.get("dir", (1, 0)), "wmode": 0})
        # 2) cluster by left edge
        columns: list[dict] = []
        for pl in pseudo:
            col = next((c for c in columns if abs(c["x0"] - pl["bbox"][0]) < 12), None)
            if col is None:
                col = {"x0": pl["bbox"][0], "lines": []}
                columns.append(col)
            col["lines"].append(pl)
        # 3) real columns only if lines of different clusters overlap vertically
        def overlap(a, b2):
            ov = min(a["bbox"][3], b2["bbox"][3]) - max(a["bbox"][1], b2["bbox"][1])
            return ov > 0.4 * min(a["bbox"][3] - a["bbox"][1], b2["bbox"][3] - b2["bbox"][1])

        multi = len(columns) > 1 and any(overlap(x, y) for i, c1 in enumerate(columns) for c2 in columns[i + 1:] for x in c1["lines"] for y in c2["lines"])
        if not multi:
            out.append(b)
            continue
        for c in columns:
            ls = c["lines"]
            out.append({"type": 0, "number": b.get("number", 0), "lines": ls,
                        "bbox": (min(l["bbox"][0] for l in ls), min(l["bbox"][1] for l in ls), max(l["bbox"][2] for l in ls), max(l["bbox"][3] for l in ls))})
    return out


def _text_items(blocks: list[dict], ctx: Ctx, running: set[str], first_heading: list[str], stats: dict) -> list[dict]:
    items: list[dict] = []
    pending: str | None = None
    body = ctx.body
    for b in _split_columns(blocks):
        if b["type"] != 0 or not b.get("lines"):
            continue
        x0, y0, x1, y1 = b["bbox"]
        raw = " ".join(_line_text(ln) for ln in b["lines"]).strip()
        if re.sub(r"\d+", "#", raw)[:80] in running:
            continue
        if PAGE_NUM_RE.match(raw) and (y1 < ctx.ph * 0.09 or y0 > ctx.ph * 0.91):
            continue  # stray page number in the margin
        for group in _group_lines(b["lines"]):
            text = " ".join(_line_text(ln).strip() for ln in group).strip()
            if MARKER_ONLY_RE.match(text):  # bullet drawn as its own block: belongs to the next one
                pending = "ol" if text[:1].isalnum() else "ul"
                continue
            stats["chars"] += len(text)
            by_size: Counter = Counter()
            for ln in group:
                for sp in ln["spans"]:
                    by_size[round(sp["size"], 1)] += len(sp["text"].strip())
            size = by_size.most_common(1)[0][0] if by_size else body
            bold_all = all(_is_bold(s) for ln in group for s in ln["spans"] if s["text"].strip())
            ratio = size / body
            gx0, gx1 = min(ln["bbox"][0] for ln in group), max(ln["bbox"][2] for ln in group)
            gy0, gy1 = min(ln["bbox"][1] for ln in group), max(ln["bbox"][3] for ln in group)
            bm, nm = BULLET_RE.match(text), NUMBER_RE.match(text)
            kind = "ul" if bm else "ol" if nm else pending
            if not kind and ctx.has_dot(gx0, gy0, group[0]["bbox"][3]):
                kind = "ul"
            is_heading = (not kind) and bold_all and len(text) < 160 and len(group) <= 3 and ratio >= 1.12
            pending = None
            if bm or nm:
                first = group[0]["spans"][0]
                first["text"] = (BULLET_RE if bm else NUMBER_RE).sub("", first["text"], count=1)
            html = _join(group, ctx, is_heading)
            if not html:
                continue
            it = {"y0": gy0, "y1": gy1, "x0": gx0, "x1": gx1}
            if is_heading:
                level = 1 if ratio >= 1.7 else 2 if ratio >= 1.35 else 3
                first_heading[0] = first_heading[0] or text
                it |= {"kind": "h", "meta": {"level": level, "html": html, "gx0": gx0, "gx1": gx1}}
            elif kind:
                it |= {"kind": kind, "html": html}
            else:
                it |= {"kind": "p", "meta": {"lines": list(group), "html": html, "size": size, "gx0": gx0, "gx1": gx1}}
            items.append(it)
    return items


def _merge_wrapped(items: list[dict], left: float, right: float) -> list[dict]:
    """Glue back lines of a wrapped paragraph that some PDFs emit as separate blocks."""
    out: list[dict] = []
    width = right - left
    for it in items:
        if out and it["kind"] == "p" and out[-1]["kind"] == "p":
            a, b = out[-1]["meta"], it["meta"]
            wrapped = a["gx1"] >= right - width * 0.08 and abs(a["gx0"] - b["gx0"]) < 4
            if not wrapped and abs(a["gx0"] - b["gx0"]) < 4:
                # continuation: previous line is unfinished and the next starts in lowercase
                prev_t, next_t = _line_text(a["lines"][-1]).rstrip(), _line_text(b["lines"][0]).lstrip()
                wrapped = bool(prev_t) and prev_t[-1] not in ".:;?!" and next_t[:1].islower() and 0 <= b["lines"][0]["bbox"][1] - out[-1]["y1"] < a["size"] * 0.9
            close = 0 <= b["lines"][0]["bbox"][1] - out[-1]["y1"] < a["size"] * 1.4
            if wrapped and close and abs(a["size"] - b["size"]) < 0.5:
                a["lines"] += b["lines"]
                a["html"] += " " + b["html"]
                a["gx1"] = max(a["gx1"], b["gx1"])
                out[-1]["y1"] = it["y1"]
                out[-1]["x1"] = max(out[-1]["x1"], it["x1"])
                continue
        out.append(it)
    return out


def _assemble(items: list[dict], left: float, right: float) -> str:
    items = sorted(items, key=lambda i: (round(i["y0"] / 2), i["x0"]))
    items = _merge_wrapped(items, left, right)
    parts: list[str] = []
    cur: str | None = None
    buf: list[str] = []

    def flush():
        nonlocal cur, buf
        if cur:
            parts.append(f"<{cur}>" + "".join(f"<li><p>{h}</p></li>" for h in buf) + f"</{cur}>")
        cur, buf = None, []

    for it in items:
        k = it["kind"]
        if k in ("ul", "ol"):
            if cur != k:
                flush()
                cur = k
            buf.append(it["html"])
            continue
        flush()
        if k == "p":
            parts.append(f"<p{_p_style(it['meta'], left, right)}>{it['meta']['html']}</p>")
        elif k == "h":
            m = it["meta"]
            a = _align_name(m["gx0"], m["gx1"], left, right, False)
            style = f' style="text-align: {a}"' if a else ""
            parts.append(f"<h{m['level']}{style}>{m['html']}</h{m['level']}>")
        else:  # table / img / raw html
            parts.append(it["html"])
    flush()
    return "".join(parts)


def _cell_html(page: fitz.Page, rect: fitz.Rect, ctx: Ctx, first_heading: list[str], stats: dict, pad: float = 0) -> str:
    clip = fitz.Rect(rect.x0 + pad, rect.y0, rect.x1 - pad, rect.y1)
    blocks = page.get_text("dict", clip=clip, sort=True)["blocks"]
    items = _text_items(blocks, ctx, set(), first_heading, stats)
    return _assemble(items, clip.x0, clip.x1) or "<p></p>"


def _table_html(t, page: fitz.Page, ctx: Ctx, first_heading: list[str], stats: dict) -> str:
    rows_html = []
    for row in t.rows:
        cells = []
        for bbox in row.cells:
            if bbox is None:
                cells.append("<td><p></p></td>")
                continue
            r = fitz.Rect(bbox)
            inner = _cell_html(page, r, ctx, first_heading, stats, pad=2)
            bg = None
            cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
            for fr, fc in ctx.fills:
                if fr.x0 - 1 <= cx <= fr.x1 + 1 and fr.y0 - 1 <= cy <= fr.y1 + 1 and fr.width * fr.height < ctx.pw * ctx.ph * 0.5:
                    bg = fc
            style = f' style="background-color: {bg}"' if bg else ""
            cells.append(f'<td colwidth="{round(r.width * PX)}"{style}>{inner}</td>')
        rows_html.append("<tr>" + "".join(cells) + "</tr>")
    return "<table><tbody>" + "".join(rows_html) + "</tbody></table>"


def _ruled_tables(ctx: Ctx) -> list[dict]:
    """Tables drawn with thin horizontal rules (one segment per column) instead of text-bearing grid lines."""
    by_y: dict[int, list[tuple[fitz.Rect, str]]] = {}
    for r, c in ctx.hlines:
        by_y.setdefault(round(r.y0 / 2), []).append((r, c))
    levels = []
    for k in sorted(by_y):
        segs = sorted(by_y[k], key=lambda t: t[0].x0)
        levels.append({"y": sum(s[0].y0 for s in segs) / len(segs), "segs": segs, "key": tuple((round(s[0].x0 / 4), round(s[0].x1 / 4)) for s in segs), "color": segs[0][1]})
    tables, cur = [], []
    for lv in levels:
        if cur and lv["key"] == cur[-1]["key"] and lv["y"] - cur[-1]["y"] < 110:
            cur.append(lv)
        else:
            if len(cur) >= 2:
                tables.append(cur)
            cur = [lv]
    if len(cur) >= 2:
        tables.append(cur)
    out = []
    for lvls in tables:
        ys = [lv["y"] for lv in lvls]
        pitch = median([b - a for a, b in zip(ys, ys[1:])])
        cols = [(s[0].x0, s[0].x1) for s in lvls[0]["segs"]]
        if not (1 <= len(cols) <= 6) or min(b - a for a, b in cols) < 40:
            continue  # not a real table (dashed rules, decorations)
        out.append({"ys": ys, "pitch": pitch, "cols": cols, "color": lvls[0]["color"]})
    return out


def _ruled_table_items(rt: dict, items: list[dict]) -> tuple[dict | None, list[dict]]:
    """Build one table item from the free items falling inside a ruled table; returns (table_item, consumed_items)."""
    ys, pitch, cols = rt["ys"], rt["pitch"], rt["cols"]
    bands = [(ys[i], ys[i + 1]) for i in range(len(ys) - 1)] + [(ys[-1], ys[-1] + pitch)]
    top = (ys[0] - pitch, ys[0])
    x0, x1 = cols[0][0] - 6, cols[-1][1] + 6

    def col_of(it):
        cx = it["cx"]
        best = min(range(len(cols)), key=lambda i: 0 if cols[i][0] - 6 <= cx <= cols[i][1] + 6 else min(abs(cx - cols[i][0]), abs(cx - cols[i][1])))
        return best

    inside = [it for it in items if x0 <= it["cx"] <= x1 and top[0] <= it["cy"] <= bands[-1][1] and it["kind"] in ("p", "h", "ul", "ol", "img")]
    head = [it for it in inside if top[0] <= it["cy"] < top[1]]
    if len({col_of(it) for it in head}) >= 2:
        bands = [top] + bands  # a header row sits above the first rule
    else:
        inside = [it for it in inside if it["cy"] >= ys[0] - 1]
    if not inside:
        return None, []
    grid = [[[] for _ in cols] for _ in bands]
    for it in inside:
        for bi, (a, b) in enumerate(bands):
            if a - 1 <= it["cy"] < b - 1 or (bi == len(bands) - 1 and it["cy"] >= a - 1):
                grid[bi][col_of(it)].append(it)
                break
    rows = []
    for bi, row in enumerate(grid):
        if not any(row):
            continue
        tds = []
        for ci, cell in enumerate(row):
            html = _assemble(cell, cols[ci][0], cols[ci][1]) if cell else "<p></p>"
            tds.append(f'<td colwidth="{round((cols[ci][1] - cols[ci][0]) * PX)}" style="border: none; border-bottom: 1px solid {rt["color"]}; padding: 5pt 8pt 5pt 0">{html}</td>')
        rows.append("<tr>" + "".join(tds) + "</tr>")
    y0 = min(it["y0"] for it in inside)
    y1 = max(it["y1"] for it in inside)
    return {"kind": "table", "y0": y0, "y1": y1, "x0": cols[0][0], "x1": cols[-1][1], "cx": (cols[0][0] + cols[-1][1]) / 2, "cy": (y0 + y1) / 2,
            "html": "<table><tbody>" + "".join(rows) + "</tbody></table>"}, inside


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
                keys.add(re.sub(r"\d+", "#", b[4].strip().replace("\n", " "))[:80])
        seen.update(keys)
    return {k for k, n in seen.items() if k and n >= max(3, doc.page_count * 0.5)}


def _body_size(doc: fitz.Document) -> float:
    sizes: Counter = Counter()
    for page in doc:
        for b in page.get_text("dict")["blocks"]:
            for line in b.get("lines", []):
                for s in line["spans"]:
                    sizes[round(s["size"], 1)] += len(s["text"].strip())
    return sizes.most_common(1)[0][0] if sizes else 11.0


def _page_settings(doc: fitz.Document, left_margin_pt: float) -> dict:
    w, h = doc[0].rect.width, doc[0].rect.height
    lo, hi = sorted((w, h))
    size = "Letter" if abs(lo - 612) < 12 and abs(hi - 792) < 12 else "A4"
    margin = round(min(max(left_margin_pt * 25.4 / 72, 8), 30))
    return {"size": size, "orientation": "landscape" if w > h else "portrait", "margin": margin}


# ----------------------------------------------------------------------------- page conversion
def _page_image(page: fitz.Page, content_px: float) -> str:
    pix = page.get_pixmap(dpi=150, alpha=False)
    uri = "data:image/png;base64," + base64.b64encode(pix.tobytes("png")).decode()
    return f'<p style="text-align: center"><img src="{uri}" width="{round(content_px)}"></p>'


def _convert_page(page: fitz.Page, body: float, running: set[str], first_heading: list[str], stats: dict, content_px: float) -> str:
    ctx = Ctx(page, body)
    if ctx.is_diagram():
        stats["diagram_pages"] += 1
        for b in page.get_text("dict")["blocks"]:  # keep a title candidate even though the page becomes an image
            if b["type"] == 0 and not first_heading[0] and b.get("lines"):
                t = " ".join(_line_text(ln) for ln in b["lines"]).strip()
                if 3 < len(t) < 120:
                    first_heading[0] = t
        return _page_image(page, content_px)

    d = page.get_text("dict", sort=True)
    pw = ctx.pw
    text_blocks = [b for b in d["blocks"] if b["type"] == 0 and b.get("lines")]
    left = min((b["bbox"][0] for b in text_blocks), default=0)
    right = max((b["bbox"][2] for b in text_blocks), default=pw)

    tables = []
    try:
        tables = [t for t in page.find_tables().tables if len(t.rows) >= 2 and len(t.rows[0].cells) >= 2]
    except Exception:
        pass
    tboxes = [fitz.Rect(t.bbox) for t in tables]

    blocks = []
    items: list[dict] = []
    for b in d["blocks"]:
        x0, y0, x1, y1 = b["bbox"]
        center = fitz.Point((x0 + x1) / 2, (y0 + y1) / 2)
        if b["type"] == 0:
            if any(r.contains(center) for r in tboxes):
                continue
            blocks.append(b)
            continue
        if len(b["image"]) > MAX_IMAGE_BYTES or (x1 - x0) < 12 or (y1 - y0) < 12:
            continue
        ext = b["ext"] if b["ext"] in ("png", "jpeg", "jpg", "gif", "webp") else None
        raw = b["image"]
        if not ext:
            try:
                raw, ext = fitz.Pixmap(raw).tobytes("png"), "png"
            except Exception:
                continue
        uri = f"data:image/{'jpeg' if ext == 'jpg' else ext};base64,{base64.b64encode(raw).decode()}"
        items.append({"kind": "img", "y0": y0, "y1": y1, "x0": x0, "x1": x1, "cx": center.x, "cy": center.y,
                      "html": f'<p><img src="{uri}" width="{round((x1 - x0) * PX)}"></p>'})

    for it in _text_items(blocks, ctx, running, first_heading, stats):
        it["cx"], it["cy"] = (it["x0"] + it["x1"]) / 2, (it["y0"] + it["y1"]) / 2
        items.append(it)
    for t in tables:
        r = fitz.Rect(t.bbox)
        try:
            items.append({"kind": "table", "y0": r.y0, "y1": r.y1, "x0": r.x0, "x1": r.x1, "cx": (r.x0 + r.x1) / 2, "cy": (r.y0 + r.y1) / 2,
                          "html": _table_html(t, page, ctx, first_heading, stats)})
        except Exception:
            continue

    # Tables drawn with thin row rules: group the text inside them into cells
    for rt in _ruled_tables(ctx):
        if any(fitz.Rect(rt["cols"][0][0], rt["ys"][0], rt["cols"][-1][1], rt["ys"][-1]).intersects(tb) for tb in tboxes):
            continue
        tbl, used = _ruled_table_items(rt, items)
        if tbl:
            ids = {id(u) for u in used}
            items = [i for i in items if id(i) not in ids] + [tbl]

    # Assign items to the smallest shaded container that holds them
    by_container: dict[int, list[dict]] = {}
    free: list[dict] = []
    for it in items:
        ci = ctx.container_for(it["cx"], it["cy"])
        (by_container.setdefault(ci, []) if ci is not None else free).append(it)

    boxes = []
    for ci, its in by_container.items():
        rect, colour = ctx.containers[ci]
        boxes.append({"rect": rect, "colour": colour, "html": _assemble(its, rect.x0 + 10, rect.x1 - 10)})

    # cluster boxes into rows (side-by-side cards share a table row)
    boxes.sort(key=lambda b: (b["rect"].y0, b["rect"].x0))
    rows: list[list[dict]] = []
    for b in boxes:
        placed = False
        for row in rows:
            r0 = row[0]["rect"]
            ov = min(b["rect"].y1, max(x["rect"].y1 for x in row)) - max(b["rect"].y0, r0.y0)
            if ov > 0.4 * min(b["rect"].height, r0.height) and all(b["rect"].x0 >= x["rect"].x1 - 2 or b["rect"].x1 <= x["rect"].x0 + 2 for x in row):
                row.append(b)
                placed = True
                break
        if not placed:
            rows.append([b])

    content_w = (pw - 2 * left) * PX
    for row in rows:
        row.sort(key=lambda b: b["rect"].x0)
        extent = (row[-1]["rect"].x1 - row[0]["rect"].x0) * PX
        scale = min(1.0, content_w / extent) if extent else 1.0
        tds = "".join(
            f'<td colwidth="{round(b["rect"].width * PX * scale)}" style="background-color: {b["colour"]}; border: 4px solid #fbfbfd; padding: 10pt 12pt">{b["html"]}</td>'
            for b in row
        )
        free.append({"kind": "table", "y0": min(b["rect"].y0 for b in row), "y1": max(b["rect"].y1 for b in row), "x0": row[0]["rect"].x0, "x1": row[-1]["rect"].x1,
                     "html": f"<table><tbody><tr>{tds}</tr></tbody></table>"})

    return _assemble(free, left, right)


def pdf_to_html(data: bytes) -> dict:
    doc = fitz.open(stream=data, filetype="pdf")
    if doc.needs_pass:
        raise ValueError("el PDF está protegido con contraseña")
    body = _body_size(doc)
    running = _repeated_margins(doc)
    stats = {"chars": 0, "diagram_pages": 0}
    first_heading = [""]
    title = (doc.metadata or {}).get("title", "").strip()

    lefts = []
    for p in doc:
        xs = [b["bbox"][0] for b in p.get_text("dict")["blocks"] if b["type"] == 0 and b.get("lines")]
        if xs:
            lefts.append(min(xs))
    left_margin = median(lefts) if lefts else 56
    settings = _page_settings(doc, left_margin)
    content_px = (doc[0].rect.width - 2 * left_margin) * PX

    parts = []
    for page in doc:
        try:
            html = _convert_page(page, body, running, first_heading, stats, content_px)
            src_chars = len(re.sub(r"\s+", "", page.get_text()))
            got_chars = len(re.sub(r"\s+", "", re.sub(r"<[^>]+>", "", html)))
            lost = src_chars > 80 and got_chars < src_chars * 0.75 and "<img" not in html[:200]
            narrow = sum(1 for w in re.findall(r'colwidth="(\d+)"', html) if int(w) < 40)
            rotated = any(abs(l["dir"][1]) > 0.3 for b in page.get_text("dict")["blocks"] if b["type"] == 0 for l in b.get("lines", []))
            lost = lost or narrow >= 2 or rotated
        except Exception:
            lost = True
        if lost:
            stats["diagram_pages"] += 1
            html = _page_image(page, content_px)
        parts.append(html)

    warnings: list[str] = []
    if stats["chars"] < 20:
        warnings.append("El PDF parece escaneado o sin texto seleccionable: se importaron solo las imágenes de las páginas.")
    if stats["diagram_pages"]:
        warnings.append(f"{stats['diagram_pages']} página(s) con diagramas o gráficos vectoriales se insertaron como imagen para conservar su aspecto.")
    warnings.append("Revisa el resultado: la maquetación compleja puede variar respecto al PDF de origen.")

    return {
        "html": "\n".join(parts) or "<p></p>",
        "title": title or first_heading[0][:120],
        "pages": doc.page_count,
        "warnings": warnings,
        "page": settings,
    }
