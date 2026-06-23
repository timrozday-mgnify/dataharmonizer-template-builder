FROM node:20-slim AS frontend-builder

WORKDIR /app
COPY --from=dataharmonizer-src . /DataHarmonizer
COPY package.json ./
RUN npm install
COPY index.html tsconfig.json vite.config.ts playwright.config.ts ./
COPY frontend/ frontend/
RUN npm run build

FROM python:3.11-slim

# docker CLI is required so the app can spawn the dh-builder sibling
# container via the mounted docker socket (on-demand DH bundle rebuild).
RUN apt-get update && apt-get install -y docker.io && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=linkml-lib . /linkml-lib
COPY --from=dh-builder-lib . /dh-builder-lib
COPY requirements.txt .
RUN pip install --no-cache-dir /linkml-lib /dh-builder-lib && pip install --no-cache-dir -r requirements.txt

COPY src/ src/
COPY pyproject.toml README.md ./
COPY --from=frontend-builder /app/frontend/dist frontend/dist

ENV PYTHONPATH=/app/src
EXPOSE 8765
CMD ["uvicorn", "dataharmonizer_template_builder.api:app", "--host", "0.0.0.0", "--port", "8765"]
