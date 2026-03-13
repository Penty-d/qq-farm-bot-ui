#!/bin/bash

# *执行脚本前请先配置服务器环境, 如 git node pnpm

# 如需频繁 ssh 服务器, 可配置密钥
# ssh-copy-id -i ~/.ssh/id_rsa.pub user@server_ip

# 可本地直接执行
# ssh -p 22 user@server-ip "cd /your-path/qq-farm-bot-ui && bash restart.sh"

# 更新代码, 如遇 git 没有权限, 可根据提示执行, 注意路径要改成自己的
# git config --global --add safe.directory /your-path/qq-farm-bot-ui
# 或执行权限命令, 注意路径要改成自己的
# chmod -R $USER:$USER /your-path/qq-farm-bot-ui
echo -e "📥 代码拉取中... \n"
git pull --rebase

if [ $? -ne 0 ]; then
  echo "❌ 代码拉取失败"
  exit 1
fi
echo -e "✅ 代码已更新 \n"
sleep 1

# 构建前端页面
echo -e "📦 前端页面构建中... \n"
pnpm install
pnpm build:web

if [ $? -ne 0 ]; then
  echo "❌ 前端页面构建失败"
  exit 1
fi
echo -e "✅ 前端页面构建完成 \n"
sleep 1

# 停止旧进程
pkill -f "node client.js"
pkill -f "pnpm dev:core"

# 启动服务 实时查看: tail -f nohup-out.log
echo -e "🚀 服务启动中... \n"
nohup bash -c "pnpm dev:core" > nohup-out.log 2>&1 &

echo -e "✅ 服务已启动 \n"
