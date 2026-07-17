# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# ── 僅供 next build 靜態收集用的 build-time placeholder env ──
# next build 收集 page data 時會 evaluate route 模組，觸發 module-scope 的
# `import { env } from "@/lib/env"`（Zod fail-fast）。build 階段刻意無 .env（.dockerignore 排除），
# 故在此注入 env.ts 僅有的兩個必填欄位佔位值，讓靜態收集通過即可。
# 這些值不進 runtime：compose 以 env_file(.env) 與 environment 覆寫（見 docker-compose.yml web/worker）。
ENV DATABASE_URL=postgresql://build:build@build-placeholder:5432/build \
    BASE_URL=http://build-placeholder
RUN npm run build && npm run build:worker

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# ── Build metadata（#267）：build-arg 注入 → runtime ENV，供 GUI／healthz 顯示部署版本。
# 未傳入時為空字串，由 src/lib/build-info.ts fallback（commit=dev、version 取 package.json）。
ARG APP_VERSION=""
ARG GIT_COMMIT=""
ARG BUILD_TIME=""
ENV APP_VERSION=$APP_VERSION \
    GIT_COMMIT=$GIT_COMMIT \
    BUILD_TIME=$BUILD_TIME
RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001 -G nodejs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# worker（H-01）：同 image、不同 command（compose worker 服務用 node dist/worker.js）
COPY --from=build --chown=nextjs:nodejs /app/dist ./dist
# 附件儲存根目錄（M-01）：先以 root 建好並交給執行帳號，讓 compose 掛載的 named volume
# 首次掛載即繼承可寫 owner（1001:1001）。UPLOAD_DIR 於 compose 設為 /data/uploads（見 docker-compose.yml）。
RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
