#!/usr/bin/env python3
"""通过 GitHub Git Data API 推送完整提交（绕开被阻断的 git 传输通道）。"""
import base64
import json
import os
import subprocess
import sys

REPO = "Masterwang5712/wms"


def gh(method, path, data=None):
    """调用 gh api。"""
    cmd = ["gh", "api", path, "-X", method]
    if data is not None:
        cmd += ["--input", "-"]
    r = subprocess.run(cmd, input=json.dumps(data) if data is not None else None,
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(f"!! {method} {path} 失败:\n{r.stderr[:600]}", file=sys.stderr)
        sys.exit(1)
    return json.loads(r.stdout) if r.stdout.strip() else {}


def ls_files():
    """列出要提交的文件（遵循 .gitignore，排除运行时产物）。"""
    out = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout
    return [f for f in out.splitlines() if f.strip()]


def main():
    files = ls_files()
    print(f"待推送文件：{len(files)} 个")

    # 1) 为每个文件创建 blob
    blobs = []
    for i, f in enumerate(files, 1):
        with open(f, "rb") as fh:
            content = base64.b64encode(fh.read()).decode()
        res = gh("POST", f"repos/{REPO}/git/blobs",
                 {"content": content, "encoding": "base64"})
        blobs.append({"path": f, "mode": "100755" if os.access(f, os.X_OK) else "100644",
                      "type": "blob", "sha": res["sha"]})
        print(f"  [{i}/{len(files)}] {f}")

    # 2) 创建 tree
    tree = gh("POST", f"repos/{REPO}/git/trees",
              {"tree": blobs})
    print(f"tree 已创建: {tree['sha']}")

    # 3) 取 main 当前 head（若存在）
    parents = []
    r = subprocess.run(["gh", "api", f"repos/{REPO}/git/ref/heads/main"],
                       capture_output=True, text=True)
    if r.returncode == 0 and r.stdout.strip():
        try:
            parents = [json.loads(r.stdout)["object"]["sha"]]
        except Exception:
            pass

    msg = """feat: 耗材与设备管理仓库系统 v1.0.0

面向企业/单位内部仓库的前后端一体管理系统。

功能模块：数据看板、物品档案、实时库存、出入库管理、领用与消耗统计、
设备台账（状态机+履历）、借用归还、维保记录、校准提醒、统计报表、
基础数据、Excel 导出（8 个业务台账）。

技术栈：FastAPI + Python 标准库 sqlite3（零 ORM）｜ 原生 JS SPA（零 CDN）
｜ PBKDF2 + Token 三角色 RBAC ｜ BEGIN IMMEDIATE 事务保证库存原子性。

部署：start.sh 一键启动 / systemd 常驻 / Dockerfile 容器化。"""

    commit = gh("POST", f"repos/{REPO}/git/commits",
                {"message": msg, "tree": tree["sha"], "parents": parents})
    print(f"commit 已创建: {commit['sha']}")

    # 4) 创建/更新 ref
    if parents:
        gh("PATCH", f"repos/{REPO}/git/refs/heads/main",
           {"sha": commit["sha"], "force": True})
    else:
        gh("POST", f"repos/{REPO}/git/refs",
           {"ref": "refs/heads/main", "sha": commit["sha"]})
    print(f"\n✅ 推送完成: https://github.com/{REPO}")
    print(f"   commit: {commit['sha'][:10]}  文件: {len(files)}")


if __name__ == "__main__":
    main()
