"""PDF -> page-faithful editable HTML.

Every PDF page becomes a fixed-size sheet:
  * background layer  = the page rendered WITHOUT its (horizontal) text: fills, shapes, lines and images stay exactly as drawn;
  * text layer        = one absolutely positioned, editable box per paragraph with the original position, font size,
                        colour, line pitch and (re-detected) font family / weight / tracking.

Chromium prints web fonts as nameless Type3 fonts. Each text run in the content stream is preceded by a `/Fn size Tf`,
so every run can be tied to its real font object; all characters that share a font object are pooled and compared with the
glyph advances of the candidate faces (Lexend, Unbounded, Urbanist) to recover family and weight. Per-run tracking is then
the exact residual, so line widths match the original."""
import base64
import os
import re
from functools import lru_cache
from html import escape
from statistics import mean, median

import fitz  # PyMuPDF
from PIL import ImageFont

FONT_DIRS = ["/usr/local/share/fonts/wiki", os.path.expanduser("~/fonts")]
CANDIDATES = {
    "Lexend": ("Lexend.ttf", [300, 400, 500, 600, 700]),
    "Unbounded": ("Unbounded.ttf", [400, 500, 600, 700]),
    "Urbanist": ("Urbanist.ttf", [300, 400, 500, 600, 700]),
}
REF = 200  # px used to measure natural advances

_fonts: dict[tuple[str, int], ImageFont.FreeTypeFont | None] = {}


def _load(family: str, weight: int):
    key = (family, weight)
    if key in _fonts:
        return _fonts[key]
    fn = CANDIDATES[family][0]
    for d in FONT_DIRS:
        path = os.path.join(d, fn)
        if os.path.exists(path):
            f = ImageFont.truetype(path, REF)
            try:
                f.set_variation_by_axes([weight])
            except Exception:
                pass
            _fonts[key] = f
            return f
    _fonts[key] = None
    return None


@lru_cache(maxsize=None)
def _len(family: str, weight: int, text: str) -> float:
    f = _load(family, weight)
    return f.getlength(text) / REF if f else 0.0


def _metrics(family: str, weight: int) -> tuple[float, float]:
    f = _load(family, weight)
    if not f:
        return 1.0, 0.25
    a, d = f.getmetrics()
    return a / REF, d / REF


# ----------------------------------------------------------------------------- fonts
def _advances(chars: list[dict]) -> list[float]:
    n = len(chars)
    return [(chars[i + 1]["origin"][0] if i + 1 < n else chars[i]["bbox"][2]) - chars[i]["origin"][0] for i in range(n)]


def _tracking(chars: list[dict], size: float, fam: str, w: int) -> float:
    """Constant per-character spacing (pt) that reproduces the original advances with face (fam, w)."""
    if fam not in CANDIDATES or _load(fam, w) is None:
        return 0.0
    text = "".join(c["c"] for c in chars)
    advs = _advances(chars)
    n = len(chars)
    res = []
    for i in range(n):
        if text[i] == " ":
            continue
        pair = text[i : i + 2]
        adv_em = _len(fam, w, pair) - (_len(fam, w, text[i + 1]) if i + 1 < n else 0.0)
        res.append(advs[i] - adv_em * size)
    return max(-0.08 * size, min(0.4 * size, median(res))) if res else 0.0


def _font_faces(page: fitz.Page) -> dict[str, tuple[str, int, bool]]:
    """font resource name -> (family, weight, italic) read from each font object's FontDescriptor.
    Chromium embeds every web font face as a Type3 font whose descriptor still names the real family and weight."""
    out: dict[str, tuple[str, int, bool]] = {}
    doc = page.parent
    for f in page.get_fonts(full=True):
        xref, name = f[0], f[4]
        try:
            obj = doc.xref_object(xref)
            m = re.search(r"/FontDescriptor (\d+) 0 R", obj)
            if not m:
                continue
            desc = doc.xref_object(int(m.group(1)))
            fam = re.search(r"/FontFamily \(([^)]*)\)", desc)
            wt = re.search(r"/FontWeight (\d+)", desc)
            it = re.search(r"/ItalicAngle (-?[\d.]+)", desc)
            if fam:
                out[name] = (fam.group(1), int(wt.group(1)) if wt else 400, bool(it and float(it.group(1)) != 0))
        except Exception:
            continue
    return out


def _font_resources(page: fitz.Page) -> dict[tuple[float, float], str]:
    """first-character origin -> font resource name (F12 ...), via the nth `Tf` of the content stream."""
    try:
        stream = b"".join(page.parent.xref_stream(x) for x in page.get_contents())
    except Exception:
        return {}
    tfs = re.findall(rb"/(F\d+) [\d.]+ Tf", stream)
    trace = [t for t in page.get_texttrace() if t["type"] == 0]
    if len(tfs) != len(trace):
        return {}
    out = {}
    for name, t in zip(tfs, trace):
        if t["chars"]:
            o = t["chars"][0][2]
            out[(round(o[0], 1), round(o[1], 1))] = name.decode()
    return out


def _hexc(c: int) -> str:
    return f"#{c & 0xFFFFFF:06x}"


# ----------------------------------------------------------------------------- page conversion
def _resolve_faces(page: fitz.Page, d: dict) -> dict[int, tuple[str, int, bool, float]]:
    """id(span) -> (family, weight, italic, tracking_pt) for every span set in a web font."""
    res_map = _font_resources(page)
    faces_by_res = _font_faces(page)
    faces: dict[int, tuple[str, int, bool, float]] = {}
    for b in d["blocks"]:
        if b["type"] != 0:
            continue
        for ln in b.get("lines", []):
            for sp in ln["spans"]:
                chars = sp.get("chars") or []
                if not chars:
                    continue
                key = (round(chars[0]["origin"][0], 1), round(chars[0]["origin"][1], 1))
                info = faces_by_res.get(res_map.get(key, ""))
                if info:
                    fam, w, it = info
                    faces[id(sp)] = (fam, w, it, _tracking(chars, sp["size"], fam, w))
    return faces


def _runs_for_line(line: dict, faces: dict) -> list[dict]:
    runs = []
    for sp in line["spans"]:
        chars = sp.get("chars") or []
        text = "".join(c["c"] for c in chars)
        if not text:
            continue
        low = sp["font"].lower()
        r = {"text": text, "size": sp["size"], "color": _hexc(sp["color"]), "italic": bool(sp["flags"] & 2) or "italic" in low,
             "bold": bool(sp["flags"] & 16) or "bold" in low, "fam": None, "w": 400, "ls": 0.0, "css": None, "origin": sp["origin"]}
        if "dejavu" in low:
            r["fam"], r["css"] = "DejaVu Sans", "'DejaVu Sans', sans-serif"
        elif any(k in low for k in ("times", "serif", "georgia", "garamond")) and "sans" not in low:
            r["fam"], r["css"] = "Times", "'Times New Roman', serif"
        elif any(k in low for k in ("courier", "mono")):
            r["fam"], r["css"] = "Courier", "'Courier New', monospace"
        elif id(sp) in faces:
            fam, w, it, ls = faces[id(sp)]
            r["fam"], r["w"], r["ls"], r["italic"] = fam, w, ls, r["italic"] or it
            r["css"] = f"'{fam}', sans-serif"
        runs.append(r)
    for i, r in enumerate(runs):  # unidentified runs inherit the neighbouring face
        if r["css"] is None:
            src = next((runs[j] for j in (i - 1, i + 1) if 0 <= j < len(runs) and runs[j]["css"] and runs[j]["fam"] not in ("DejaVu Sans", "Times", "Courier")), None)
            if src:
                r["fam"], r["w"], r["css"], r["ls"] = src["fam"], src["w"], src["css"], src["ls"]
            else:
                r["fam"], r["w"], r["css"] = "Lexend", 400, "'Lexend', sans-serif"
    return runs


def _render_runs(runs: list[dict]) -> str:
    out = []
    for r in runs:
        st = [f"font-family: {r['css']}", f"font-size: {r['size']:.2f}pt", f"color: {r['color']}"]
        if r["css"] and r["fam"] not in ("DejaVu Sans", "Times", "Courier"):
            st.append(f"font-weight: {r['w']}")
        elif r["bold"]:
            st.append("font-weight: 700")
        if r["italic"]:
            st.append("font-style: italic")
        if abs(r["ls"]) > 0.005:
            st.append(f"letter-spacing: {r['ls']:.2f}pt")
        out.append(f'<span style="{"; ".join(st)}">{escape(r["text"])}</span>')
    return "".join(out)


def _line_offset(runs: list[dict], pitch: float) -> float:
    """pt from the line-box top to the baseline when the box is `pitch` tall (CSS half-leading model)."""
    dom = max(runs, key=lambda r: len(r["text"].strip()))
    a, d = _metrics(dom["fam"], dom["w"]) if dom["fam"] in CANDIDATES else (0.93, 0.25)
    return pitch / 2 + (a - d) * dom["size"] / 2


def _page_boxes(page: fitz.Page) -> tuple[list[str], list[fitz.Rect]]:
    boxes: list[str] = []
    redact: list[fitz.Rect] = []
    d = page.get_text("rawdict")
    faces = _resolve_faces(page, d)
    for b in d["blocks"]:
        if b["type"] != 0:
            continue
        lines = [ln for ln in b.get("lines", []) if "".join(c["c"] for s in ln["spans"] for c in s.get("chars", [])).strip()
                 and abs(ln["dir"][1]) < 0.02 and ln["dir"][0] > 0]
        if not lines:
            continue
        groups: list[list[dict]] = []
        for ln in lines:
            if groups:
                g = groups[-1]
                prev = g[-1]
                same_left = abs(ln["bbox"][0] - g[0]["bbox"][0]) < 1.5
                same_center = (not same_left) and abs((ln["bbox"][0] + ln["bbox"][2]) / 2 - (g[0]["bbox"][0] + g[0]["bbox"][2]) / 2) < 2
                gap = ln["bbox"][1] - prev["bbox"][3]
                same_size = abs(ln["spans"][0]["size"] - prev["spans"][0]["size"]) < 0.6
                if same_size and gap < prev["spans"][0]["size"] * 1.2 and (same_left or same_center):
                    g.append(ln)
                    continue
            groups.append([ln])
        for g in groups:
            line_runs = [_runs_for_line(ln, faces) for ln in g]
            if not any(line_runs):
                continue
            n = len(g)
            baselines = [ln["spans"][0]["origin"][1] for ln in g]
            pitch = median([b2 - b1 for b1, b2 in zip(baselines, baselines[1:])]) if n > 1 else g[0]["spans"][0]["size"] * 1.3
            pitch = max(pitch, 1.0)
            longest = max((r for r in line_runs if r), key=lambda r: sum(len(x["text"]) for x in r))
            top = baselines[0] - _line_offset(longest, pitch)
            x0 = min(ln["bbox"][0] for ln in g)
            x1 = max(ln["bbox"][2] for ln in g)
            centered = n > 1 and all(abs((ln["bbox"][0] + ln["bbox"][2]) / 2 - (x0 + x1) / 2) < 2 for ln in g) and any(abs(ln["bbox"][0] - x0) > 1.5 for ln in g)
            left = x0 if centered else min(r[0]["origin"][0] for r in line_runs if r)
            st = [f"left: {left:.2f}pt", f"top: {top:.2f}pt", f"line-height: {pitch:.2f}pt"]
            if centered:
                st += [f"width: {x1 - x0:.2f}pt", "text-align: center"]
            boxes.append(f'<div class="tb" style="{"; ".join(st)}">' + "<br>".join(_render_runs(r) for r in line_runs) + "</div>")
            redact += [fitz.Rect(ln["bbox"]) for ln in g]
    return boxes, redact


def _background(page: fitz.Page, redact: list[fitz.Rect], dpi: int) -> tuple[bytes, str]:
    """Render the page with its text removed (graphics and images kept)."""
    if redact:
        for r in redact:
            page.add_redact_annot(r, fill=False)
        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE)
    pix = page.get_pixmap(dpi=dpi, alpha=False)
    png = pix.tobytes("png")
    if len(png) > 300_000:
        jpg = pix.tobytes("jpeg", jpg_quality=88)
        if len(jpg) < len(png):
            return jpg, "jpeg"
    return png, "png"


def pdf_to_pages(data: bytes, dpi: int = 144) -> dict:
    doc = fitz.open(stream=data, filetype="pdf")
    if doc.needs_pass:
        raise ValueError("el PDF está protegido con contraseña")
    sections: list[str] = []
    title = (doc.metadata or {}).get("title", "").strip()
    n_chars = 0
    for page in doc:
        boxes, redact = _page_boxes(page)
        n_chars += sum(len(re.sub(r"<[^>]+>", "", b)) for b in boxes)
        w, h = page.rect.width, page.rect.height
        img, kind = _background(page, redact, dpi)
        uri = f"data:image/{kind};base64,{base64.b64encode(img).decode()}"
        sections.append(f'<section class="pdf-page" style="width: {w:.2f}pt; height: {h:.2f}pt; background-image: url({uri})">' + "".join(boxes) + "</section>")
    w0, h0 = doc[0].rect.width, doc[0].rect.height
    warnings = []
    if n_chars < 20:
        warnings.append("El PDF no tiene texto seleccionable (escaneado): solo se importó la imagen de cada página.")
    return {
        "layout": "pages",
        "html": '<div class="pdfpages">' + "".join(sections) + "</div>",
        "title": title,
        "pages": doc.page_count,
        "warnings": warnings,
        "page": {"size": "Custom", "orientation": "landscape" if w0 > h0 else "portrait", "margin": 0, "widthPt": round(w0, 2), "heightPt": round(h0, 2)},
    }
