FROM node:20-slim AS frontend-builder

WORKDIR /app
COPY --from=dataharmonizer-src . /DataHarmonizer
COPY package.json ./
RUN npm install
COPY index.html tsconfig.json vite.config.ts playwright.config.ts ./
COPY frontend/ frontend/
RUN npm run build

FROM python:3.11-slim

WORKDIR /app
COPY --from=linkml-lib . /linkml-lib
COPY requirements.txt .
RUN pip install --no-cache-dir /linkml-lib && pip install --no-cache-dir -r requirements.txt

COPY src/ src/
COPY pyproject.toml README.md ./
COPY --from=frontend-builder /app/frontend/dist frontend/dist

ENV PYTHONPATH=/app/src
EXPOSE 8765
CMD ["uvicorn", "dataharmonizer_template_builder.api:app", "--host", "0.0.0.0", "--port", "8765"]
