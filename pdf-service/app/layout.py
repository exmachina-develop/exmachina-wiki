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


def _tracking(chars: list[dict], size: float, fam: str, w: int) -> tuple[float, bool]:
    """Constant per-character spacing (pt) reproducing the original advances with face (fam, w), and whether the
    text was set without kerning (strongly letter-spaced runs): returns (tracking_pt, kerning_off)."""
    if fam not in CANDIDATES or _load(fam, w) is None:
        return 0.0, False
    text = "".join(c["c"] for c in chars)
    advs = _advances(chars)
    n = len(chars)

    def fit(kerned: bool):
        res = []
        for i in range(n):
            if text[i] == " ":
                continue
            if kerned:
                pair = text[i : i + 2]
                adv_em = _len(fam, w, pair) - (_len(fam, w, text[i + 1]) if i + 1 < n else 0.0)
            else:
                adv_em = _len(fam, w, text[i])
            res.append(advs[i] - adv_em * size)
        if not res:
            return 0.0, 0.0
        ls = median(res)
        return ls, sum(abs(r - ls) for r in res) / len(res)

    ls_k, err_k = fit(True)
    ls_n, err_n = fit(False)
    use_plain = err_n < err_k * 0.8 and abs(ls_n) > 0.04 * size
    ls = ls_n if use_plain else ls_k
    return max(-0.08 * size, min(0.5 * size, ls)), use_plain


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


def _font_resources(page: fitz.Page) -> dict[tuple[float, float], tuple[str, bool]]:
    """glyph origin -> (font resource name, synthetic italic) via the nth `Tf` of the content stream.
    Synthetic italics show up as a sheared text matrix (`1 0 .25 -1 x y Tm`)."""
    try:
        stream = b"".join(page.parent.xref_stream(x) for x in page.get_contents())
    except Exception:
        return {}
    runs = re.findall(rb"/(F\d+) [\d.]+ Tf\s+(?:([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) Tm)?", stream)
    trace = [t for t in page.get_texttrace() if t["type"] == 0]
    if len(runs) != len(trace):
        return {}
    out = {}
    for run, t in zip(runs, trace):
        shear = abs(float(run[3])) if run[3] else 0.0
        info = (run[0].decode(), shear > 0.1)
        for ch in t["chars"]:
            o = ch[2]
            out[(round(o[0], 1), round(o[1], 1))] = info
    return out


def _hexc(c: int) -> str:
    return f"#{c & 0xFFFFFF:06x}"


# ----------------------------------------------------------------------------- page conversion
def _key(c: dict) -> tuple[float, float]:
    return (round(c["origin"][0], 1), round(c["origin"][1], 1))


def _make_run(text: str, sp: dict, origin, color: str, italic: bool) -> dict:
    low = sp["font"].lower()
    return {"text": text, "size": sp["size"], "color": color, "italic": italic or "italic" in low,
            "bold": bool(sp["flags"] & 16) or "bold" in low, "fam": None, "w": 400, "ls": 0.0, "css": None, "plain": False, "origin": origin}


def _runs_for_line(line: dict, res_map: dict, faces_by_res: dict) -> list[dict]:
    """Break a line into runs of one face each. PyMuPDF merges neighbouring web-font runs into one span and adds
    synthetic spaces between widely tracked glyphs, so runs are rebuilt from the glyphs that really exist in the
    content stream, grouped by their font object."""
    runs: list[dict] = []
    for sp in line["spans"]:
        chars = sp.get("chars") or []
        if not chars:
            continue
        low = sp["font"].lower()
        color = _hexc(sp["color"])
        italic = bool(sp["flags"] & 2)
        text = "".join(c["c"] for c in chars)
        if "dejavu" in low:
            r = _make_run(text, sp, sp["origin"], color, italic)
            r["fam"], r["css"] = "DejaVu Sans", "'DejaVu Sans', sans-serif"
            runs.append(r)
            continue
        if any(k in low for k in ("times", "serif", "georgia", "garamond")) and "sans" not in low:
            r = _make_run(text, sp, sp["origin"], color, italic)
            r["fam"], r["css"] = "Times", "'Times New Roman', serif"
            runs.append(r)
            continue
        if any(k in low for k in ("courier", "mono")):
            r = _make_run(text, sp, sp["origin"], color, italic)
            r["fam"], r["css"] = "Courier", "'Courier New', monospace"
            runs.append(r)
            continue
        real = []
        if res_map:
            prev = None
            for c in chars:
                h = res_map.get(_key(c))
                if h is None:
                    if c["c"] == " ":
                        continue  # synthetic space inferred by PyMuPDF from a wide gap
                    h = prev  # second half of a ligature (fi, fl...) expanded by PyMuPDF
                if h is not None:
                    real.append((c, h))
                    prev = h
        if not real:  # could not tie to font objects: neutral run, face inherited from neighbours below
            runs.append(_make_run(text, sp, sp["origin"], color, italic))
            continue
        i = 0
        while i < len(real):
            j = i
            while j + 1 < len(real) and real[j + 1][1] == real[i][1]:
                j += 1
            grp = [c for c, _ in real[i : j + 1]]
            res_name, sheared = real[i][1]
            r = _make_run("".join(c["c"] for c in grp), sp, grp[0]["origin"], color, italic or sheared)
            info = faces_by_res.get(res_name)
            if info:
                fam, w, it = info
                ls, plain = _tracking(grp, sp["size"], fam, w)
                r.update(fam=fam, w=w, ls=ls, plain=plain, css=f"'{fam}', sans-serif")
                r["italic"] = r["italic"] or it
            runs.append(r)
            i = j + 1
    for i, r in enumerate(runs):  # unidentified runs inherit the neighbouring face
        if r["css"] is None:
            src = next((runs[j] for j in (i - 1, i + 1) if 0 <= j < len(runs) and runs[j]["css"] and runs[j]["fam"] not in ("DejaVu Sans", "Times", "Courier")), None)
            if src:
                r.update(fam=src["fam"], w=src["w"], css=src["css"], ls=src["ls"], plain=src["plain"])
            else:
                r.update(fam="Lexend", w=400, css="'Lexend', sans-serif")
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
        if r.get("plain"):
            st.append("font-kerning: none")
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
    res_map = _font_resources(page)
    faces_by_res = _font_faces(page)
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
            line_runs = [_runs_for_line(ln, res_map, faces_by_res) for ln in g]
            if not any(line_runs):
                continue
            n = len(g)
            baselines = [ln["spans"][0]["origin"][1] for ln in g]
            pitch = median([b2 - b1 for b1, b2 in zip(baselines, baselines[1:])]) if n > 1 else g[0]["spans"][0]["size"] * 1.3
            pitch = max(pitch, 1.0)
            longest = max((r for r in line_runs if r), key=lambda r: sum(len(x["text"]) for x in r))
            longest_dom = max(longest, key=lambda r: len(r["text"].strip()))
            top = baselines[0] - _line_offset(longest, pitch)
            x0 = min(ln["bbox"][0] for ln in g)
            x1 = max(ln["bbox"][2] for ln in g)
            centered = n > 1 and all(abs((ln["bbox"][0] + ln["bbox"][2]) / 2 - (x0 + x1) / 2) < 2 for ln in g) and any(abs(ln["bbox"][0] - x0) > 1.5 for ln in g)
            left = x0 if centered else min(r[0]["origin"][0] for r in line_runs if r)
            st = [f"left: {left:.2f}pt", f"top: {top:.2f}pt", f"line-height: {pitch:.2f}pt", f"font-family: {longest_dom['css']}", f"font-size: {longest_dom['size']:.2f}pt", f"font-weight: {longest_dom['w'] if longest_dom['fam'] in CANDIDATES else (700 if longest_dom['bold'] else 400)}"]
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
