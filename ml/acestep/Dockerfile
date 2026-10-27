# ACE-Step 1.5 for cover generation on mantis (RTX 3070, 8 GB). Weights download into the
# mounted checkpoints folder on first run, so the image stays code-only.
#   docker build -t tunebook-acestep ml/acestep
FROM ghcr.io/astral-sh/uv:0.8.13-python3.12-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ffmpeg libsndfile1 build-essential && rm -rf /var/lib/apt/lists/*
ARG COMMIT=ca1e85fe9430179831e6bc6be790c332190a3866
RUN git clone https://github.com/ace-step/ACE-Step-1.5 /opt/acestep && cd /opt/acestep && git checkout $COMMIT && uv sync --frozen || uv sync
ENV ACESTEP_CHECKPOINTS_DIR=/checkpoints ACESTEP_INIT_LLM=false PATH=/opt/acestep/.venv/bin:$PATH
WORKDIR /opt/acestep
