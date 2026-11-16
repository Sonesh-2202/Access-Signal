FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
WORKDIR /app
COPY requirements.txt requirements-postgres.txt ./
RUN pip install --no-cache-dir -r requirements-postgres.txt
COPY . .
RUN useradd --create-home app && mkdir -p /data/uploads && chown -R app /data /app
USER app
EXPOSE 8000
# One worker: the rate limiter and the routing graph cache live in process memory,
# and free hosts give 512 MB. Hosts that inject $PORT (Render, Koyeb, HF Spaces) are honoured.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --no-server-header"]
