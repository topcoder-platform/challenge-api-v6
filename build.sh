#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_NAME="${1:?Usage: $0 <application-name>}"
build_args=(--file docker/Dockerfile --tag "${APP_NAME}:latest")

# CircleCI creates this file for private registry access. Pass it to BuildKit
# without copying credentials into the build context or an image layer.
if [[ -f .npmrc ]]; then
  build_args+=(--secret id=npmrc,src=.npmrc)
fi

DOCKER_BUILDKIT=1 docker build "${build_args[@]}" .
