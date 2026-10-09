"""通用工具：日期、编号生成、分页。"""
import random
import string
from datetime import date, datetime, timedelta


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today_str() -> str:
    return date.today().isoformat()


def add_days(date_s: str | None, days: int) -> str | None:
    """在 YYYY-MM-DD 上加天数。"""
    if not date_s:
        return None
    try:
        d = datetime.strptime(date_s[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None
    return (d + timedelta(days=days)).isoformat()


def days_between(date_s: str | None, base: str | None = None) -> int | None:
    """date_s 与 base（默认今天）相差天数，date_s 在后为正。"""
    if not date_s:
        return None
    try:
        d = datetime.strptime(str(date_s)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None
    b = datetime.strptime(base, "%Y-%m-%d").date() if base else date.today()
    return (d - b).days


def gen_order_no(prefix: str) -> str:
    """生成单据编号：前缀 + 日期时间 + 4 位随机，避免并发重复。"""
    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    rnd = "".join(random.choices(string.digits, k=4))
    return f"{prefix}{ts}{rnd}"


def gen_item_code(prefix: str, seq: int) -> str:
    return f"{prefix}{seq:05d}"


def month_range(year: int, month: int) -> tuple[str, str]:
    """返回该月起止日期（含）。"""
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end = date(year, month + 1, 1) - timedelta(days=1)
    return start.isoformat(), end.isoformat()


def paginate(items: list, page: int, size: int) -> dict:
    """内存分页（列表已在 SQL 层过滤/排序）。"""
    page = max(1, page or 1)
    size = max(1, min(size or 20, 500))
    total = len(items)
    start = (page - 1) * size
    return {
        "items": items[start:start + size],
        "total": total,
        "page": page,
        "size": size,
        "pages": max(1, (total + size - 1) // size),
    }


def round2(x) -> float:
    try:
        return round(float(x or 0), 2)
    except (TypeError, ValueError):
        return 0.0
