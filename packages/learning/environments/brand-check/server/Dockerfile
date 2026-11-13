# Image for the brand check environment server.
# The taskset holds private review data. Mount it read-only at /data/taskset when the container
# runs; never copy it into the image. Pass the access token at run time with
# docker run -e REPLICA_ENV_TOKEN; never set it in the image.
FROM python:3.12.16-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore \
    REPLICA_TASKSET_DIR=/data/taskset

COPY pyproject.toml README.md /src/
COPY *.py /src/
COPY server/*.py /src/server/
# Root owns the installed code, so the server cannot change the code it runs.
RUN pip install /src \
    && rm -rf /src \
    && useradd --uid 10001 --create-home --shell /usr/sbin/nologin brandcheck

USER brandcheck
EXPOSE 8000
# GET /health is the only route that answers without the token.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"]
CMD ["uvicorn", "replica_brand_check.server.app:app", "--host", "0.0.0.0", "--port", "8000"]
