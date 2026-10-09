"""设备台账：CRUD、状态机流转、时间线。"""
from fastapi import APIRouter, Depends, HTTPException

from ..config import DEVICE_STATUS
from ..db import get_conn, query_all, query_one, query_scalar, transaction
from ..models.schemas import DeviceIn, DeviceStatusIn
from ..security import current_user, require_keeper
from ..utils import add_days, days_between, gen_item_code, now_str, paginate

router = APIRouter(prefix="/devices", tags=["设备管理"])

# 合法状态流转表（借用/归还单独走 borrows 路由）
TRANSITIONS = {
    "in_use":    {"idle", "repairing", "scrapped"},
    "idle":      {"in_use", "repairing", "scrapped"},
    "repairing": {"in_use", "idle", "scrapped"},
    "borrowed":  {"scrapped"},
    "scrapped":  set(),
}


def _next_asset_no(conn) -> str:
    n = query_scalar(conn, "SELECT COUNT(*) FROM device")
    for i in range(n + 1, n + 1000):
        code = gen_item_code("SB", i)
        if not query_one(conn, "SELECT id FROM device WHERE asset_no=?", (code,)):
            return code
    return gen_item_code("SB", n + 1000)


def _decorate(row: dict) -> dict:
    row["status_label"] = DEVICE_STATUS.get(row.get("status"), row.get("status"))
    left = days_between(row.get("next_calibration_date"))
    row["calibration_days_left"] = left
    if not row.get("need_calibration") or left is None:
        row["calibration_status"] = "none"       # 无需校准
    elif left < 0:
        row["calibration_status"] = "expired"    # 已过期
    elif left <= 30:
        row["calibration_status"] = "expiring"   # 临期
    else:
        row["calibration_status"] = "ok"         # 正常
    return row


@router.get("")
def list_devices(keyword: str | None = None, status: str | None = None,
                 department_id: int | None = None, category_id: int | None = None,
                 calibration: str | None = None, page: int = 1, size: int = 20,
                 conn=Depends(get_conn), user: dict = Depends(current_user)):
    sql = """SELECT dv.*, c.name AS category_name, d.name AS department_name,
                    s.name AS custodian_name
             FROM device dv
             LEFT JOIN item_category c ON c.id=dv.category_id
             LEFT JOIN org_department d ON d.id=dv.department_id
             LEFT JOIN org_staff s ON s.id=dv.custodian_id
             WHERE dv.is_deleted=0"""
    params = []
    if keyword:
        sql += " AND (dv.name LIKE ? OR dv.asset_no LIKE ? OR dv.model LIKE ? OR dv.serial_no LIKE ? OR dv.brand LIKE ?)"
        kw = f"%{keyword}%"
        params += [kw, kw, kw, kw, kw]
    if status:
        sql += " AND dv.status=?"
        params.append(status)
    if department_id:
        sql += " AND dv.department_id=?"
        params.append(department_id)
    if category_id:
        sql += " AND dv.category_id=?"
        params.append(category_id)
    if calibration == "expired":
        sql += " AND dv.need_calibration=1 AND date(dv.next_calibration_date) < date('now','localtime')"
    elif calibration == "expiring":
        sql += (" AND dv.need_calibration=1 AND date(dv.next_calibration_date) >= date('now','localtime')"
                " AND date(dv.next_calibration_date) <= date('now','localtime','+30 day')")
    sql += " ORDER BY dv.id DESC"
    rows = [_decorate(r) for r in query_all(conn, sql, params)]
    return paginate(rows, page, size)


@router.get("/{device_id}")
def get_device(device_id: int, conn=Depends(get_conn), user: dict = Depends(current_user)):
    row = query_one(conn, """SELECT dv.*, c.name AS category_name, d.name AS department_name,
                                    s.name AS custodian_name
                             FROM device dv
                             LEFT JOIN item_category c ON c.id=dv.category_id
                             LEFT JOIN org_department d ON d.id=dv.department_id
                             LEFT JOIN org_staff s ON s.id=dv.custodian_id
                             WHERE dv.id=? AND dv.is_deleted=0""", (device_id,))
    if not row:
        raise HTTPException(status_code=404, detail="设备不存在")
    return _decorate(row)


@router.get("/{device_id}/timeline")
def device_timeline(device_id: int, conn=Depends(get_conn), user: dict = Depends(current_user)):
    if not query_one(conn, "SELECT id FROM device WHERE id=? AND is_deleted=0", (device_id,)):
        raise HTTPException(status_code=404, detail="设备不存在")
    events = []
    for r in query_all(conn, """SELECT b.*, u.display_name AS operator_name
                                FROM device_borrow b LEFT JOIN sys_user u ON u.id=b.operator_id
                                WHERE b.device_id=? ORDER BY b.borrow_date DESC""", (device_id,)):
        events.append({
            "type": "borrow", "date": r["borrow_date"],
            "title": f"借出 · {r['borrower_name'] or ''}",
            "detail": f"应还 {r['due_date'] or '-'}｜用途：{r['purpose'] or '-'}"
                      + (f"｜已归还 {r['return_date']}" if r["return_date"] else "｜未归还"),
            "status": r["status"],
        })
    for r in query_all(conn, "SELECT * FROM device_calibration WHERE device_id=? ORDER BY calibration_date DESC", (device_id,)):
        events.append({
            "type": "calibration", "date": r["calibration_date"],
            "title": f"校准 · {r['result']}",
            "detail": f"机构：{r['agency'] or '-'}｜证书：{r['certificate_no'] or '-'}｜下次 {r['next_date'] or '-'}｜费用 ¥{r['cost']:.2f}",
            "status": r["result"],
        })
    for r in query_all(conn, "SELECT * FROM device_maintenance WHERE device_id=? ORDER BY maint_date DESC", (device_id,)):
        events.append({
            "type": "maintenance", "date": r["maint_date"],
            "title": f"维保 · {r['maint_type']}",
            "detail": f"{r['content'] or '-'}｜服务商：{r['vendor'] or '-'}｜费用 ¥{r['cost']:.2f}",
            "status": r["maint_type"],
        })
    events.sort(key=lambda e: e["date"] or "", reverse=True)
    return events


@router.post("")
def create_device(body: DeviceIn, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    with transaction(conn):
        asset_no = (body.asset_no or "").strip() or _next_asset_no(conn)
        if query_one(conn, "SELECT id FROM device WHERE asset_no=?", (asset_no,)):
            raise HTTPException(status_code=400, detail=f"资产编号 {asset_no} 已存在")
        next_cal = None
        if body.need_calibration and body.last_calibration_date and body.calibration_cycle_days > 0:
            next_cal = add_days(body.last_calibration_date, body.calibration_cycle_days)
        ts = now_str()
        cur = conn.execute("""
            INSERT INTO device(asset_no, name, category_id, brand, model, spec, serial_no,
                               purchase_date, price, location, custodian_id, department_id,
                               status, need_calibration, calibration_cycle_days,
                               last_calibration_date, next_calibration_date, warranty_until,
                               remark, created_at, updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (asset_no, body.name, body.category_id, body.brand, body.model, body.spec, body.serial_no,
              body.purchase_date, body.price, body.location, body.custodian_id, body.department_id,
              body.status, body.need_calibration, body.calibration_cycle_days,
              body.last_calibration_date, next_cal, body.warranty_until, body.remark, ts, ts))
        return {"id": cur.lastrowid, "asset_no": asset_no}


@router.put("/{device_id}")
def update_device(device_id: int, body: DeviceIn, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    with transaction(conn):
        cur = query_one(conn, "SELECT * FROM device WHERE id=? AND is_deleted=0", (device_id,))
        if not cur:
            raise HTTPException(status_code=404, detail="设备不存在")
        if body.asset_no:
            dup = query_one(conn, "SELECT id FROM device WHERE asset_no=? AND id<>?", (body.asset_no, device_id))
            if dup:
                raise HTTPException(status_code=400, detail=f"资产编号 {body.asset_no} 已被占用")
            conn.execute("UPDATE device SET asset_no=? WHERE id=?", (body.asset_no, device_id))

        # 校准日期重算：仅当周期或上次校准日期变化时
        next_cal = cur["next_calibration_date"]
        if body.need_calibration:
            if body.calibration_cycle_days > 0 and body.last_calibration_date:
                next_cal = add_days(body.last_calibration_date, body.calibration_cycle_days)
        else:
            next_cal = None

        conn.execute("""
            UPDATE device SET name=?, category_id=?, brand=?, model=?, spec=?, serial_no=?,
                              purchase_date=?, price=?, location=?, custodian_id=?, department_id=?,
                              need_calibration=?, calibration_cycle_days=?, last_calibration_date=?,
                              next_calibration_date=?, warranty_until=?, remark=?, updated_at=?
            WHERE id=?
        """, (body.name, body.category_id, body.brand, body.model, body.spec, body.serial_no,
              body.purchase_date, body.price, body.location, body.custodian_id, body.department_id,
              body.need_calibration, body.calibration_cycle_days, body.last_calibration_date,
              next_cal, body.warranty_until, body.remark, now_str(), device_id))
    return {"ok": True}


@router.post("/{device_id}/status")
def change_status(device_id: int, body: DeviceStatusIn, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    with transaction(conn):
        dev = query_one(conn, "SELECT * FROM device WHERE id=? AND is_deleted=0", (device_id,))
        if not dev:
            raise HTTPException(status_code=404, detail="设备不存在")
        to = body.to_status
        if to not in DEVICE_STATUS:
            raise HTTPException(status_code=400, detail=f"未知状态：{to}")
        if to == dev["status"]:
            raise HTTPException(status_code=400, detail="设备已处于该状态")
        allowed = TRANSITIONS.get(dev["status"], set())
        if to not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"不允许从「{DEVICE_STATUS.get(dev['status'])}」变更为「{DEVICE_STATUS.get(to)}」")
        if dev["status"] == "borrowed" and to != "scrapped":
            raise HTTPException(status_code=400, detail="设备处于借出状态，请先归还后再变更状态")
        with_open_borrow = query_one(conn, "SELECT id FROM device_borrow WHERE device_id=? AND status='borrowed'", (device_id,))
        if with_open_borrow and to != "scrapped":
            raise HTTPException(status_code=400, detail="该设备存在未归还的借用记录，请先办理归还")
        ts = now_str()
        conn.execute("UPDATE device SET status=?, updated_at=? WHERE id=?", (to, ts, device_id))
        conn.execute("INSERT INTO sys_log(user_id, action, target_type, target_id, detail, created_at) VALUES(?,?,?,?,?,?)",
                     (user["id"], "status_change", "device", device_id,
                      f"{dev['name']}：{DEVICE_STATUS.get(dev['status'])} → {DEVICE_STATUS.get(to)}"
                      + (f"（{body.reason}）" if body.reason else ""), ts))
    return {"ok": True}


@router.delete("/{device_id}")
def delete_device(device_id: int, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    with transaction(conn):
        dev = query_one(conn, "SELECT * FROM device WHERE id=? AND is_deleted=0", (device_id,))
        if not dev:
            raise HTTPException(status_code=404, detail="设备不存在")
        if dev["status"] == "borrowed":
            raise HTTPException(status_code=400, detail="设备处于借出状态，无法删除")
        if query_one(conn, "SELECT id FROM device_borrow WHERE device_id=? AND status='borrowed'", (device_id,)):
            raise HTTPException(status_code=400, detail="该设备存在未归还的借用记录，无法删除")
        conn.execute("UPDATE device SET is_deleted=1 WHERE id=?", (device_id,))
    return {"ok": True}


@router.get("/options/borrowable", include_in_schema=False)
def borrowable_options(conn=Depends(get_conn), user: dict = Depends(current_user)):
    return query_all(conn, """
        SELECT dv.id, dv.asset_no, dv.name, dv.model, dv.status, dv.location, dv.department_id,
               d.name AS department_name
        FROM device dv LEFT JOIN org_department d ON d.id=dv.department_id
        WHERE dv.is_deleted=0 AND dv.status NOT IN ('borrowed','scrapped','repairing')
        ORDER BY dv.id
    """)


@router.get("/options/all", include_in_schema=False)
def all_options(conn=Depends(get_conn), user: dict = Depends(current_user)):
    return query_all(conn, "SELECT id, asset_no, name, model, status FROM device WHERE is_deleted=0 ORDER BY id")
