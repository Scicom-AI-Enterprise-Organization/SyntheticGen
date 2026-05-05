FROM python:3.13-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /worker

COPY pyproject.toml ./
COPY synthgen ./synthgen

RUN uv pip install --system --no-cache .

ENV PYTHONUNBUFFERED=1
EXPOSE 8000
