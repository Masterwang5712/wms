#!/usr/bin/env bash
# 耗材与设备管理仓库系统 —— 一键启动脚本
set -e

cd "$(dirname "$0")"

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"

echo "================================================"
echo "  耗材与设备管理仓库系统"
echo "================================================"

# Python 版本检查
if ! command -v python3 >/dev/null 2>&1; then
  echo "[错误] 未找到 python3，请先安装 Python 3.9+"
  exit 1
fi
PY_VER=$(python3 -c 'import sys;print("%d.%d"%sys.version_info[:2])')
echo "[1/3] Python 版本：$PY_VER"

# 依赖检查（仅检查，不强制联网安装）
MISSING=""
for mod in fastapi uvicorn openpyxl; do
  python3 -c "import $mod" 2>/dev/null || MISSING="$MISSING $mod"
done
if [ -n "$MISSING" ]; then
  echo "[提示] 检测到缺少依赖：$MISSING"
  echo "       尝试安装（需要联网）…"
  python3 -m pip install fastapi uvicorn openpyxl || {
    echo "[错误] 依赖安装失败，请手动执行： pip install fastapi uvicorn openpyxl"
    exit 1
  }
else
  echo "[2/3] 依赖检查通过（fastapi / uvicorn / openpyxl）"
fi

# 端口占用检测：若被占用则自动回退
if command -v ss >/dev/null 2>&1 && ss -tln 2>/dev/null | grep -q ":$PORT "; then
  echo "[提示] 端口 $PORT 已被占用，尝试使用 $((PORT + 1))"
  PORT=$((PORT + 1))
fi

echo "[3/3] 启动服务 http://localhost:$PORT"
echo ""
echo "默认演示账号："
echo "  admin  / admin123   系统管理员（全权限）"
echo "  keeper / keeper123  仓库管理员（出入库/设备/报表）"
echo "  user   / user123    普通用户（领用/查看）"
echo ""
echo "接口文档：http://localhost:$PORT/docs"
echo "按 Ctrl+C 停止服务"
echo "================================================"
echo ""

exec python3 -m uvicorn backend.main:app --host "$HOST" --port "$PORT"
