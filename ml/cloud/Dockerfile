# Training and evaluation image for Listen; the same image runs on mantis and Vast.ai.
#   docker build -t tunebook-ml -f cloud/Dockerfile .
FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv PATH=/opt/venv/bin:/root/.local/bin:$PATH
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends fluidsynth libfluidsynth3 ffmpeg git curl rsync ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -LsSf https://astral.sh/uv/0.8.11/install.sh | sh

WORKDIR /workspace/ml
COPY pyproject.toml uv.lock ./
RUN uv sync --group train --frozen --no-install-project
