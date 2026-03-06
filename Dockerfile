# syntax=docker/dockerfile:1

# =====================
# Frontend build stage
# =====================
FROM node:18-slim AS frontend-build
WORKDIR /app

# Install system deps for native npm packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy fixed package.json and install deps
COPY CLI/local-cli-fe-full/package.json ./
RUN npm install --legacy-peer-deps --no-audit --progress=false \
    # Remove nested ajv/ajv-keywords inside fork-ts-checker so it uses top-level ajv@8
    && rm -rf /app/node_modules/fork-ts-checker-webpack-plugin/node_modules/ajv \
    && rm -rf /app/node_modules/fork-ts-checker-webpack-plugin/node_modules/ajv-keywords \
    && rm -rf /app/node_modules/fork-ts-checker-webpack-plugin/node_modules/schema-utils

# Copy frontend source (node_modules must be excluded in .dockerignore)
COPY CLI/local-cli-fe-full ./

# Build-time API URL
ARG REACT_APP_API_URL=http://127.0.0.1:8000
ENV REACT_APP_API_URL=${REACT_APP_API_URL}

# Build frontend — env vars inline to guarantee subprocess inheritance
# GENERATE_SOURCEMAP=false cuts webpack memory 2-3x (no source maps needed in prod)
# CI=false prevents warnings from aborting the build
RUN GENERATE_SOURCEMAP=false CI=false NODE_OPTIONS="--max_old_space_size=1536" npm run build

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

# Create virtual environment
RUN python3 -m venv /opt/venv
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Copy Python dependencies and install in virtualenv
COPY requirements.txt .
RUN pip install --upgrade pip wheel \
    && pip install --no-cache-dir -r requirements.txt

# Clone AnyLog-API and install into virtualenv
RUN git clone --branch main --depth 1 https://github.com/AnyLog-co/AnyLog-API /tmp/AnyLog-API \
    && cd /tmp/AnyLog-API \
    && python setup.py sdist bdist_wheel \
    && pip install --no-cache-dir dist/*.whl \
    && rm -rf /tmp/AnyLog-API

# Copy backend source and templates
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

# User-defined at deployment via -e or --build-arg
ENV CLI_IP=0.0.0.0
ARG EXPOSE_PORT=8000
ENV CLI_PORT=${EXPOSE_PORT}

# Install minimal runtime deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    xsel \
    && rm -rf /var/lib/apt/lists/*

# Copy venv from backend-build
COPY --from=backend-build /opt/venv /opt/venv

# Copy backend source + templates + start.sh
COPY --from=backend-build /app/CLI CLI/
COPY --from=backend-build /app/templates templates/
COPY --from=backend-build /app/start.sh start.sh

# Copy frontend build
COPY --from=frontend-build /app/build /app/CLI/local-cli-fe-full/build

# Ensure start.sh is executable
RUN sed -i 's/\r$//' start.sh && chmod +x start.sh

EXPOSE ${EXPOSE_PORT}

ENTRYPOINT ["/app/start.sh"]
