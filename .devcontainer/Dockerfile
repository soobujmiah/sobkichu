# Sobkichu devcontainer image.
# Node comes from a devcontainer feature; Flutter is installed here because
# the official feature lags SDK releases and we want a pinned channel.

FROM mcr.microsoft.com/devcontainers/base:ubuntu-22.04

ARG FLUTTER_VERSION=3.24.5

RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends \
        curl git unzip xz-utils zip libglu1-mesa \
        ca-certificates postgresql-client redis-tools jq \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Flutter SDK, pinned. Android SDK is intentionally NOT installed here:
# CI builds the APK (see .github/workflows/mobile-ci.yml) and the devcontainer
# is for analyze/test/logic work. Keeps the image an order of magnitude smaller.
RUN curl -fsSL "https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz" \
      -o /tmp/flutter.tar.xz \
    && tar -xJf /tmp/flutter.tar.xz -C /opt \
    && rm /tmp/flutter.tar.xz \
    && git config --system --add safe.directory /opt/flutter \
    && chown -R vscode:vscode /opt/flutter

ENV PATH="/opt/flutter/bin:/opt/flutter/bin/cache/dart-sdk/bin:${PATH}"

USER vscode
RUN flutter --version && flutter precache --universal
