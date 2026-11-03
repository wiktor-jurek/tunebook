# Build from the repo root: docker build -f services/realtime/Dockerfile .
FROM rust:1-alpine AS builder
RUN apk add --no-cache musl-dev
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY services services
RUN cargo build --release -p realtime

FROM alpine:3
RUN adduser -S realtime
COPY --from=builder /src/target/release/realtime /usr/local/bin/realtime
USER realtime
ENV PORT=4000
EXPOSE 4000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["realtime"]
