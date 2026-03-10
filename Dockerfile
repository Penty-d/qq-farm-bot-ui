# 使用 Node.js 20 官方镜像作为基础
FROM node:20-slim AS builder

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# 复制依赖配置文件
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY core/package.json ./core/
COPY web/package.json ./web/

# 安装所有依赖
RUN pnpm install

# 复制所有源代码
COPY . .

# 构建前端 Web 产物
RUN pnpm build:web

# --- 运行阶段 ---
FROM node:20-slim

WORKDIR /app

# 从构建阶段拷贝必要文件
COPY --from=builder /app/core ./core
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# 设置环境变量（默认生产环境）
ENV NODE_ENV=production

# 暴露端口
EXPOSE 3000

# 启动命令 (对应 package.json 中的 dev:core 或类似启动脚本)
CMD ["node", "core/client.js"]
