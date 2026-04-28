# Warband Forge — Dockerfile
# Uses Python 3.11 slim for a small image footprint

FROM python:3.11-slim

# Set working directory inside the container
WORKDIR /app

# Install dependencies first (cached layer — only rebuilds if requirements change)
COPY requirements.txt .
RUN pip install --no-cache-dir flask>=2.3 reportlab>=4.0 gunicorn

# Copy application files
COPY app.py .
COPY data.py .
COPY card_pdf.py .
COPY validate.py .
COPY gear.json .
COPY factions/ ./factions/
COPY variants/ ./variants/
COPY templates/ ./templates/
COPY static/ ./static/

# Expose the port gunicorn will listen on
EXPOSE 5000

# Run with gunicorn — 2 workers is plenty for this scale
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "60", "app:app"]
