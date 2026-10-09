"""密码哈希、Token 生成与角色校验（轻量演示级鉴权）。"""
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, Header

from .config import ROLE_ADMIN, ROLE_KEEPER, ROLE_DEPT_USER, TOKEN_TTL_HOURS
from .db import get_conn, query_one
from .utils import now_str

_ITER = 120_000


def hash_password(password: str, salt: str | None = None) -> str:
    """PBKDF2-HMAC-SHA256，格式：pbkdf2$salt$hash。"""
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _ITER)
    return f"pbkdf2${salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    if not stored:
        return False
    # 兼容早期纯 sha256 格式
    if not stored.startswith("pbkdf2$"):
        return hmac.compare_digest(hashlib.sha256(password.encode()).hexdigest(), stored)
    try:
        _, salt, expected = stored.split("$", 2)
    except ValueError:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _ITER)
    return hmac.compare_digest(dk.hex(), expected)


def create_token(conn, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = (datetime.now() + timedelta(hours=TOKEN_TTL_HOURS)).strftime("%Y-%m-%d %H:%M:%S")
    conn.execute(
        "INSERT INTO sys_token(token, user_id, expires_at, created_at) VALUES(?,?,?,?)",
        (token, user_id, expires, now_str()),
    )
    # 清理过期 token
    conn.execute("DELETE FROM sys_token WHERE expires_at < ?", (now_str(),))
    return token


def revoke_token(conn, token: str) -> None:
    conn.execute("DELETE FROM sys_token WHERE token=?", (token,))


def _extract_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return authorization.strip() or None


def current_user(
    authorization: str | None = Header(default=None),
    conn=Depends(get_conn),
) -> dict:
    """依赖：解析 Bearer Token 得到当前用户。"""
    token = _extract_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="未登录，请先登录")
    row = query_one(conn, """
        SELECT u.*, d.name AS department_name, t.expires_at AS token_expires_at
        FROM sys_token t JOIN sys_user u ON u.id = t.user_id
        LEFT JOIN org_department d ON d.id = u.department_id
        WHERE t.token = ?
    """, (token,))
    if not row:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录")
    expires = datetime.strptime(row["token_expires_at"], "%Y-%m-%d %H:%M:%S")
    if expires < datetime.now():
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    if row.get("status") != "active" or row.get("is_deleted"):
        raise HTTPException(status_code=403, detail="账号已停用")
    row["token"] = token
    row.pop("password_hash", None)
    return row


def require_roles(*roles: str):
    """依赖工厂：要求当前用户属于指定角色之一。"""
    def _checker(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="当前账号无此操作权限")
        return user
    return _checker


# 常用角色组合
require_admin = require_roles(ROLE_ADMIN)
require_keeper = require_roles(ROLE_ADMIN, ROLE_KEEPER)
require_login = require_roles(ROLE_ADMIN, ROLE_KEEPER, ROLE_DEPT_USER)
