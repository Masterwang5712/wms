"""物品档案 CRUD。"""
from fastapi import APIRouter, Depends, HTTPException

from ..db import get_conn, query_all, query_one, query_scalar, transaction
from ..models.schemas import ItemIn
from ..security import current_user, require_keeper
from ..utils import gen_item_code, now_str, paginate, round2

router = APIRouter(prefix="/items", tags=["物品档案"])


def _next_item_code(conn, item_type: str) -> str:
    prefix = "HC" if item_type == "consumable" else "SB"
    n = query_scalar(conn, "SELECT COUNT(*) FROM item WHERE code LIKE ?", (prefix + "%",))
    for i in range(n + 1, n + 1000):
        code = gen_item_code(prefix, i)
        if not query_one(conn, "SELECT id FROM item WHERE code=?", (code,)):
            return code
    return gen_item_code(prefix, n + 1000)


@router.get("")
def list_items(keyword: str | None = None, item_type: str | None = None,
               category_id: int | None = None, low_stock: bool = False,
               page: int = 1, size: int = 20,
               conn=Depends(get_conn), user: dict = Depends(current_user)):
    sql = """SELECT i.*, c.name AS category_name, s.name AS supplier_name
             FROM item i
             LEFT JOIN item_category c ON c.id=i.category_id
             LEFT JOIN supplier s ON s.id=i.supplier_id
             WHERE i.is_deleted=0"""
    params = []
    if keyword:
        sql += " AND (i.name LIKE ? OR i.code LIKE ? OR i.spec LIKE ? OR i.brand LIKE ?)"
        kw = f"%{keyword}%"
        params += [kw, kw, kw, kw]
    if item_type:
        sql += " AND i.item_type=?"
        params.append(item_type)
    if category_id:
        sql += " AND i.category_id=?"
        params.append(category_id)
    if low_stock:
        sql += " AND i.safety_stock>0 AND i.current_stock<=i.safety_stock"
    sql += " ORDER BY i.id DESC"
    rows = query_all(conn, sql, params)
    for r in rows:
        r["is_low"] = bool(r["safety_stock"] > 0 and r["current_stock"] <= r["safety_stock"])
        r["is_out"] = r["current_stock"] <= 0
        r["stock_value"] = round2(r["current_stock"] * r["unit_price"])
    return paginate(rows, page, size)


@router.get("/options")
def item_options(item_type: str | None = None, conn=Depends(get_conn), user: dict = Depends(current_user)):
    """下拉选项：仅返回必要字段，供表单选择。"""
    sql = "SELECT id, code, name, spec, unit, unit_price, current_stock FROM item WHERE is_deleted=0"
    params = []
    if item_type:
        sql += " AND item_type=?"
        params.append(item_type)
    sql += " ORDER BY id"
    return query_all(conn, sql, params)


@router.get("/{item_id}")
def get_item(item_id: int, conn=Depends(get_conn), user: dict = Depends(current_user)):
    row = query_one(conn, """SELECT i.*, c.name AS category_name FROM item i
                             LEFT JOIN item_category c ON c.id=i.category_id
                             WHERE i.id=? AND i.is_deleted=0""", (item_id,))
    if not row:
        raise HTTPException(status_code=404, detail="物品不存在")
    return row


@router.get("/{item_id}/txns")
def item_txns(item_id: int, limit: int = 100, conn=Depends(get_conn), user: dict = Depends(current_user)):
    return query_all(conn, """
        SELECT t.*, u.display_name AS operator_name, d.name AS department_name
        FROM stock_txn t
        LEFT JOIN sys_user u ON u.id=t.operator_id
        LEFT JOIN org_department d ON d.id=t.department_id
        WHERE t.item_id=? ORDER BY t.id DESC LIMIT ?
    """, (item_id, limit))


@router.post("")
def create_item(body: ItemIn, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    with transaction(conn):
        code = (body.code or "").strip() or _next_item_code(conn, body.item_type)
        if query_one(conn, "SELECT id FROM item WHERE code=?", (code,)):
            raise HTTPException(status_code=400, detail=f"物品编码 {code} 已存在")
        ts = now_str()
        cur = conn.execute("""
            INSERT INTO item(code, name, category_id, item_type, spec, unit, brand,
                             safety_stock, current_stock, unit_price, location, supplier_id,
                             remark, created_at, updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (code, body.name, body.category_id, body.item_type, body.spec, body.unit, body.brand,
              body.safety_stock, 0, body.unit_price, body.location, body.supplier_id,
              body.remark, ts, ts))
        iid = cur.lastrowid
        if body.init_stock > 0:
            amt = round2(body.init_stock * body.unit_price)
            conn.execute("UPDATE item SET current_stock=? WHERE id=?", (body.init_stock, iid))
            conn.execute("""
                INSERT INTO stock_txn(item_id, txn_type, quantity, before_qty, after_qty,
                                      unit_price, amount, ref_type, operator_id, remark, created_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)
            """, (iid, "in", body.init_stock, 0, body.init_stock, body.unit_price, amt,
                  "init", user["id"], "建档期初库存", ts))
        return {"id": iid, "code": code}


@router.put("/{item_id}")
def update_item(item_id: int, body: ItemIn, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    with transaction(conn):
        if not query_one(conn, "SELECT id FROM item WHERE id=? AND is_deleted=0", (item_id,)):
            raise HTTPException(status_code=404, detail="物品不存在")
        if body.code:
            dup = query_one(conn, "SELECT id FROM item WHERE code=? AND id<>?", (body.code, item_id))
            if dup:
                raise HTTPException(status_code=400, detail=f"物品编码 {body.code} 已被占用")
            conn.execute("UPDATE item SET code=? WHERE id=?", (body.code, item_id))
        conn.execute("""
            UPDATE item SET name=?, category_id=?, item_type=?, spec=?, unit=?, brand=?,
                            safety_stock=?, unit_price=?, location=?, supplier_id=?, remark=?, updated_at=?
            WHERE id=?
        """, (body.name, body.category_id, body.item_type, body.spec, body.unit, body.brand,
              body.safety_stock, body.unit_price, body.location, body.supplier_id, body.remark,
              now_str(), item_id))
    return {"ok": True}


@router.delete("/{item_id}")
def delete_item(item_id: int, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    with transaction(conn):
        stock = query_scalar(conn, "SELECT current_stock FROM item WHERE id=? AND is_deleted=0", (item_id,), None)
        if stock is None:
            raise HTTPException(status_code=404, detail="物品不存在")
        if stock != 0:
            raise HTTPException(status_code=400, detail=f"该物品仍有库存 {stock}，请先出清后再删除")
        conn.execute("UPDATE item SET is_deleted=1 WHERE id=?", (item_id,))
    return {"ok": True}
