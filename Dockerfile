# syntax=docker/dockerfile:1

# =====================
# Frontend build stage
# =====================
FROM node:18-bullseye AS frontend-build
WORKDIR /app

# Install minimal build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json first for caching
COPY CLI/local-cli-fe-full/package*.json ./

# Install dependencies
RUN npm ci --legacy-peer-deps --no-audit --progress=false

# Copy frontend source
COPY CLI/local-cli-fe-full ./

# Build args
ARG REACT_APP_API_URL=http://127.0.0.1:8000
ENV REACT_APP_API_URL=${REACT_APP_API_URL}

# Limit Node memory (important for ARM multi-arch builds)
ENV NODE_OPTIONS=--max_old_space_size=2048

# Build frontend
RUN npm run build

# =====================
# Backend build stage
# =====================
FROM python:3.11-slim AS backend-build
WORKDIR /app
ENV DEBIAN_FRONTEND=noninteractive

# Install system deps for virtualenv + build
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-venv build-essential git curl xsel \
    && rm -rf /var/lib/apt/lists/*

# Create virtualenv
RUN python3 -m venv /opt/venv
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Install Python dependencies
COPY requirements.txt .
RUN pip install --upgrade pip wheel \
    && pip install --no-cache-dir -r requirements.txt

# Clone and install AnyLog-API
RUN git clone --branch main --depth 1 https://github.com/AnyLog-co/AnyLog-API /tmp/AnyLog-API \
    && cd /tmp/AnyLog-API \
    && python setup.py sdist bdist_wheel \
    && pip install --no-cache-dir dist/*.whl \
    && rm -rf /tmp/AnyLog-API

# Copy backend source
COPY CLI/ CLI/
COPY templates/ templates/
COPY start.sh start.sh
RUN chmod +x start.sh

# =====================
# Final runtime image
# =====================
FROM python:3.11-slim AS final
WORKDIR /app

ENV VIRTUAL_ENV=/opt/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"
ENV CLI_IP=0.0.0.0
ENV CLI_PORT=8000

# Install minimal runtime deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    xsel \
    && rm -rf /var/lib/apt/lists/*

# Copy backend virtualenv and files
COPY --from=backend-build /opt/venv /opt/venv
COPY --from=backend-build /app/CLI CLI/
COPY --from=backend-build /app/templates templates/
COPY --from=backend-build /app/start.sh start.sh

# Copy frontend build
COPY --from=frontend-build /app/build /app/CLI/local-cli-fe-full/build

# Ensure start.sh is executable
RUN sed -i 's/\r$//' start.sh && chmod +x start.sh

EXPOSE 8000 3001

# Only one ENTRYPOINT
ENTRYPOINT ["/app/start.sh"]
