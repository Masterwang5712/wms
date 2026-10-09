"""全局配置常量。"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# 数据库
DB_PATH = os.environ.get("WMS_DB", str(BASE_DIR / "app.db"))
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"
FRONTEND_DIR = BASE_DIR / "frontend"

# 服务
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))

# 业务阈值
CALIBRATION_WARN_DAYS = int(os.environ.get("CALIBRATION_WARN_DAYS", "30"))  # 校准临期天数
BORROW_WARN_DAYS = int(os.environ.get("BORROW_WARN_DAYS", "3"))             # 借用到期的提醒天数

# 角色
ROLE_ADMIN = "admin"
ROLE_KEEPER = "keeper"
ROLE_DEPT_USER = "dept_user"

ROLE_LABELS = {
    ROLE_ADMIN: "系统管理员",
    ROLE_KEEPER: "仓库管理员",
    ROLE_DEPT_USER: "普通用户",
}

# 设备状态
DEVICE_STATUS = {
    "in_use": "在用",
    "idle": "闲置",
    "repairing": "维修中",
    "borrowed": "借出",
    "scrapped": "已报废",
}

# 物品类型
ITEM_TYPES = {"consumable": "耗材", "device": "设备"}

# Token 有效期（小时）
TOKEN_TTL_HOURS = int(os.environ.get("TOKEN_TTL_HOURS", "24"))
