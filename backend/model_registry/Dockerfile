# LifePilot Model Registry — the "release server". Serves ONLY public model
# artifacts + the catalog (registry.json). Never receives, stores, or logs user
# data — see app.py's GOLDEN RULE docstring.
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py registry.json ./
COPY models/ ./models/

EXPOSE 8000
HEALTHCHECK CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
