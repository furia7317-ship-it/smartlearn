FROM python:3.11.15-slim

WORKDIR /app

# FFmpeg 用于视频合成、字幕与兼容视频渲染。
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Python 依赖
COPY requirements-linux.lock .
RUN pip install --no-cache-dir --require-hashes -r requirements-linux.lock

# 应用代码
COPY . .

# 创建必要目录
RUN mkdir -p data media/output chroma

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
