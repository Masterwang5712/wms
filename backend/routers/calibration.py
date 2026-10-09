"""设备校准记录与提醒（临期 / 已过期）。"""
from fastapi import APIRouter, Depends, HTTPException

from ..config import CALIBRATION_WARN_DAYS
from ..db import get_conn, query_all, query_one, transaction
from ..models.schemas import CalibrationIn
from ..security import current_user, require_keeper
from ..utils import add_days, days_between, now_str, paginate

router = APIRouter(prefix="/calibrations", tags=["校准管理"])


@router.get("")
def list_calibrations(device_id: int | None = None, keyword: str | None = None,
                      page: int = 1, size: int = 20,
                      conn=Depends(get_conn), user: dict = Depends(current_user)):
    sql = """SELECT c.*, dv.name AS device_name, dv.asset_no, u.display_name AS operator_name
             FROM device_calibration c
             JOIN device dv ON dv.id=c.device_id
             LEFT JOIN sys_user u ON u.id=c.operator_id
             WHERE 1=1"""
    params = []
    if device_id:
        sql += " AND c.device_id=?"
        params.append(device_id)
    if keyword:
        sql += " AND (dv.name LIKE ? OR dv.asset_no LIKE ? OR c.certificate_no LIKE ? OR c.agency LIKE ?)"
        kw = f"%{keyword}%"
        params += [kw, kw, kw, kw]
    sql += " ORDER BY c.calibration_date DESC, c.id DESC"
    return paginate(query_all(conn, sql, params), page, size)


@router.get("/alerts")
def calibration_alerts(within: int = CALIBRATION_WARN_DAYS,
                       conn=Depends(get_conn), user: dict = Depends(current_user)):
    """返回需校准设备的提醒分组：已过期 / 临期 / 正常统计。"""
    rows = query_all(conn, """
        SELECT dv.id, dv.asset_no, dv.name, dv.model, dv.location,
               dv.calibration_cycle_days, dv.last_calibration_date, dv.next_calibration_date,
               dv.status, d.name AS department_name, s.name AS custodian_name
        FROM device dv
        LEFT JOIN org_department d ON d.id=dv.department_id
        LEFT JOIN org_staff s ON s.id=dv.custodian_id
        WHERE dv.is_deleted=0 AND dv.need_calibration=1 AND dv.status<>'scrapped'
        ORDER BY date(dv.next_calibration_date)
    """)
    expired, expiring, ok = [], [], []
    for r in rows:
        left = days_between(r["next_calibration_date"])
        r["days_left"] = left
        if left is None:
            continue
        if left < 0:
            r["level"] = "expired"
            r["overdue_days"] = -left
            expired.append(r)
        elif left <= within:
            r["level"] = "expiring"
            expiring.append(r)
        else:
            r["level"] = "ok"
            ok.append(r)
    expired.sort(key=lambda x: x["days_left"])
    expiring.sort(key=lambda x: x["days_left"])
    return {
        "expired": expired,
        "expiring": expiring,
        "ok_count": len(ok),
        "within": within,
        "summary": {
            "expired_count": len(expired),
            "expiring_count": len(expiring),
            "ok_count": len(ok),
            "total": len(expired) + len(expiring) + len(ok),
        },
    }


@router.post("")
def create_calibration(body: CalibrationIn, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    with transaction(conn):
        dev = query_one(conn, "SELECT * FROM device WHERE id=? AND is_deleted=0", (body.device_id,))
        if not dev:
            raise HTTPException(status_code=404, detail="设备不存在")
        cycle = body.cycle_days or dev["calibration_cycle_days"] or 0
        next_date = add_days(body.calibration_date, cycle) if cycle > 0 else None
        ts = now_str()
        cur = conn.execute("""
            INSERT INTO device_calibration(device_id, calibration_date, result, certificate_no,
                                           agency, cycle_days, next_date, cost, operator_id,
                                           remark, created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)
        """, (body.device_id, body.calibration_date, body.result, body.certificate_no,
              body.agency, cycle, next_date, body.cost, user["id"], body.remark, ts))

        # 同一事务内回写设备校准字段
        conn.execute("""
            UPDATE device SET need_calibration=1, calibration_cycle_days=?,
                              last_calibration_date=?, next_calibration_date=?, updated_at=?
            WHERE id=?
        """, (cycle, body.calibration_date, next_date, ts, body.device_id))

        conn.execute("INSERT INTO sys_log(user_id, action, target_type, target_id, detail, created_at) VALUES(?,?,?,?,?,?)",
                     (user["id"], "calibration", "device", body.device_id,
                      f"{dev['name']} 校准{body.result}，下次校准 {next_date or '未设置'}", ts))
        return {"id": cur.lastrowid, "next_date": next_date}


@router.delete("/{calib_id}")
def delete_calibration(calib_id: int, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    with transaction(conn):
        rec = query_one(conn, "SELECT * FROM device_calibration WHERE id=?", (calib_id,))
        if not rec:
            raise HTTPException(status_code=404, detail="记录不存在")
        conn.execute("DELETE FROM device_calibration WHERE id=?", (calib_id,))
        # 回退设备校准日期到最近一条记录
        latest = query_one(conn, """
            SELECT * FROM device_calibration WHERE device_id=?
            ORDER BY calibration_date DESC, id DESC LIMIT 1
        """, (rec["device_id"],))
        if latest:
            conn.execute("""UPDATE device SET last_calibration_date=?, next_calibration_date=?,
                                              calibration_cycle_days=?, updated_at=? WHERE id=?""",
                         (latest["calibration_date"], latest["next_date"], latest["cycle_days"],
                          now_str(), rec["device_id"]))
        else:
            conn.execute("""UPDATE device SET last_calibration_date=NULL, next_calibration_date=NULL,
                                              updated_at=? WHERE id=?""", (now_str(), rec["device_id"]))
    return {"ok": True}
