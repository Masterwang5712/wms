"""入库单：创建（草稿）/ 列表 / 详情 / 确认入库（事务加库存）/ 删除。"""
from fastapi import APIRouter, Depends, HTTPException

from ..db import get_conn, query_all, query_one, transaction
from ..models.schemas import InboundIn
from ..security import current_user, require_keeper
from ..services.inventory import apply_stock_change
from ..utils import gen_order_no, now_str, paginate, round2

router = APIRouter(prefix="/inbound", tags=["入库管理"])


@router.get("")
def list_orders(status: str | None = None, date_from: str | None = None,
                date_to: str | None = None, keyword: str | None = None,
                page: int = 1, size: int = 20,
                conn=Depends(get_conn), user: dict = Depends(current_user)):
    sql = """SELECT o.*, u.display_name AS operator_name,
                    (SELECT COUNT(*) FROM inbound_item ii WHERE ii.order_id=o.id) AS line_count
             FROM inbound_order o LEFT JOIN sys_user u ON u.id=o.operator_id WHERE 1=1"""
    params = []
    if status:
        sql += " AND o.status=?"
        params.append(status)
    if date_from:
        sql += " AND date(o.order_date) >= date(?)"
        params.append(date_from)
    if date_to:
        sql += " AND date(o.order_date) <= date(?)"
        params.append(date_to)
    if keyword:
        sql += " AND (o.order_no LIKE ? OR o.supplier_name LIKE ?)"
        kw = f"%{keyword}%"
        params += [kw, kw]
    sql += " ORDER BY o.id DESC"
    return paginate(query_all(conn, sql, params), page, size)


@router.get("/{order_id}")
def get_order(order_id: int, conn=Depends(get_conn), user: dict = Depends(current_user)):
    order = query_one(conn, """SELECT o.*, u.display_name AS operator_name
                               FROM inbound_order o LEFT JOIN sys_user u ON u.id=o.operator_id
                               WHERE o.id=?""", (order_id,))
    if not order:
        raise HTTPException(status_code=404, detail="入库单不存在")
    order["items"] = query_all(conn, """
        SELECT ii.*, i.name AS item_name, i.code AS item_code, i.unit, i.spec
        FROM inbound_item ii JOIN item i ON i.id=ii.item_id
        WHERE ii.order_id=? ORDER BY ii.id
    """, (order_id,))
    return order


@router.post("")
def create_order(body: InboundIn, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    with transaction(conn):
        return _create(conn, body, user["id"], confirm=body.auto_confirm)


def _create(conn, body: InboundIn, operator_id: int, confirm: bool) -> dict:
    ts = now_str()
    order_no = gen_order_no("RK")
    cur = conn.execute("""
        INSERT INTO inbound_order(order_no, order_date, supplier_id, supplier_name,
                                  status, handler, operator_id, remark, created_at)
        VALUES(?,?,?,?,?,?,?,?,?)
    """, (order_no, body.order_date, body.supplier_id, body.supplier_name,
          "draft", body.handler, operator_id, body.remark, ts))
    oid = cur.lastrowid

    total = 0.0
    for line in body.items:
        item = query_one(conn, "SELECT id, name, unit_price FROM item WHERE id=? AND is_deleted=0", (line.item_id,))
        if not item:
            raise HTTPException(status_code=404, detail=f"物品(id={line.item_id})不存在")
        price = float(line.unit_price or item["unit_price"] or 0)
        amt = round2(line.quantity * price)
        total += amt
        conn.execute("""
            INSERT INTO inbound_item(order_id, item_id, quantity, unit_price, amount, batch_no, expire_date, remark)
            VALUES(?,?,?,?,?,?,?,?)
        """, (oid, line.item_id, line.quantity, price, amt, line.batch_no, line.expire_date, line.remark))

    conn.execute("UPDATE inbound_order SET total_amount=? WHERE id=?", (round2(total), oid))

    if confirm:
        _confirm(conn, oid, operator_id)

    return {"id": oid, "order_no": order_no, "total_amount": round2(total)}


def _confirm(conn, order_id: int, operator_id: int) -> dict:
    order = query_one(conn, "SELECT * FROM inbound_order WHERE id=?", (order_id,))
    if not order:
        raise HTTPException(status_code=404, detail="入库单不存在")
    if order["status"] == "confirmed":
        raise HTTPException(status_code=400, detail="该入库单已确认，不可重复确认")

    lines = query_all(conn, "SELECT * FROM inbound_item WHERE order_id=?", (order_id,))
    if not lines:
        raise HTTPException(status_code=400, detail="入库单没有明细，无法确认")

    ts = now_str()
    for ln in lines:
        apply_stock_change(
            conn, item_id=ln["item_id"], quantity=ln["quantity"], direction="in",
            unit_price=ln["unit_price"], ref_type="inbound", ref_id=order_id,
            operator_id=operator_id, remark=f"入库单 {order['order_no']}")
    conn.execute("UPDATE inbound_order SET status='confirmed', confirmed_at=? WHERE id=?", (ts, order_id))
    conn.execute("INSERT INTO sys_log(user_id, action, target_type, target_id, detail, created_at) VALUES(?,?,?,?,?,?)",
                 (operator_id, "confirm", "inbound", order_id,
                  f"确认入库单 {order['order_no']}，共 {len(lines)} 行", ts))
    return {"ok": True}


@router.post("/{order_id}/confirm")
def confirm_order(order_id: int, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    with transaction(conn):
        return _confirm(conn, order_id, user["id"])


@router.delete("/{order_id}")
def delete_order(order_id: int, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    with transaction(conn):
        order = query_one(conn, "SELECT * FROM inbound_order WHERE id=?", (order_id,))
        if not order:
            raise HTTPException(status_code=404, detail="入库单不存在")
        if order["status"] == "confirmed":
            raise HTTPException(status_code=400, detail="已确认的入库单不可删除，如需更正请做盘点调整")
        conn.execute("DELETE FROM inbound_item WHERE order_id=?", (order_id,))
        conn.execute("DELETE FROM inbound_order WHERE id=?", (order_id,))
    return {"ok": True}
