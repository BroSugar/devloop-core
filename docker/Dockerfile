# 生产镜像：两段构建（前端产物 + 零依赖后端运行时）

# ---------- 1. 构建前端 ----------
FROM node:24-bookworm-slim AS web
RUN corepack enable
WORKDIR /src

# 先只拷清单，让 pnpm install 的层能被缓存
COPY client/package.json client/pnpm-lock.yaml client/pnpm-workspace.yaml ./
COPY client/apps/web/package.json apps/web/
COPY client/packages/ui/package.json packages/ui/
COPY client/packages/api-client/package.json packages/api-client/
COPY client/packages/shell/package.json packages/shell/
RUN pnpm install --frozen-lockfile

COPY client/ ./
RUN pnpm build

# ---------- 2. 运行时 ----------
FROM node:24-bookworm-slim AS runtime

# 运行期需要 git：bootstrap 生成示例仓、任务执行用 worktree
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    DEVLOOP_HOST=0.0.0.0 \
    DEVLOOP_PORT=8787

COPY server/ server/
COPY platform/ platform/
COPY contracts/ contracts/
COPY config/ config/
COPY projects/ projects/
COPY samples/ samples/
COPY scripts/ scripts/

COPY --from=web /src/apps/web/dist client/apps/web/dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && mkdir -p data

EXPOSE 8787

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "server/index.mjs"]
