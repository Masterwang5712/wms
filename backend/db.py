"""SQLite 连接管理与事务封装（标准库 sqlite3，零额外依赖）。"""
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .config import DB_PATH, SCHEMA_PATH

_initialized = False


def _connect() -> sqlite3.Connection:
    """创建一个新连接（每请求独立，避免跨线程共享）。

    check_same_thread=False：FastAPI 的同步依赖清理（generator 的 finally）
    由 ``contextmanager_in_threadpool`` 在**另一个线程池线程**中执行，与端点
    正文线程可能不同。每个请求仍然独占一个连接、不存在跨请求共享，因此放开
    同线程校验是安全的，否则会在连接关闭时抛 ProgrammingError。
    """
    conn = sqlite3.connect(
        DB_PATH, timeout=10, isolation_level=None, check_same_thread=False
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_conn() -> sqlite3.Connection:
    """FastAPI 依赖用：返回一个独立连接，请求结束后关闭。"""
    conn = _connect()
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def transaction(conn: sqlite3.Connection):
    """写事务：BEGIN IMMEDIATE 提前取写锁，避免并发写冲突与超卖。

    isolation_level=None 时 sqlite3 不会自动开启事务，需手动控制。
    """
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


@contextmanager
def write_txn():
    """一次性写事务（自带连接），适合服务函数内部使用。"""
    conn = _connect()
    try:
        with transaction(conn):
            yield conn
    finally:
        conn.close()


def init_db(force: bool = False) -> None:
    """初始化数据库：执行 schema.sql 建表 + 开启 WAL。"""
    global _initialized
    if _initialized and not force:
        return

    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = _connect()
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    finally:
        conn.close()
    _initialized = True


def query_all(conn, sql: str, params=()) -> list:
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def query_one(conn, sql: str, params=()):
    row = conn.execute(sql, params).fetchone()
    return dict(row) if row else None


def query_scalar(conn, sql: str, params=(), default=0):
    row = conn.execute(sql, params).fetchone()
    if row is None:
        return default
    val = row[0]
    return default if val is None else val


def recalc_stock(conn, item_id: int) -> int:
    """按流水重算某物品库存（数据修复用）。"""
    bal = query_scalar(conn, """
        SELECT COALESCE(SUM(CASE WHEN txn_type='in' THEN quantity ELSE -quantity END), 0)
        FROM stock_txn WHERE item_id=?
    """, (item_id,))
    conn.execute("UPDATE item SET current_stock=? WHERE id=?", (bal, item_id))
    return bal
