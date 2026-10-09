"""出库单：创建（草稿）/ 列表 / 详情 / 确认出库（校验库存，不足整单回滚）/ 删除。

出库确认为「耗材领用」时，同步写入 consumable_issue，供多维消耗统计。
"""
from fastapi import APIRouter, Depends, HTTPException

from ..db import get_conn, query_all, query_one, transaction
from ..models.schemas import OutboundIn
from ..security import current_user, require_keeper
from ..services.inventory import apply_stock_change
from ..utils import gen_order_no, now_str, paginate, round2

router = APIRouter(prefix="/outbound", tags=["出库管理"])


@router.get("")
def list_orders(status: str | None = None, out_type: str | None = None,
                department_id: int | None = None, date_from: str | None = None,
                date_to: str | None = None, keyword: str | None = None,
                page: int = 1, size: int = 20,
                conn=Depends(get_conn), user: dict = Depends(current_user)):
    sql = """SELECT o.*, u.display_name AS operator_name, d.name AS department_name,
                    (SELECT COUNT(*) FROM outbound_item oi WHERE oi.order_id=o.id) AS line_count
             FROM outbound_order o
             LEFT JOIN sys_user u ON u.id=o.operator_id
             LEFT JOIN org_department d ON d.id=o.department_id
             WHERE 1=1"""
    params = []
    if status:
        sql += " AND o.status=?"
        params.append(status)
    if out_type:
        sql += " AND o.out_type=?"
        params.append(out_type)
    if department_id:
        sql += " AND o.department_id=?"
        params.append(department_id)
    if date_from:
        sql += " AND date(o.order_date) >= date(?)"
        params.append(date_from)
    if date_to:
        sql += " AND date(o.order_date) <= date(?)"
        params.append(date_to)
    if keyword:
        sql += " AND (o.order_no LIKE ? OR o.receiver LIKE ? OR o.purpose LIKE ?)"
        kw = f"%{keyword}%"
        params += [kw, kw, kw]
    sql += " ORDER BY o.id DESC"
    return paginate(query_all(conn, sql, params), page, size)


@router.get("/{order_id}")
def get_order(order_id: int, conn=Depends(get_conn), user: dict = Depends(current_user)):
    order = query_one(conn, """SELECT o.*, u.display_name AS operator_name, d.name AS department_name
                               FROM outbound_order o
                               LEFT JOIN sys_user u ON u.id=o.operator_id
                               LEFT JOIN org_department d ON d.id=o.department_id
                               WHERE o.id=?""", (order_id,))
    if not order:
        raise HTTPException(status_code=404, detail="出库单不存在")
    order["items"] = query_all(conn, """
        SELECT oi.*, i.name AS item_name, i.code AS item_code, i.unit, i.spec,
               i.current_stock
        FROM outbound_item oi JOIN item i ON i.id=oi.item_id
        WHERE oi.order_id=? ORDER BY oi.id
    """, (order_id,))
    return order


@router.post("")
def create_order(body: OutboundIn, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    with transaction(conn):
        return _create(conn, body, user["id"], confirm=body.auto_confirm)


def _create(conn, body: OutboundIn, operator_id: int, confirm: bool) -> dict:
    ts = now_str()
    order_no = gen_order_no("CK")
    cur = conn.execute("""
        INSERT INTO outbound_order(order_no, order_date, out_type, department_id, receiver,
                                   staff_id, purpose, status, operator_id, remark, created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)
    """, (order_no, body.order_date, body.out_type, body.department_id, body.receiver,
          body.staff_id, body.purpose, "draft", operator_id, body.remark, ts))
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
            INSERT INTO outbound_item(order_id, item_id, quantity, unit_price, amount, remark)
            VALUES(?,?,?,?,?,?)
        """, (oid, line.item_id, line.quantity, price, amt, line.remark))

    conn.execute("UPDATE outbound_order SET total_amount=? WHERE id=?", (round2(total), oid))

    if confirm:
        _confirm(conn, oid, operator_id)

    return {"id": oid, "order_no": order_no, "total_amount": round2(total)}


def _confirm(conn, order_id: int, operator_id: int) -> dict:
    order = query_one(conn, "SELECT * FROM outbound_order WHERE id=?", (order_id,))
    if not order:
        raise HTTPException(status_code=404, detail="出库单不存在")
    if order["status"] == "confirmed":
        raise HTTPException(status_code=400, detail="该出库单已确认，不可重复确认")

    lines = query_all(conn, "SELECT * FROM outbound_item WHERE order_id=?", (order_id,))
    if not lines:
        raise HTTPException(status_code=400, detail="出库单没有明细，无法确认")

    # 逐行扣减；任一行库存不足则 apply_stock_change 抛错 → 外层事务整单回滚
    ts = now_str()
    for ln in lines:
        apply_stock_change(
            conn, item_id=ln["item_id"], quantity=ln["quantity"], direction="out",
            unit_price=ln["unit_price"], ref_type="outbound", ref_id=order_id,
            department_id=order["department_id"], operator_id=operator_id,
            remark=f"出库单 {order['order_no']}")

    conn.execute("UPDATE outbound_order SET status='confirmed', confirmed_at=? WHERE id=?", (ts, order_id))

    # 领用登记（用于按部门/人员/物品/月份统计）
    for ln in lines:
        conn.execute("""
            INSERT INTO consumable_issue(order_id, order_no, item_id, quantity, unit_price, amount,
                                         department_id, staff_id, purpose, issued_at, operator_id, created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        """, (order_id, order["order_no"], ln["item_id"], ln["quantity"], ln["unit_price"], ln["amount"],
              order["department_id"], order["staff_id"], order["purpose"], order["order_date"],
              operator_id, ts))

    conn.execute("INSERT INTO sys_log(user_id, action, target_type, target_id, detail, created_at) VALUES(?,?,?,?,?,?)",
                 (operator_id, "confirm", "outbound", order_id,
                  f"确认出库单 {order['order_no']}，共 {len(lines)} 行", ts))
    return {"ok": True}


@router.post("/{order_id}/confirm")
def confirm_order(order_id: int, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    with transaction(conn):
        return _confirm(conn, order_id, user["id"])


@router.delete("/{order_id}")
def delete_order(order_id: int, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    with transaction(conn):
        order = query_one(conn, "SELECT * FROM outbound_order WHERE id=?", (order_id,))
        if not order:
            raise HTTPException(status_code=404, detail="出库单不存在")
        if order["status"] == "confirmed":
            raise HTTPException(status_code=400, detail="已确认的出库单不可删除，如需更正请做盘点调整")
        conn.execute("DELETE FROM outbound_item WHERE order_id=?", (order_id,))
        conn.execute("DELETE FROM outbound_order WHERE id=?", (order_id,))
    return {"ok": True}
