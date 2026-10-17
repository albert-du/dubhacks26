FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Pre-download the model so cold starts are fast.
RUN python -c "from insightface.app import FaceAnalysis; FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider']).prepare(ctx_id=-1)"
COPY app.py .
EXPOSE 8001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
