#!/bin/sh
# 容器启动前的幂等准备：数据目录 + 示例仓库（repos/ 不存在时从 samples/ 生成）。
# dev 用 bind mount 时 repos/ 已由宿主机 bootstrap 过，这里会跳过。
set -eu

APP_DIR="${APP_DIR:-/app}"
cd "$APP_DIR"

mkdir -p data

if [ ! -d repos ] || [ -z "$(ls -A repos 2>/dev/null || true)" ]; then
  echo "[entrypoint] repos/ 为空，从 samples/ 生成示例仓库"
  node scripts/bootstrap.mjs || echo "[entrypoint] bootstrap 失败，继续启动（seed 会跳过缺失仓库的项目）"
fi

echo "[entrypoint] node $(node -v) · host=${DEVLOOP_HOST:-127.0.0.1} · port=${DEVLOOP_PORT:-8787}"
exec "$@"
