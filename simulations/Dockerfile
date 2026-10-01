FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY simulations/requirements.txt /app/simulations/requirements.txt
RUN pip install --requirement /app/simulations/requirements.txt
COPY simulations /app/simulations

CMD ["python", "-m", "simulations.worker"]
