"""库存核心服务：原子增减库存 + 流水记录（供出入库/盘点复用）。

设计要点：
- 所有库存变更必须在调用方开启的写事务内执行（BEGIN IMMEDIATE 已持写锁）。
- item.current_stock 与 stock_txn.after_qty 在同一事务内保持一致。
- 出库前校验库存，不足直接抛 HTTPException，由调用方整单回滚。
"""
from fastapi import HTTPException

from ..utils import now_str, round2


def apply_stock_change(conn, *, item_id: int, quantity: int, direction: str,
                       unit_price: float = 0, ref_type: str | None = None,
                       ref_id: int | None = None, department_id: int | None = None,
                       operator_id: int | None = None, remark: str | None = None,
                       allow_negative: bool = False) -> dict:
    """在事务内变更库存并写流水。

    direction: in（增加）/ out（减少）
    返回 {before, after, amount}
    """
    row = conn.execute("SELECT id, name, current_stock FROM item WHERE id=? AND is_deleted=0",
                       (item_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"物品(id={item_id})不存在")
    before = row["current_stock"]
    qty = int(quantity)
    if qty <= 0:
        raise HTTPException(status_code=400, detail=f"物品[{row['name']}]数量必须大于 0")

    delta = qty if direction == "in" else -qty
    after = before + delta
    if after < 0 and not allow_negative:
        raise HTTPException(
            status_code=400,
            detail=f"物品[{row['name']}]库存不足：当前库存 {before}，本次需要 {qty}，缺口 {qty - before}")

    ts = now_str()
    conn.execute("UPDATE item SET current_stock=?, updated_at=? WHERE id=?", (after, ts, item_id))
    amount = round2(qty * float(unit_price or 0))
    conn.execute("""
        INSERT INTO stock_txn(item_id, txn_type, quantity, before_qty, after_qty,
                              unit_price, amount, ref_type, ref_id, department_id,
                              operator_id, remark, created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (item_id, direction, qty, before, after, float(unit_price or 0), amount,
          ref_type, ref_id, department_id, operator_id, remark, ts))
    return {"before": before, "after": after, "amount": amount, "name": row["name"]}
