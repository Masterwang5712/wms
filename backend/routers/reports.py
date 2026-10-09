"""报表聚合：看板总览 / 出入库趋势 / 月度报表 / 消耗排行。"""
from datetime import date, timedelta

from fastapi import APIRouter, Depends

from ..config import CALIBRATION_WARN_DAYS
from ..db import get_conn, query_all, query_one, query_scalar
from ..security import current_user
from ..utils import month_range, round2, today_str

router = APIRouter(prefix="/reports", tags=["报表统计"])


@router.get("/overview")
def overview(conn=Depends(get_conn), user: dict = Depends(current_user)):
    today = today_str()
    month_start = date.today().replace(day=1).isoformat()

    total_value = query_scalar(conn, """
        SELECT ROUND(COALESCE(SUM(current_stock * unit_price), 0), 2) FROM item
        WHERE is_deleted=0 AND item_type='consumable'
    """, default=0.0)
    item_kinds = query_scalar(conn, "SELECT COUNT(*) FROM item WHERE is_deleted=0 AND item_type='consumable'")
    device_total = query_scalar(conn, "SELECT COUNT(*) FROM device WHERE is_deleted=0")
    device_in_use = query_scalar(conn, "SELECT COUNT(*) FROM device WHERE is_deleted=0 AND status IN ('in_use','borrowed')")
    device_borrowed = query_scalar(conn, "SELECT COUNT(*) FROM device WHERE is_deleted=0 AND status='borrowed'")
    low_stock = query_scalar(conn, """
        SELECT COUNT(*) FROM item WHERE is_deleted=0 AND item_type='consumable'
          AND safety_stock>0 AND current_stock<=safety_stock
    """)
    out_of_stock = query_scalar(conn, """
        SELECT COUNT(*) FROM item WHERE is_deleted=0 AND item_type='consumable' AND current_stock<=0
    """)
    month_out_qty = query_scalar(conn, """
        SELECT COALESCE(SUM(quantity),0) FROM stock_txn
        WHERE txn_type='out' AND date(created_at) >= date(?)
    """, (month_start,))
    month_out_amount = query_scalar(conn, """
        SELECT ROUND(COALESCE(SUM(amount),0),2) FROM stock_txn
        WHERE txn_type='out' AND date(created_at) >= date(?)
    """, (month_start,), default=0.0)
    month_in_amount = query_scalar(conn, """
        SELECT ROUND(COALESCE(SUM(amount),0),2) FROM stock_txn
        WHERE txn_type='in' AND date(created_at) >= date(?)
    """, (month_start,), default=0.0)
    overdue_borrow = query_scalar(conn, """
        SELECT COUNT(*) FROM device_borrow
        WHERE status='borrowed' AND date(due_date) < date('now','localtime')
    """)
    calib_expired = query_scalar(conn, """
        SELECT COUNT(*) FROM device WHERE is_deleted=0 AND need_calibration=1 AND status<>'scrapped'
          AND date(next_calibration_date) < date('now','localtime')
    """)
    calib_expiring = query_scalar(conn, f"""
        SELECT COUNT(*) FROM device WHERE is_deleted=0 AND need_calibration=1 AND status<>'scrapped'
          AND date(next_calibration_date) >= date('now','localtime')
          AND date(next_calibration_date) <= date('now','localtime','+{CALIBRATION_WARN_DAYS} day')
    """)

    return {
        "stock_value": round2(total_value),
        "item_kinds": item_kinds,
        "device_total": device_total,
        "device_in_use": device_in_use,
        "device_borrowed": device_borrowed,
        "low_stock_count": low_stock,
        "out_of_stock_count": out_of_stock,
        "month_out_qty": month_out_qty,
        "month_out_amount": round2(month_out_amount),
        "month_in_amount": round2(month_in_amount),
        "overdue_borrow_count": overdue_borrow,
        "calibration_expired": calib_expired,
        "calibration_expiring": calib_expiring,
        "today": today,
    }


@router.get("/trend")
def trend(days: int = 30, conn=Depends(get_conn), user: dict = Depends(current_user)):
    days = max(7, min(days, 180))
    start = (date.today() - timedelta(days=days - 1)).isoformat()
    rows = query_all(conn, """
        SELECT date(created_at) AS d,
               SUM(CASE WHEN txn_type='in' THEN quantity ELSE 0 END) AS in_qty,
               SUM(CASE WHEN txn_type='out' THEN quantity ELSE 0 END) AS out_qty,
               ROUND(SUM(CASE WHEN txn_type='in' THEN amount ELSE 0 END), 2) AS in_amount,
               ROUND(SUM(CASE WHEN txn_type='out' THEN amount ELSE 0 END), 2) AS out_amount
        FROM stock_txn
        WHERE date(created_at) >= date(?) AND txn_type IN ('in','out')
        GROUP BY date(created_at) ORDER BY d
    """, (start,))
    bucket = {r["d"]: r for r in rows}
    series = []
    for i in range(days):
        d = (date.today() - timedelta(days=days - 1 - i)).isoformat()
        r = bucket.get(d)
        series.append({
            "date": d,
            "in_qty": (r or {}).get("in_qty", 0) or 0,
            "out_qty": (r or {}).get("out_qty", 0) or 0,
            "in_amount": (r or {}).get("in_amount", 0) or 0,
            "out_amount": (r or {}).get("out_amount", 0) or 0,
        })
    return series


@router.get("/consumption-top")
def consumption_top(limit: int = 5, date_from: str | None = None, date_to: str | None = None,
                    conn=Depends(get_conn), user: dict = Depends(current_user)):
    sql = """SELECT i.name || CASE WHEN i.spec IS NULL OR i.spec='' THEN '' ELSE ' / ' || i.spec END AS name,
                    SUM(ci.quantity) AS total_qty, ROUND(SUM(ci.amount),2) AS total_amount
             FROM consumable_issue ci JOIN item i ON i.id=ci.item_id WHERE 1=1"""
    params = []
    if date_from:
        sql += " AND date(ci.issued_at) >= date(?)"
        params.append(date_from)
    if date_to:
        sql += " AND date(ci.issued_at) <= date(?)"
        params.append(date_to)
    sql += " GROUP BY ci.item_id ORDER BY total_qty DESC LIMIT ?"
    params.append(limit)
    return query_all(conn, sql, params)


@router.get("/category-share")
def category_share(conn=Depends(get_conn), user: dict = Depends(current_user)):
    return query_all(conn, """
        SELECT COALESCE(c.name,'未分类') AS name,
               ROUND(SUM(i.current_stock * i.unit_price), 2) AS value,
               SUM(i.current_stock) AS qty,
               COUNT(*) AS kinds
        FROM item i LEFT JOIN item_category c ON c.id=i.category_id
        WHERE i.is_deleted=0 AND i.item_type='consumable'
        GROUP BY c.name ORDER BY value DESC
    """)


@router.get("/monthly")
def monthly(year: int | None = None, month: int | None = None,
            conn=Depends(get_conn), user: dict = Depends(current_user)):
    t = date.today()
    year = year or t.year
    month = month or t.month
    start, end = month_range(year, month)

    inbound = query_all(conn, """
        SELECT o.id, o.order_no, o.order_date, o.supplier_name, o.total_amount, o.status,
               o.handler, (SELECT COUNT(*) FROM inbound_item ii WHERE ii.order_id=o.id) AS line_count
        FROM inbound_order o
        WHERE date(o.order_date) BETWEEN date(?) AND date(?) ORDER BY o.order_date DESC
    """, (start, end))

    outbound = query_all(conn, """
        SELECT o.id, o.order_no, o.order_date, o.receiver, o.purpose, o.total_amount, o.status,
               d.name AS department_name,
               (SELECT COUNT(*) FROM outbound_item oi WHERE oi.order_id=o.id) AS line_count
        FROM outbound_order o LEFT JOIN org_department d ON d.id=o.department_id
        WHERE date(o.order_date) BETWEEN date(?) AND date(?) ORDER BY o.order_date DESC
    """, (start, end))

    by_dept = query_all(conn, """
        SELECT COALESCE(d.name,'未指定') AS name, SUM(ci.quantity) AS total_qty,
               ROUND(SUM(ci.amount),2) AS total_amount, COUNT(*) AS cnt
        FROM consumable_issue ci LEFT JOIN org_department d ON d.id=ci.department_id
        WHERE date(ci.issued_at) BETWEEN date(?) AND date(?)
        GROUP BY d.name ORDER BY total_amount DESC
    """, (start, end))

    by_item = query_all(conn, """
        SELECT i.name, i.spec, i.unit, SUM(ci.quantity) AS total_qty,
               ROUND(SUM(ci.amount),2) AS total_amount
        FROM consumable_issue ci JOIN item i ON i.id=ci.item_id
        WHERE date(ci.issued_at) BETWEEN date(?) AND date(?)
        GROUP BY ci.item_id ORDER BY total_amount DESC LIMIT 30
    """, (start, end))

    maint = query_all(conn, """
        SELECT m.*, dv.name AS device_name, dv.asset_no FROM device_maintenance m
        JOIN device dv ON dv.id=m.device_id
        WHERE date(m.maint_date) BETWEEN date(?) AND date(?) ORDER BY m.maint_date DESC
    """, (start, end))

    calib = query_all(conn, """
        SELECT c.*, dv.name AS device_name, dv.asset_no FROM device_calibration c
        JOIN device dv ON dv.id=c.device_id
        WHERE date(c.calibration_date) BETWEEN date(?) AND date(?) ORDER BY c.calibration_date DESC
    """, (start, end))

    issues = query_all(conn, """
        SELECT ci.*, i.name AS item_name, i.unit, d.name AS department_name, s.name AS staff_name
        FROM consumable_issue ci
        JOIN item i ON i.id=ci.item_id
        LEFT JOIN org_department d ON d.id=ci.department_id
        LEFT JOIN org_staff s ON s.id=ci.staff_id
        WHERE date(ci.issued_at) BETWEEN date(?) AND date(?)
        ORDER BY ci.issued_at DESC
    """, (start, end))

    total_in = round2(sum(x["total_amount"] for x in inbound if x["status"] == "confirmed"))
    total_out = round2(sum(x["total_amount"] for x in outbound if x["status"] == "confirmed"))

    return {
        "year": year, "month": month, "start": start, "end": end,
        "summary": {
            "inbound_count": len([x for x in inbound if x["status"] == "confirmed"]),
            "outbound_count": len([x for x in outbound if x["status"] == "confirmed"]),
            "inbound_amount": total_in,
            "outbound_amount": total_out,
            "issue_qty": sum(x["total_qty"] for x in by_item),
            "maintenance_cost": round2(sum(x["cost"] for x in maint)),
            "calibration_cost": round2(sum(x["cost"] for x in calib)),
            "borrow_unreturned": query_scalar(conn, "SELECT COUNT(*) FROM device_borrow WHERE status='borrowed'"),
        },
        "inbound": inbound,
        "outbound": outbound,
        "by_department": by_dept,
        "by_item": by_item,
        "maintenance": maint,
        "calibration": calib,
        "issues": issues,
    }


@router.get("/device-summary")
def device_summary(conn=Depends(get_conn), user: dict = Depends(current_user)):
    rows = query_all(conn, "SELECT status, COUNT(*) AS cnt, ROUND(SUM(price),2) AS value FROM device WHERE is_deleted=0 GROUP BY status")
    from ..config import DEVICE_STATUS
    total = sum(r["cnt"] for r in rows)
    for r in rows:
        r["label"] = DEVICE_STATUS.get(r["status"], r["status"])
    return {"rows": rows, "total": total,
            "total_value": round2(sum(r["value"] or 0 for r in rows))}
