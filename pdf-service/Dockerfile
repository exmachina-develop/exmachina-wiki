FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Pango/Harfbuzz for WeasyPrint + the fonts offered in the editor, so exported PDFs match what is on screen.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libffi8 fontconfig \
      fonts-inter fonts-roboto fonts-open-sans fonts-lora fonts-liberation2 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Lora is not packaged in Debian: fetch it from the Google Fonts repo (non-fatal if offline).
RUN mkdir -p /usr/local/share/fonts/lora && cd /usr/local/share/fonts/lora     && (curl -fsSL -o Lora.ttf "https://github.com/google/fonts/raw/main/ofl/lora/Lora%5Bwght%5D.ttf"     && curl -fsSL -o Lora-Italic.ttf "https://github.com/google/fonts/raw/main/ofl/lora/Lora-Italic%5Bwght%5D.ttf"     || echo "WARN: Lora not downloaded; serif falls back to DejaVu") 

# Georgia/Verdana have no free metric twin: map them to the closest DejaVu faces.
COPY fonts.conf /etc/fonts/conf.d/60-wiki-aliases.conf
RUN fc-cache -f

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
RUN useradd -r -u 10001 app && chown -R app /app
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
