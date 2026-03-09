#!/usr/bin/env bash
set -euo pipefail

# ==========================================================
# QQ Farm Bot UI - One-Click Install / Update / Manage Script
# Repo: https://github.com/Penty-d/qq-farm-bot-ui
#
# Features:
# - Auto install Docker + docker compose
# - Configure 1ms Docker registry mirror: https://docker.1ms.run
# - GitHub pull/clone fallback (CN-friendly): default ghproxy
# - First install: choose host port + panel password
# - Re-run: detect updates, update, rebuild & restart
#
# Notes:
# - Menu is NO-COLOR (stable display everywhere)
# - Other logs use "stable color": only enabled when terminal supports it
# ==========================================================

# -------------------------
# Config (override by env)
# -------------------------
REPO_URL_PRIMARY="${REPO_URL_PRIMARY:-https://github.com/Penty-d/qq-farm-bot-ui.git}"
REPO_URL_FALLBACK="${REPO_URL_FALLBACK:-https://ghproxy.com/${REPO_URL_PRIMARY}}"

BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/qq-farm-bot-ui}"

# Project defaults
PANEL_PORT_DEFAULT="${PANEL_PORT_DEFAULT:-3000}"
ADMIN_PASSWORD_DEFAULT="${ADMIN_PASSWORD_DEFAULT:-admin}"

# Docker mirror
DOCKER_MIRROR_URL="${DOCKER_MIRROR_URL:-https://docker.1ms.run}"

# Summary behavior
SHOW_PASSWORD_IN_SUMMARY="${SHOW_PASSWORD_IN_SUMMARY:-1}"

# Stable color switches:
# - NO_COLOR=1    -> force disable
# - FORCE_COLOR=1 -> force enable (may show escape codes in some environments)
NO_COLOR="${NO_COLOR:-0}"
FORCE_COLOR="${FORCE_COLOR:-0}"

# -------------------------
# Stable color (robust)
# -------------------------
supports_color() {
  [[ "$FORCE_COLOR" == "1" ]] && return 0
  [[ "$NO_COLOR" == "1" ]] && return 1
  [[ -t 1 ]] || return 1
  [[ "${TERM:-}" != "dumb" ]] || return 1

  if command -v tput >/dev/null 2>&1; then
    local ncolors
    ncolors="$(tput colors 2>/dev/null || echo 0)"
    [[ "$ncolors" =~ ^[0-9]+$ ]] || ncolors=0
    (( ncolors >= 8 )) || return 1
  fi
  return 0
}

init_styles() {
  if supports_color; then
    RED=$'\033[31m'
    GREEN=$'\033[32m'
    YELLOW=$'\033[33m'
    BLUE=$'\033[34m'
    CYAN=$'\033[36m'
    BOLD=$'\033[1m'
    DIM=$'\033[2m'
    RESET=$'\033[0m'
  else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; CYAN=''; BOLD=''; DIM=''; RESET=''
  fi
}

init_styles

# -------------------------
# UI helpers (printf only)
# -------------------------
hr()   { printf '%s\n' "${DIM}------------------------------------------------------------${RESET}"; }
title(){ printf '\n%s\n' "${BOLD}${CYAN}==> $*${RESET}"; }
ok()   { printf '%s\n' "${GREEN}[OK]${RESET} $*"; }
info() { printf '%s\n' "${BLUE}[INFO]${RESET} $*"; }
warn() { printf '%s\n' "${YELLOW}[WARN]${RESET} $*" >&2; }
die()  { printf '%s\n' "${RED}[ERROR]${RESET} $*" >&2; exit 1; }

have_cmd() { command -v "$1" >/dev/null 2>&1; }

trap 'die "脚本在第 ${LINENO} 行执行失败：${BASH_COMMAND}"' ERR

# -------------------------
# Privilege helpers
# -------------------------
need_root_or_sudo() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    SUDO=""
  else
    have_cmd sudo || die "需要 root 权限或 sudo。请使用 root 运行或先安装 sudo。"
    SUDO="sudo"
  fi
}

repo_user() {
  # prefer original user if running via sudo
  local u="${SUDO_USER:-$USER}"
  [[ -n "$u" ]] || u="root"
  printf '%s' "$u"
}

run_as_repo_user() {
  # run command as repo user if possible (helps avoid root-owned git dirs)
  local u
  u="$(repo_user)"
  if [[ -n "${SUDO:-}" && "$u" != "root" ]]; then
    sudo -u "$u" bash -lc "$*"
  else
    bash -lc "$*"
  fi
}

# -------------------------
# Safe FS helpers (P0 fix)
# -------------------------
assert_safe_install_dir() {
  local dir="$1"

  [[ -n "$dir" ]] || die "INSTALL_DIR 为空，拒绝继续。"
  [[ "$dir" == /* ]] || die "INSTALL_DIR 必须为绝对路径：$dir"

  # 防止误设为顶级目录导致灾难性 chown/rm 等风险
  case "$dir" in
    "/"|"/opt"|"/usr"|"/bin"|"/sbin"|"/lib"|"/lib64"|"/etc"|"/var"|"/root"|"/home")
      die "INSTALL_DIR 指向危险目录：$dir（拒绝继续）"
      ;;
  esac
}

safe_chown_install_dir() {
  local dir="$1"
  local u="$2"

  [[ "$u" != "root" ]] || return 0

  assert_safe_install_dir "$dir"
  $SUDO chown -R -- "$u":"$u" "$dir" >/dev/null 2>&1 || true
}

# -------------------------
# Safe .env reader (P1 fix: NO source)
# -------------------------
read_env_value() {
  # Usage: read_env_value "/path/.env" "KEY"
  # Output: value to stdout; return 0 if found else 1
  local file="$1"
  local key="$2"
  [[ -f "$file" ]] || return 1

  local line val
  line="$(
    grep -E "^[[:space:]]*${key}[[:space:]]*=" "$file" 2>/dev/null \
      | grep -Ev "^[[:space:]]*#" \
      | tail -n 1 \
      || true
  )"
  [[ -n "$line" ]] || return 1

  val="${line#*=}"

  # trim spaces
  val="${val#"${val%%[![:space:]]*}"}"
  val="${val%"${val##*[![:space:]]}"}"

  # remove wrapping quotes (one layer)
  if [[ "$val" =~ ^\".*\"$ ]]; then
    val="${val:1:${#val}-2}"
  elif [[ "$val" =~ ^\'.*\'$ ]]; then
    val="${val:1:${#val}-2}"
  fi

  printf '%s' "$val"
}

# -------------------------
# Package manager helpers
# -------------------------
install_pkg() {
  local pkgs=("$@")
  if have_cmd apt-get; then
    $SUDO apt-get update -y
    $SUDO apt-get install -y "${pkgs[@]}"
  elif have_cmd dnf; then
    $SUDO dnf install -y "${pkgs[@]}"
  elif have_cmd yum; then
    $SUDO yum install -y "${pkgs[@]}"
  else
    die "无法识别包管理器(apt/yum/dnf)。请手动安装：curl git python3"
  fi
}

ensure_basic_deps() {
  title "检查基础依赖"
  local need=()
  have_cmd curl || need+=("curl")
  have_cmd git || need+=("git")
  have_cmd python3 || need+=("python3")
  if (( ${#need[@]} > 0 )); then
    info "安装依赖：${need[*]}"
    install_pkg "${need[@]}"
  else
    ok "基础依赖已就绪（curl/git/python3）"
  fi
}

# -------------------------
# Docker install & compose
# -------------------------
ensure_docker_installed() {
  title "检查 / 安装 Docker"
  if have_cmd docker; then
    ok "Docker 已安装：$(docker --version 2>/dev/null || true)"
    return 0
  fi

  info "未检测到 Docker，开始安装（get.docker.com）"
  curl -fsSL https://get.docker.com | $SUDO sh

  if have_cmd systemctl; then
    $SUDO systemctl enable docker >/dev/null 2>&1 || true
    $SUDO systemctl restart docker >/dev/null 2>&1 || true
  else
    $SUDO service docker restart >/dev/null 2>&1 || true
  fi

  have_cmd docker || die "Docker 安装失败，请检查网络/系统。"
  ok "Docker 安装完成：$(docker --version 2>/dev/null || true)"
}

ensure_compose_available() {
  title "检查 docker compose"
  if docker compose version >/dev/null 2>&1; then
    ok "docker compose 可用：$(docker compose version 2>/dev/null | head -n 1 || true)"
    return 0
  fi

  warn "未检测到 docker compose，尝试安装 docker-compose-plugin"
  install_pkg docker-compose-plugin || true

  docker compose version >/dev/null 2>&1 || die "docker compose 仍不可用，请手动安装 Docker Compose v2 插件。"
  ok "docker compose 已安装：$(docker compose version 2>/dev/null | head -n 1 || true)"
}

configure_docker_mirror() {
  title "配置 Docker 镜像加速器（1ms）"
  info "写入 registry-mirrors：${DOCKER_MIRROR_URL}"
  $SUDO mkdir -p /etc/docker

  $SUDO python3 - <<PY
import json, os
path = "/etc/docker/daemon.json"
mirror = "${DOCKER_MIRROR_URL}"

data = {}
if os.path.exists(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read().strip()
            if content:
                data = json.loads(content)
    except Exception:
        data = {}

mirrors = data.get("registry-mirrors", [])
if not isinstance(mirrors, list):
    mirrors = []

if mirror not in mirrors:
    mirrors.insert(0, mirror)

data["registry-mirrors"] = mirrors

tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

os.replace(tmp, path)
print("OK:", path)
PY

  if have_cmd systemctl; then
    $SUDO systemctl daemon-reload >/dev/null 2>&1 || true
    $SUDO systemctl restart docker >/dev/null 2>&1 || true
  else
    $SUDO service docker restart >/dev/null 2>&1 || true
  fi

  ok "镜像加速器已配置完成（/etc/docker/daemon.json）等待docker重启完成后进行下一步操作"
}

ensure_docker_group() {
  title "配置 Docker 用户组（可选）"
  local u
  u="$(repo_user)"
  if [[ "$u" == "root" ]]; then
    info "当前为 root 或无法识别普通用户，跳过 docker 组配置"
    return 0
  fi

  if getent group docker >/dev/null 2>&1; then
    if id -nG "$u" | tr ' ' '\n' | grep -qx docker; then
      ok "用户 ${u} 已在 docker 组"
    else
      warn "将用户 ${u} 加入 docker 组（可能需要重新登录生效）"
      $SUDO usermod -aG docker "$u" || true
      ok "已尝试添加 ${u} 到 docker 组"
    fi
  else
    warn "docker 组不存在？跳过"
  fi
}

# -------------------------
# Input helpers
# -------------------------
prompt_value() {
  local prompt="$1"
  local def="$2"
  local __outvar="$3"
  local val=""
  read -r -p "${prompt} (默认: ${def}): " val || true
  val="${val:-$def}"
  printf -v "$__outvar" "%s" "$val"
}

validate_port() {
  local p="$1"
  [[ "$p" =~ ^[0-9]+$ ]] || return 1
  (( p >= 1 && p <= 65535 )) || return 1
  return 0
}

# -------------------------
# Git with fallback
# -------------------------
git_clone_with_fallback() {
  # $1 branch, $2 dir
  local branch="$1"
  local dir="$2"

  title "拉取项目代码"
  info "主地址：${REPO_URL_PRIMARY}"
  if run_as_repo_user "git clone -b '${branch}' '${REPO_URL_PRIMARY}' '${dir}'"; then
    ok "克隆成功（主地址）"
    return 0
  fi

  warn "主地址克隆失败，尝试备用地址：${REPO_URL_FALLBACK}"
  run_as_repo_user "git clone -b '${branch}' '${REPO_URL_FALLBACK}' '${dir}'"
  ok "克隆成功（备用地址）"
}

git_remote_head_hash() {
  # $1 url, $2 branch
  local url="$1"
  local branch="$2"
  git ls-remote --heads "$url" "$branch" 2>/dev/null | awk '{print $1}' | head -n 1 || true
}

git_pull_rebase_with_fallback() {
  # run inside repo dir
  local branch="$1"

  if run_as_repo_user "cd '${INSTALL_DIR}' && git pull --rebase '${REPO_URL_PRIMARY}' '${branch}'"; then
    return 0
  fi

  warn "从主地址 pull 失败，改用备用地址 pull：${REPO_URL_FALLBACK}"
  run_as_repo_user "cd '${INSTALL_DIR}' && git pull --rebase '${REPO_URL_FALLBACK}' '${branch}'"
}

# -------------------------
# Repo / compose operations
# -------------------------
prepare_install_dir() {
  title "准备安装目录"
  info "安装目录：${INSTALL_DIR}"

  assert_safe_install_dir "$INSTALL_DIR"

  # P0 fix: only mkdir INSTALL_DIR itself
  $SUDO mkdir -p -- "$INSTALL_DIR"

  # P0 fix: only chown INSTALL_DIR itself
  local u
  u="$(repo_user)"
  safe_chown_install_dir "$INSTALL_DIR" "$u"

  ok "目录准备完成"
}

clone_or_keep_repo() {
  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    ok "检测到已存在仓库：${INSTALL_DIR}"
    return 0
  fi

  prepare_install_dir
  git_clone_with_fallback "$BRANCH" "$INSTALL_DIR"
}

write_override_compose() {
  local panel_port="$1"
  local admin_password="$2"

  title "写入运行配置"
  info "写入：${INSTALL_DIR}/.env"
  cat > "${INSTALL_DIR}/.env" <<EOF
# Generated by qq-farm-bot-ui.sh
ADMIN_PASSWORD=${admin_password}
EOF

  info "写入：${INSTALL_DIR}/docker-compose.override.yml（端口映射 + 环境变量覆盖）"
  cat > "${INSTALL_DIR}/docker-compose.override.yml" <<EOF
services:
  qq-farm-bot-ui:
    environment:
      ADMIN_PASSWORD: "\${ADMIN_PASSWORD}"
    ports:
      - "${panel_port}:3000"
EOF

  ok "配置文件写入完成"
}

compose_up() {
  title "构建并启动（docker compose up -d --build）"
  (cd "$INSTALL_DIR" && docker compose up -d --build)
  ok "容器已启动"
}

compose_down() {
  title "停止并删除容器（docker compose down）"
  (cd "$INSTALL_DIR" && docker compose down) || true
  ok "容器已停止"
}

compose_logs() {
  title "查看日志（tail=200）"
  (cd "$INSTALL_DIR" && docker compose logs -f --tail=200)
}

compose_ps() {
  title "查看状态（docker compose ps）"
  (cd "$INSTALL_DIR" && docker compose ps)
}

detect_and_update_repo() {
  title "检测并更新项目"

  (cd "$INSTALL_DIR" && git rev-parse --is-inside-work-tree >/dev/null 2>&1) || die "目录不是 git 仓库：${INSTALL_DIR}"

  local local_head remote_head_primary remote_head_fallback remote_head
  local_head="$(cd "$INSTALL_DIR" && git rev-parse HEAD)"
  info "当前版本：${local_head:0:7}"

  remote_head_primary="$(git_remote_head_hash "$REPO_URL_PRIMARY" "$BRANCH")"
  remote_head_fallback="$(git_remote_head_hash "$REPO_URL_FALLBACK" "$BRANCH")"

  if [[ -n "$remote_head_primary" ]]; then
    remote_head="$remote_head_primary"
    info "远端版本（主地址）：${remote_head:0:7}"
  elif [[ -n "$remote_head_fallback" ]]; then
    remote_head="$remote_head_fallback"
    warn "主地址无法获取远端版本，使用备用地址远端版本：${remote_head:0:7}"
  else
    warn "无法获取远端版本（主/备均失败）。将直接尝试 pull（主失败再备）。"
    remote_head=""
  fi

  if [[ -n "$remote_head" && "$local_head" == "$remote_head" ]]; then
    ok "已是最新，无需更新"
    return 1
  fi

  if [[ -n "$(cd "$INSTALL_DIR" && git status --porcelain)" ]]; then
    warn "检测到本地有未提交修改，更新可能覆盖改动。"
    read -r -p "仍要继续更新吗？(y/N): " ans || true
    if [[ "${ans:-}" != "y" && "${ans:-}" != "Y" ]]; then
      warn "已取消更新"
      return 2
    fi
  fi

  info "开始更新（git pull --rebase）..."
  git_pull_rebase_with_fallback "$BRANCH"
  ok "更新完成：$(cd "$INSTALL_DIR" && git rev-parse HEAD | cut -c1-7)"
  return 0
}

read_current_settings_for_summary() {
  PANEL_PORT="${PANEL_PORT:-$PANEL_PORT_DEFAULT}"
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-$ADMIN_PASSWORD_DEFAULT}"

  # P1 fix: do NOT source .env
  if [[ -f "${INSTALL_DIR}/.env" ]]; then
    local pw
    pw="$(read_env_value "${INSTALL_DIR}/.env" "ADMIN_PASSWORD" || true)"
    if [[ -n "${pw:-}" ]]; then
      ADMIN_PASSWORD="$pw"
    fi
  fi

  if [[ -f "${INSTALL_DIR}/docker-compose.override.yml" ]]; then
    local p
    p="$(awk -F'[:"]+' '/- *[0-9]+:3000/{gsub(/ /,""); print $2; exit}' "${INSTALL_DIR}/docker-compose.override.yml" || true)"
    PANEL_PORT="${p:-$PANEL_PORT_DEFAULT}"
  fi
}

final_summary() {
  local panel_port="$1"
  local admin_password="$2"

  title "最终信息汇总"
  hr
  printf '%s\n' "安装目录: ${INSTALL_DIR}"
  printf '%s\n' "面板地址: http://<服务器IP>:${panel_port}/"
  printf '%s\n' "面板端口: ${panel_port} (宿主机 -> 容器 3000)"
  if [[ "${SHOW_PASSWORD_IN_SUMMARY}" == "1" ]]; then
    printf '%s\n' "面板密码: ${admin_password}"
    printf '%s\n' "提示: 注意终端回显/历史记录风险。可修改 SHOW_PASSWORD_IN_SUMMARY=0 关闭明文密码输出。"
  else
    printf '%s\n' "面板密码: (已隐藏；可查看 ${INSTALL_DIR}/.env)"
  fi
  printf '%s\n' "Docker 镜像加速器: ${DOCKER_MIRROR_URL}"
  printf '%s\n' "Git 主地址: ${REPO_URL_PRIMARY}"
  printf '%s\n' "Git 备用地址: ${REPO_URL_FALLBACK}"
  hr
  printf '%s\n' "常用命令："
  printf '%s\n' "  - 查看状态：cd ${INSTALL_DIR} && docker compose ps"
  printf '%s\n' "  - 查看日志：cd ${INSTALL_DIR} && docker compose logs -f --tail=200"
  printf '%s\n' "  - 更新项目：重新运行脚本选择【2】"
  hr
}

# -------------------------
# Menu (NO COLOR)
# -------------------------
show_menu() {
  cat <<'EOF'

===============================
 QQ Farm Bot UI 一键脚本菜单 By:acewinner1999
===============================
1) 安装/初始化并启动（自动安装 Docker 添加镜像加速器 并安装QQ农场绿玩面板）
2) 检测并更新项目（如有更新则重建并重启）
3) 启动容器（docker compose up -d --build）
4) 停止容器（docker compose down）
5) 查看日志（docker compose logs -f）
6) 查看状态（docker compose ps）
0) 退出

EOF
}

print_banner() {
  hr
  printf '%s\n' "QQ Farm Bot UI 一键脚本 By:acewinner1999"
  printf '%s\n' "Repo:     ${REPO_URL_PRIMARY}"
  printf '%s\n' "Fallback: ${REPO_URL_FALLBACK}"
  hr
}

# -------------------------
# Main
# -------------------------
main() {
  print_banner
  need_root_or_sudo
  ensure_basic_deps

  while true; do
    show_menu
    read -r -p "请选择操作: " choice || true
    case "${choice:-}" in
      1)
        ensure_docker_installed
        ensure_compose_available
        configure_docker_mirror
        ensure_docker_group

        clone_or_keep_repo

        title "初始化参数（端口/密码）"
        PANEL_PORT="${PANEL_PORT:-}"
        ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

        if [[ -z "${PANEL_PORT}" ]]; then
          prompt_value "请输入面板映射端口（宿主机端口 1-65535）" "$PANEL_PORT_DEFAULT" PANEL_PORT
        fi
        until validate_port "$PANEL_PORT"; do
          warn "端口不合法：$PANEL_PORT"
          prompt_value "请重新输入面板映射端口（1-65535）" "$PANEL_PORT_DEFAULT" PANEL_PORT
        done

        if [[ -z "${ADMIN_PASSWORD}" ]]; then
          prompt_value "请输入面板管理员密码（将写入 .env）" "$ADMIN_PASSWORD_DEFAULT" ADMIN_PASSWORD
        fi

        write_override_compose "$PANEL_PORT" "$ADMIN_PASSWORD"
        compose_up
        final_summary "$PANEL_PORT" "$ADMIN_PASSWORD"
        ;;
      2)
        [[ -d "${INSTALL_DIR}/.git" ]] || { warn "未找到仓库：${INSTALL_DIR}（请先执行 1 安装）"; continue; }

        if detect_and_update_repo; then
          warn "检测到更新，开始重建并重启..."
          compose_up
        else
          info "无需更新或更新被取消"
        fi

        PANEL_PORT=""
        ADMIN_PASSWORD=""
        read_current_settings_for_summary
        final_summary "$PANEL_PORT" "$ADMIN_PASSWORD"
        ;;
      3)
        [[ -d "${INSTALL_DIR}/.git" ]] || { warn "未找到仓库：${INSTALL_DIR}（请先执行 1 安装）"; continue; }
        compose_up

        PANEL_PORT=""
        ADMIN_PASSWORD=""
        read_current_settings_for_summary
        final_summary "$PANEL_PORT" "$ADMIN_PASSWORD"
        ;;
      4)
        [[ -d "${INSTALL_DIR}/.git" ]] || { warn "未找到仓库：${INSTALL_DIR}"; continue; }
        compose_down
        ;;
      5)
        [[ -d "${INSTALL_DIR}/.git" ]] || { warn "未找到仓库：${INSTALL_DIR}"; continue; }
        compose_logs
        ;;
      6)
        [[ -d "${INSTALL_DIR}/.git" ]] || { warn "未找到仓库：${INSTALL_DIR}"; continue; }
        compose_ps
        ;;
      0)
        exit 0
        ;;
      *)
        warn "无效选择：${choice:-}"
        ;;
    esac
  done
}

main "$@"
