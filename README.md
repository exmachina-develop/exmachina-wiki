# EXMACHINA Wiki

Wiki interna de documentos: espacios de trabajo, editor de texto enriquecido con formato fiel, importación/exportación de PDF, organigrama con responsables y roles/permisos.

| Capa | Tecnología |
|---|---|
| Frontend | Angular 18 (standalone, signals) + Tiptap (ProseMirror) |
| API | NestJS 10 · TypeORM · JWT · class-validator |
| Base de datos | PostgreSQL 16 |
| Archivos | MinIO (S3) — PDFs originales e imágenes |
| Servicio PDF | Python · FastAPI · PyMuPDF (PDF → HTML) · WeasyPrint (HTML → PDF) |

## Funciones

- **Editor**: títulos, fuente, tamaño (pt), negrita/cursiva/subrayado/tachado, color y resaltado, alineación (izquierda, centro, derecha, justificado), interlineado, listas, citas, código, enlaces, imágenes, **tablas** (filas/columnas, combinar celdas, color de celda, redimensionar) y ajustes de página (A4/Carta, orientación, márgenes). La hoja se muestra en medidas físicas, igual que el PDF exportado.
- **Importar PDF** → documento editable (estructura, estilos, listas, tablas, imágenes, alineación e interlineado). El PDF original queda guardado en MinIO.
- **Exportar a PDF** con el formato del editor.
- **Espacios de trabajo** (empresa o privados, con miembros admin/editor/lector), árbol de páginas, historial de versiones con restauración, búsqueda.
- **Organigrama** de áreas con responsables y personas.
- **Roles y permisos** configurables (11 permisos), gestión de usuarios.

## Usuarios iniciales (rol Administrador, todos los permisos)

Samuel Rojas, Albert Fonse, Gabriel Perez, Emanuel Jimenez — `nombre.apellido@exmachina.systems`.
Las contraseñas iniciales vienen de `SEED_PASSWORD_*` en `.env` (o se generan y aparecen en los logs del API la primera vez). Cámbialas desde *Mi perfil*.

## Desarrollo

```bash
cp .env.example .env            # rellena secretos
docker compose up -d --build    # http://127.0.0.1:3102
```

Sin Docker: `backend` (`npm run start:dev`, necesita Postgres y MinIO), `frontend` (`npx ng serve` con proxy a `/api`), `pdf-service` (`uvicorn app.main:app`).

## Despliegue

`deploy/deploy.sh` clona/actualiza el repo en `/opt/apps/exmachina-wiki`, genera `.env` y levanta el stack en `127.0.0.1:3102`. `deploy/nginx-wiki.conf` es el vhost del nginx del host (TLS con `certbot --nginx -d wiki.exmachina.systems`).

## Seguridad

JWT (12 h) · bcrypt · rate-limit en login · el HTML de los documentos se sanea en servidor (sanitize-html) · CSP estricta en el frontend · imágenes servidas por UUID, resto de archivos requieren token · el servicio PDF no hace peticiones externas.
