#!/usr/bin/env python3
"""
通过 GitHub Git Data API 推送代码，绕开被阻断的 git 传输通道（443/22）。

适用场景：
  - 内网/沙箱环境无法直连 github.com:443，`git push` 超时
  - 但 `gh` CLI 的 API 通道可用（走内部代理）

原理：
  逐个文件创建 blob → 组装 tree → 创建 commit → 更新 ref，
  全部通过 HTTPS API 完成，不依赖 git 协议传输。

安全设计（重要）：
  默认会先拉取远端分支已有的文件树并与本地合并，
  仅覆盖同名文件、保留远端独有文件（如网页上添加的 workflow、README 等），
  避免"全量 tree 覆盖"导致远端文件被误删。
  --mirror 可显式关闭该保护（使远端与本地完全一致，会删除远端独有文件）。

依赖：
  - gh CLI 已登录：echo "<token>" | gh auth login --with-token
  - Token 需要 repo 权限

用法：
  # 推送当前目录（自动识别 git 跟踪的文件）
  python3 deploy/push_via_api.py --repo <owner>/<name>

  # 指定分支与提交信息
  python3 deploy/push_via_api.py --repo owner/name --branch main -m "feat: xxx"

  # 仓库不存在时自动创建（私有）
  python3 deploy/push_via_api.py --repo owner/name --create

  # 首次推送 / 清空历史
  python3 deploy/push_via_api.py --repo owner/name --force
"""
import argparse
import base64
import json
import os
import subprocess
import sys


def _run_gh(method, path, data=None, check=True, retries=3):
    """调用 gh api。网络类错误（5xx/连接失败/404抖动）自动重试。"""
    last_err = ""
    for attempt in range(1, retries + 1):
        cmd = ["gh", "api", path, "-X", method]
        if data is not None:
            cmd += ["--input", "-"]
        r = subprocess.run(
            cmd,
            input=json.dumps(data) if data is not None else None,
            capture_output=True,
            text=True,
        )
        if r.returncode == 0:
            return json.loads(r.stdout) if r.stdout.strip() else {}
        last_err = r.stderr
        # 内容类错误（422 参数不合法）不重试，其余重试
        if "422" in r.stderr:
            break
        if attempt < retries:
            import time
            time.sleep(2 * attempt)
    if check:
        print(f"!! {method} {path} 失败（已重试 {retries} 次）:\n{last_err[:800]}", file=sys.stderr)
        sys.exit(1)
    return None


def gh(method, path, data=None):
    return _run_gh(method, path, data, check=True)


def gh_ok(method, path, data=None):
    """失败返回 None（用于探测是否存在）。"""
    return _run_gh(method, path, data, check=False)


def list_files():
    """列出 git 跟踪的文件（自动遵循 .gitignore）。"""
    r = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True)
    files = [f for f in r.stdout.splitlines() if f.strip()]
    if not files:
        print("!! 没有可提交的文件（git ls-files 为空）。请先 git add。", file=sys.stderr)
        sys.exit(1)
    return files


def fetch_remote_tree(repo, branch):
    """拉取远端分支已有文件 → {路径: (mode, sha)}。用于合并保护。"""
    ref = gh_ok("GET", f"repos/{repo}/git/ref/heads/{branch}")
    if not ref or not ref.get("object", {}).get("sha"):
        return {}  # 分支还不存在
    tree = gh_ok("GET", f"repos/{repo}/git/trees/{ref['object']['sha']}?recursive=1")
    if not tree:
        return {}
    return {t["path"]: (t.get("mode", "100644"), t["sha"])
            for t in tree.get("tree", []) if t["type"] == "blob"}


def main():
    ap = argparse.ArgumentParser(description="通过 Git Data API 推送代码到 GitHub")
    ap.add_argument("--repo", required=True, help="仓库全名，如 owner/name")
    ap.add_argument("--branch", default="main", help="分支名（默认 main）")
    ap.add_argument("-m", "--message", default="chore: 通过 API 推送更新", help="提交信息")
    ap.add_argument("--create", action="store_true", help="仓库不存在时自动创建")
    ap.add_argument("--public", action="store_true", help="创建公开仓库（默认私有）")
    ap.add_argument("--force", action="store_true",
                    help="丢弃远端历史，重建为单条提交（首次推送/清空历史用）")
    ap.add_argument("--mirror", action="store_true",
                    help="使远端与本地完全一致（会删除远端独有文件，慎用）")
    args = ap.parse_args()

    repo = args.repo

    # 0) 可选：确保仓库存在
    if gh_ok("GET", f"repos/{repo}") is None:
        if not args.create:
            print(f"!! 仓库 {repo} 不存在或无权访问。加 --create 可自动创建。", file=sys.stderr)
            sys.exit(1)
        print(f"创建{'公开' if args.public else '私有'}仓库 {repo} …")
        gh("POST", "user/repos",
           {"name": repo.split("/")[-1], "private": not args.public, "auto_init": False})
        print("  ✓ 已创建")

    # 1) 拉取远端已有文件（用于合并保护）
    remote = {} if (args.force or args.mirror) else fetch_remote_tree(repo, args.branch)
    if remote:
        print(f"远端已有 {len(remote)} 个文件，将保留其中本地不存在的部分")

    # 2) 逐个文件创建 blob
    files = list_files()
    print(f"待推送文件：{len(files)} 个")
    local_paths = set(files)
    entries = []
    for i, f in enumerate(files, 1):
        with open(f, "rb") as fh:
            content = base64.b64encode(fh.read()).decode()
        sha = gh("POST", f"repos/{repo}/git/blobs",
                 {"content": content, "encoding": "base64"})["sha"]
        mode = "100755" if os.access(f, os.X_OK) else "100644"
        entries.append({"path": f, "mode": mode, "type": "blob", "sha": sha})
        print(f"  [{i}/{len(files)}] {f}")

    # 3) 合并远端独有文件（保护：不删除远端有而本地没有的文件）
    kept = 0
    for path, (mode, sha) in remote.items():
        if path not in local_paths:
            entries.append({"path": path, "mode": mode, "type": "blob", "sha": sha})
            kept += 1
    if kept:
        print(f"  ✓ 保留 {kept} 个远端独有文件（避免误删）")

    # 4) 创建 tree
    tree = gh("POST", f"repos/{repo}/git/trees", {"tree": entries})
    print(f"tree: {tree['sha']}")

    # 5) 取 parent（--force 或分支不存在时不带 parent）
    parents = []
    if not args.force:
        ref = gh_ok("GET", f"repos/{repo}/git/ref/heads/{args.branch}")
        if ref and ref.get("object", {}).get("sha"):
            parents = [ref["object"]["sha"]]

    # 6) 创建 commit
    commit = gh("POST", f"repos/{repo}/git/commits",
                {"message": args.message, "tree": tree["sha"], "parents": parents})
    print(f"commit: {commit['sha']}")

    # 7) 创建或更新 ref
    if gh_ok("GET", f"repos/{repo}/git/ref/heads/{args.branch}") is not None:
        gh("PATCH", f"repos/{repo}/git/refs/heads/{args.branch}",
           {"sha": commit["sha"], "force": True})
    else:
        gh("POST", f"repos/{repo}/git/refs",
           {"ref": f"refs/heads/{args.branch}", "sha": commit["sha"]})

    print(f"\n✅ 推送完成: https://github.com/{repo}")
    print(f"   分支: {args.branch}   commit: {commit['sha'][:10]}   "
          f"文件: {len(files)}（另保留远端 {kept} 个）")


if __name__ == "__main__":
    main()
