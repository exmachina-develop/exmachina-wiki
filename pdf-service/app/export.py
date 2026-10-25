"""HTML (as produced by the editor) -> PDF with WeasyPrint."""
from html import escape

from weasyprint import CSS, HTML, default_url_fetcher

# Styles mirror the editor's "paper" so what you see is what you export.
BASE_CSS = """
html { font-family: 'Inter', 'Liberation Sans', sans-serif; font-size: 11pt; line-height: 1.5; color: #14141a; }
p { margin: 0 0 .55em; min-height: 1em; }
h1 { font-size: 24pt; line-height: 1.2; margin: .9em 0 .4em; font-weight: 700; letter-spacing: -.01em; }
h2 { font-size: 18pt; line-height: 1.25; margin: .9em 0 .4em; font-weight: 600; }
h3 { font-size: 14pt; line-height: 1.3; margin: .8em 0 .35em; font-weight: 600; }
h4 { font-size: 12pt; margin: .8em 0 .3em; font-weight: 600; }
h1, h2, h3, h4 { break-after: avoid; }
ul, ol { margin: 0 0 .6em; padding-left: 1.6em; }
li > p { margin: 0 0 .2em; }
blockquote { margin: .8em 0; padding: .1em 1em; border-left: 3px solid #7047ff; color: #4a4a58; }
pre { background: #f1f1f5; padding: .7em .9em; border-radius: 4px; font-family: 'Liberation Mono', monospace; font-size: 9.5pt; white-space: pre-wrap; }
code { font-family: 'Liberation Mono', monospace; font-size: .92em; background: #f1f1f5; padding: 0 .25em; border-radius: 3px; }
a { color: #416bff; text-decoration: underline; }
hr { border: 0; border-top: 1px solid #c9c9d3; margin: 1.2em 0; }
img { max-width: 100%; height: auto; }
mark { background: #fff1a8; }
table { border-collapse: collapse; width: 100%; margin: .8em 0; table-layout: fixed; }
td, th { border: 1px solid #b9b9c6; padding: 5pt 7pt; vertical-align: top; overflow-wrap: anywhere; }
th { background: #f1f1f6; font-weight: 600; text-align: left; }
td > p, th > p { margin: 0; }
tr { break-inside: avoid; }
"""


def _fetcher(url: str, *args, **kwargs):
    # The document is self-contained (images are inlined by the backend): never fetch remote resources.
    if url.startswith("data:"):
        return default_url_fetcher(url, *args, **kwargs)
    raise ValueError("Recursos externos deshabilitados")


def html_to_pdf(html: str, title: str, size: str, orientation: str, margin: float) -> bytes:
    page_css = f"""
    @page {{
      size: {size} {orientation};
      margin: {margin}mm;
      @bottom-right {{ content: counter(page) ' / ' counter(pages); font: 8pt 'Inter', sans-serif; color: #8b8fa3; }}
    }}
    """
    doc = f'<!doctype html><html lang="es"><head><meta charset="utf-8"><title>{escape(title)}</title></head><body>{html}</body></html>'
    return HTML(string=doc, url_fetcher=_fetcher).write_pdf(stylesheets=[CSS(string=BASE_CSS), CSS(string=page_css)])
