# ChordCraft API — CPU image (Hugging Face Spaces serves Docker apps on port 7860).
# Includes CPU PyTorch for the chord transformer; mount or copy the checkpoint to
# /app/models/chord-transformer-v1.pt (or set CHORD_MODEL_PATH). Without it the
# API serves the rule engine.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.9 /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

# Dependencies first so code changes don't bust the layer cache.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --extra ml --no-install-project

COPY chordcraft ./chordcraft
RUN uv sync --frozen --no-dev --extra ml

ENV PATH="/app/.venv/bin:$PATH" PORT=7860
EXPOSE 7860
CMD ["sh", "-c", "uvicorn chordcraft.api.main:app --host 0.0.0.0 --port ${PORT}"]
