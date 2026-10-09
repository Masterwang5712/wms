"""耗材领用登记 + 多维消耗统计。"""
from fastapi import APIRouter, Depends, HTTPException

from ..db import get_conn, query_all, query_one, transaction
from ..models.schemas import QuickIssueIn
from ..security import current_user, require_keeper, require_login
from ..services.inventory import apply_stock_change
from ..utils import gen_order_no, now_str, paginate, round2, today_str

router = APIRouter(prefix="/consumables", tags=["耗材领用"])


@router.get("/issues")
def list_issues(item_id: int | None = None, department_id: int | None = None,
                staff_id: int | None = None, date_from: str | None = None,
                date_to: str | None = None, keyword: str | None = None,
                page: int = 1, size: int = 20,
                conn=Depends(get_conn), user: dict = Depends(current_user)):
    sql = """SELECT ci.*, i.name AS item_name, i.code AS item_code, i.unit, i.spec,
                    d.name AS department_name, s.name AS staff_name,
                    u.display_name AS operator_name
             FROM consumable_issue ci
             JOIN item i ON i.id=ci.item_id
             LEFT JOIN org_department d ON d.id=ci.department_id
             LEFT JOIN org_staff s ON s.id=ci.staff_id
             LEFT JOIN sys_user u ON u.id=ci.operator_id
             WHERE 1=1"""
    params = []
    if item_id:
        sql += " AND ci.item_id=?"
        params.append(item_id)
    if department_id:
        sql += " AND ci.department_id=?"
        params.append(department_id)
    if staff_id:
        sql += " AND ci.staff_id=?"
        params.append(staff_id)
    if date_from:
        sql += " AND date(ci.issued_at) >= date(?)"
        params.append(date_from)
    if date_to:
        sql += " AND date(ci.issued_at) <= date(?)"
        params.append(date_to)
    if keyword:
        sql += " AND (i.name LIKE ? OR ci.order_no LIKE ? OR ci.purpose LIKE ? OR s.name LIKE ?)"
        kw = f"%{keyword}%"
        params += [kw, kw, kw, kw]
    sql += " ORDER BY ci.issued_at DESC, ci.id DESC"
    rows = query_all(conn, sql, params)
    res = paginate(rows, page, size)
    res["summary"] = {
        "total_qty": sum(r["quantity"] for r in rows),
        "total_amount": round2(sum(r["amount"] for r in rows)),
        "count": len(rows),
    }
    return res


@router.post("/issue")
def quick_issue(body: QuickIssueIn, conn=Depends(get_conn), user: dict = Depends(require_login)):
    """快速领用：内部生成一张已确认的出库单，并写领用登记。

    权限：普通用户（user）亦可领用，符合「查看 + 领用申请」的角色定位；
    原始出入库单的创建/确认/删除仍仅限仓管员及以上。
    """
    with transaction(conn):
        item = query_one(conn, "SELECT * FROM item WHERE id=? AND is_deleted=0", (body.item_id,))
        if not item:
            raise HTTPException(status_code=404, detail="物品不存在")
        if item["item_type"] != "consumable":
            raise HTTPException(status_code=400, detail="设备类物品请通过借用流程管理，不走耗材领用")

        if body.staff_id:
            s = query_one(conn, "SELECT id, name, department_id FROM org_staff WHERE id=?", (body.staff_id,))
            if not s:
                raise HTTPException(status_code=404, detail="领用人不存在")
            dept_id = body.department_id or s["department_id"]
            staff_name = s["name"]
        else:
            dept_id = body.department_id
            staff_name = None
            s = None

        issued_at = body.issued_at or today_str()
        ts = now_str()
        order_no = gen_order_no("LY")
        price = float(item["unit_price"] or 0)
        amount = round2(body.quantity * price)

        cur = conn.execute("""
            INSERT INTO outbound_order(order_no, order_date, out_type, department_id, receiver,
                                       staff_id, purpose, total_amount, status, operator_id,
                                       remark, created_at, confirmed_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (order_no, issued_at, "consume", dept_id, staff_name, body.staff_id,
              body.purpose, amount, "confirmed", user["id"],
              body.remark or "耗材快速领用", ts, ts))
        oid = cur.lastrowid

        conn.execute("""
            INSERT INTO outbound_item(order_id, item_id, quantity, unit_price, amount, remark)
            VALUES(?,?,?,?,?,?)
        """, (oid, body.item_id, body.quantity, price, amount, body.remark))

        # 扣减库存（不足则抛错整单回滚）
        apply_stock_change(
            conn, item_id=body.item_id, quantity=body.quantity, direction="out",
            unit_price=price, ref_type="outbound", ref_id=oid, department_id=dept_id,
            operator_id=user["id"], remark=f"领用单 {order_no}")

        conn.execute("""
            INSERT INTO consumable_issue(order_id, order_no, item_id, quantity, unit_price, amount,
                                         department_id, staff_id, purpose, issued_at, operator_id,
                                         remark, created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (oid, order_no, body.item_id, body.quantity, price, amount, dept_id, body.staff_id,
              body.purpose, issued_at, user["id"], body.remark, ts))

        conn.execute("INSERT INTO sys_log(user_id, action, target_type, target_id, detail, created_at) VALUES(?,?,?,?,?,?)",
                     (user["id"], "issue", "item", body.item_id,
                      f"领用 {item['name']} ×{body.quantity}，单号 {order_no}", ts))
        return {"id": oid, "order_no": order_no, "amount": amount}


@router.get("/stats")
def consumption_stats(dim: str = "department", date_from: str | None = None,
                      date_to: str | None = None, limit: int = 20,
                      conn=Depends(get_conn), user: dict = Depends(current_user)):
    """消耗统计，dim: department | staff | item | month。"""
    dim_map = {
        "department": ("COALESCE(d.name,'未指定部门')", "LEFT JOIN org_department d ON d.id=ci.department_id"),
        "staff": ("COALESCE(s.name,'未指定人员')", "LEFT JOIN org_staff s ON s.id=ci.staff_id"),
        "item": ("i.name || CASE WHEN i.spec IS NULL OR i.spec='' THEN '' ELSE ' / ' || i.spec END", "JOIN item i ON i.id=ci.item_id"),
        "month": ("substr(ci.issued_at,1,7)", ""),
    }
    if dim not in dim_map:
        raise HTTPException(status_code=400, detail=f"不支持的统计维度：{dim}")

    expr, join = dim_map[dim]
    sql = f"""SELECT {expr} AS name,
                     SUM(ci.quantity) AS total_qty,
                     ROUND(SUM(ci.amount), 2) AS total_amount,
                     COUNT(*) AS cnt
              FROM consumable_issue ci {join}
              WHERE 1=1"""
    params = []
    if date_from:
        sql += " AND date(ci.issued_at) >= date(?)"
        params.append(date_from)
    if date_to:
        sql += " AND date(ci.issued_at) <= date(?)"
        params.append(date_to)
    sql += f" GROUP BY name ORDER BY total_amount DESC LIMIT ?"
    params.append(limit)
    rows = query_all(conn, sql, params)
    if dim == "month":
        rows.sort(key=lambda r: r["name"] or "")
    return {
        "dim": dim,
        "rows": rows,
        "total_qty": sum(r["total_qty"] for r in rows),
        "total_amount": round2(sum(r["total_amount"] for r in rows)),
    }
