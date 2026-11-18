# Local customer-operated training and inference runtime.
# Mount a taskset read-only at /data/taskset and durable state read-write at /data/runtime.
# Pass REPLICA_RUNTIME_TOKEN when the container starts; never bake data or credentials in.
FROM python:3.12.16-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

COPY *.py /app/replica_brand_check/
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nolog replica

USER replica
EXPOSE 8010
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8010/health', timeout=3)"]
CMD ["python", "-m", "replica_brand_check.runtime_server", "--host", "0.0.0.0", "--port", "8010", "--state", "/data/runtime", "--taskset", "/data/taskset"]
