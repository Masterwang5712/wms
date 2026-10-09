"""库存查询、流水、低库存预警、盘点调整。"""
from fastapi import APIRouter, Depends, HTTPException

from ..db import get_conn, query_all, query_one, query_scalar, transaction
from ..models.schemas import StockAdjustIn
from ..security import current_user, require_keeper
from ..services.inventory import apply_stock_change
from ..utils import paginate, round2

router = APIRouter(prefix="/stock", tags=["库存"])


@router.get("")
def stock_list(keyword: str | None = None, category_id: int | None = None,
               only_low: bool = False, page: int = 1, size: int = 20,
               conn=Depends(get_conn), user: dict = Depends(current_user)):
    sql = """SELECT i.id, i.code, i.name, i.spec, i.unit, i.brand, i.location,
                    i.current_stock, i.safety_stock, i.unit_price,
                    c.name AS category_name
             FROM item i LEFT JOIN item_category c ON c.id=i.category_id
             WHERE i.is_deleted=0 AND i.item_type='consumable'"""
    params = []
    if keyword:
        sql += " AND (i.name LIKE ? OR i.code LIKE ?)"
        kw = f"%{keyword}%"
        params += [kw, kw]
    if category_id:
        sql += " AND i.category_id=?"
        params.append(category_id)
    if only_low:
        sql += " AND i.safety_stock>0 AND i.current_stock<=i.safety_stock"
    sql += " ORDER BY (CASE WHEN i.current_stock=0 THEN 0 WHEN i.safety_stock>0 AND i.current_stock<=i.safety_stock THEN 1 ELSE 2 END), i.id"
    rows = query_all(conn, sql, params)
    for r in rows:
        r["is_out"] = r["current_stock"] <= 0
        r["is_low"] = bool(r["safety_stock"] > 0 and r["current_stock"] <= r["safety_stock"])
        r["stock_value"] = round2(r["current_stock"] * r["unit_price"])
        r["status"] = "缺货" if r["is_out"] else ("低库存" if r["is_low"] else "正常")
    res = paginate(rows, page, size)
    # 附带汇总（基于全量过滤结果）
    res["summary"] = {
        "total_value": round2(sum(r["stock_value"] for r in rows)),
        "out_count": sum(1 for r in rows if r["is_out"]),
        "low_count": sum(1 for r in rows if r["is_low"]),
        "kind_count": len(rows),
    }
    return res


@router.get("/alerts")
def stock_alerts(conn=Depends(get_conn), user: dict = Depends(current_user)):
    rows = query_all(conn, """
        SELECT i.id, i.code, i.name, i.spec, i.unit, i.current_stock, i.safety_stock,
               (i.safety_stock - i.current_stock) AS shortage
        FROM item i
        WHERE i.is_deleted=0 AND i.item_type='consumable'
          AND i.safety_stock>0 AND i.current_stock<=i.safety_stock
        ORDER BY (i.current_stock=0) DESC, shortage DESC
    """)
    for r in rows:
        r["level"] = "danger" if r["current_stock"] <= 0 else "warning"
    return rows


@router.get("/txns")
def stock_txns(item_id: int | None = None, txn_type: str | None = None,
               department_id: int | None = None, date_from: str | None = None,
               date_to: str | None = None, keyword: str | None = None,
               page: int = 1, size: int = 20,
               conn=Depends(get_conn), user: dict = Depends(current_user)):
    sql = """SELECT t.*, i.name AS item_name, i.code AS item_code, i.unit,
                    u.display_name AS operator_name, d.name AS department_name
             FROM stock_txn t
             JOIN item i ON i.id=t.item_id
             LEFT JOIN sys_user u ON u.id=t.operator_id
             LEFT JOIN org_department d ON d.id=t.department_id
             WHERE 1=1"""
    params = []
    if item_id:
        sql += " AND t.item_id=?"
        params.append(item_id)
    if txn_type:
        sql += " AND t.txn_type=?"
        params.append(txn_type)
    if department_id:
        sql += " AND t.department_id=?"
        params.append(department_id)
    if date_from:
        sql += " AND date(t.created_at) >= date(?)"
        params.append(date_from)
    if date_to:
        sql += " AND date(t.created_at) <= date(?)"
        params.append(date_to)
    if keyword:
        sql += " AND (i.name LIKE ? OR i.code LIKE ? OR t.remark LIKE ?)"
        kw = f"%{keyword}%"
        params += [kw, kw, kw]
    sql += " ORDER BY t.id DESC"
    rows = query_all(conn, sql, params)
    return paginate(rows, page, size)


@router.post("/adjust")
def stock_adjust(body: StockAdjustIn, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    """盘点调整：将库存直接设为 new_qty，写一条差异流水。"""
    with transaction(conn):
        item = query_one(conn, "SELECT * FROM item WHERE id=? AND is_deleted=0", (body.item_id,))
        if not item:
            raise HTTPException(status_code=404, detail="物品不存在")
        before = item["current_stock"]
        diff = body.new_qty - before
        if diff == 0:
            raise HTTPException(status_code=400, detail="盘点数量与当前库存一致，无需调整")
        direction = "in" if diff > 0 else "out"
        # 直接设值（不走 apply_stock_change 的累加语义），单独写流水
        from ..utils import now_str
        ts = now_str()
        conn.execute("UPDATE item SET current_stock=?, updated_at=? WHERE id=?",
                     (body.new_qty, ts, body.item_id))
        conn.execute("""
            INSERT INTO stock_txn(item_id, txn_type, quantity, before_qty, after_qty,
                                  unit_price, amount, ref_type, operator_id, remark, created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)
        """, (body.item_id, direction, abs(diff), before, body.new_qty,
              item["unit_price"], round2(abs(diff) * item["unit_price"]), "adjust",
              user["id"], f"盘点调整：{body.reason or '无备注'}（{before} → {body.new_qty}）", ts))
        conn.execute("INSERT INTO sys_log(user_id, action, target_type, target_id, detail, created_at) VALUES(?,?,?,?,?,?)",
                     (user["id"], "adjust", "item", body.item_id,
                      f"盘点 {item['name']}：{before} → {body.new_qty}", ts))
    return {"ok": True, "before": before, "after": body.new_qty, "diff": diff}


@router.get("/value-summary")
def value_summary(conn=Depends(get_conn), user: dict = Depends(current_user)):
    """库存货值汇总（按分类）。"""
    return query_all(conn, """
        SELECT COALESCE(c.name,'未分类') AS category_name,
               COUNT(*) AS kind_count,
               SUM(i.current_stock) AS total_qty,
               ROUND(SUM(i.current_stock * i.unit_price), 2) AS total_value
        FROM item i LEFT JOIN item_category c ON c.id=i.category_id
        WHERE i.is_deleted=0 AND i.item_type='consumable'
        GROUP BY c.name ORDER BY total_value DESC
    """)
