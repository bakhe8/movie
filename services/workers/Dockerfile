# Model service, FastAPI (board C-5, ALPHA_PLAN 7.3). Build context is the
# repo root -- not this directory -- only so this Dockerfile can share
# `docker/read-secrets.sh` with the other two images; Poetry/pip only ever
# sees this directory's own `pyproject.toml`/`poetry.lock`.
#
#   docker build -f services/workers/Dockerfile -t movie-model-service .

FROM python:3.12-slim AS build
WORKDIR /app
RUN pip install --no-cache-dir poetry==1.8.3 \
 && poetry config virtualenvs.in-project true
COPY services/workers/pyproject.toml services/workers/poetry.lock ./
# --no-root: package-mode = false, this is a script directory, not a
# distributable package (pyproject.toml's own comment on package-mode).
RUN poetry install --only main --no-root --no-interaction --no-ansi

FROM python:3.12-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init && rm -rf /var/lib/apt/lists/* \
 && addgroup --system app && adduser --system --ingroup app app
WORKDIR /app
ENV PATH="/app/.venv/bin:${PATH}" PYTHONUNBUFFERED=1
COPY --from=build /app/.venv /app/.venv
# src/ nested under services/workers/, matching the repo's own depth below the
# venv, not directly at the image root: main() locates the (optional, dev-only)
# root .env via Path(__file__).parents[3], which raises IndexError with fewer
# than 3 parent directories above it. A container-layout fix, not a source
# change (model_service.py is session A's file) -- the venv is unaffected,
# CMD's cwd (services/workers, the parent of src/) is what `python -m
# src.model_service` needs to resolve the module either way.
COPY services/workers/src services/workers/src
COPY docker/read-secrets.sh /usr/local/bin/read-secrets.sh
RUN chmod +x /usr/local/bin/read-secrets.sh
USER app
WORKDIR /app/services/workers
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"MODEL_SERVICE_PORT\",\"8001\")}/health', timeout=3)" || exit 1
ENTRYPOINT ["/usr/local/bin/read-secrets.sh"]
CMD ["python", "-m", "src.model_service"]
