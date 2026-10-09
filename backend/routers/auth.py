"""认证：登录 / 登出 / 当前用户。"""
from fastapi import APIRouter, Depends, HTTPException

from ..config import ROLE_LABELS
from ..db import get_conn, query_one, transaction
from ..models.schemas import LoginIn
from ..security import current_user, create_token, revoke_token, verify_password
from ..utils import now_str

router = APIRouter(prefix="/auth", tags=["认证"])


@router.post("/login")
def login(body: LoginIn, conn=Depends(get_conn)):
    row = query_one(conn, """
        SELECT u.*, d.name AS department_name
        FROM sys_user u LEFT JOIN org_department d ON d.id = u.department_id
        WHERE u.username = ? AND u.is_deleted = 0
    """, (body.username.strip(),))
    if not row or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if row.get("status") != "active":
        raise HTTPException(status_code=403, detail="账号已停用，请联系管理员")

    with transaction(conn):
        token = create_token(conn, row["id"])
        conn.execute(
            "INSERT INTO sys_log(user_id, action, target_type, detail, created_at) VALUES(?,?,?,?,?)",
            (row["id"], "login", "user", f"{row['display_name']} 登录系统", now_str()))

    return {
        "token": token,
        "user": {
            "id": row["id"],
            "username": row["username"],
            "display_name": row["display_name"],
            "role": row["role"],
            "role_label": ROLE_LABELS.get(row["role"], row["role"]),
            "department_id": row["department_id"],
            "department_name": row["department_name"],
        },
    }


@router.post("/logout")
def logout(user: dict = Depends(current_user), conn=Depends(get_conn)):
    with transaction(conn):
        revoke_token(conn, user["token"])
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(current_user)):
    user["role_label"] = ROLE_LABELS.get(user["role"], user["role"])
    user.pop("token", None)
    return user
