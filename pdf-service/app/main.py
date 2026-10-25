from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .export import html_to_pdf
from .importer import pdf_to_html

MAX_PDF_BYTES = 50 * 1024 * 1024

app = FastAPI(title="Exmachina Wiki · PDF service", docs_url=None, redoc_url=None)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/pdf/to-html")
async def to_html(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(413, "PDF demasiado grande")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(400, "No es un PDF")
    try:
        return pdf_to_html(data)
    except HTTPException:
        raise
    except Exception as exc:  # corrupt / encrypted documents
        raise HTTPException(422, f"No se pudo leer el PDF: {exc}") from exc


class PageSettings(BaseModel):
    size: str = Field("A4", pattern="^(A4|Letter)$")
    orientation: str = Field("portrait", pattern="^(portrait|landscape)$")
    margin: float = Field(20, ge=5, le=50)


class FromHtml(BaseModel):
    html: str = Field(max_length=20_000_000)
    title: str = ""
    page: PageSettings = PageSettings()


@app.post("/pdf/from-html")
def from_html(body: FromHtml):
    try:
        pdf = html_to_pdf(body.html, body.title, body.page.size, body.page.orientation, body.page.margin)
    except Exception as exc:
        raise HTTPException(422, f"No se pudo generar el PDF: {exc}") from exc
    return Response(content=pdf, media_type="application/pdf")
