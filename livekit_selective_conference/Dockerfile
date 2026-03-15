FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY livekit_selective_conference/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY livekit_selective_conference /app/livekit_selective_conference

EXPOSE 8000

CMD ["uvicorn", "livekit_selective_conference.app:app", "--host", "0.0.0.0", "--port", "8000"]
