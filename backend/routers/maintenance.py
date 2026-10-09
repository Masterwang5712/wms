"""设备维保记录。"""
from fastapi import APIRouter, Depends, HTTPException

from ..db import get_conn, query_all, query_one, transaction
from ..models.schemas import MaintenanceIn
from ..security import current_user, require_keeper
from ..utils import now_str, paginate

router = APIRouter(prefix="/maintenance", tags=["维保记录"])


@router.get("")
def list_maintenance(device_id: int | None = None, maint_type: str | None = None,
                     keyword: str | None = None, page: int = 1, size: int = 20,
                     conn=Depends(get_conn), user: dict = Depends(current_user)):
    sql = """SELECT m.*, dv.name AS device_name, dv.asset_no, u.display_name AS operator_name
             FROM device_maintenance m
             JOIN device dv ON dv.id=m.device_id
             LEFT JOIN sys_user u ON u.id=m.operator_id
             WHERE 1=1"""
    params = []
    if device_id:
        sql += " AND m.device_id=?"
        params.append(device_id)
    if maint_type:
        sql += " AND m.maint_type=?"
        params.append(maint_type)
    if keyword:
        sql += " AND (dv.name LIKE ? OR dv.asset_no LIKE ? OR m.content LIKE ? OR m.vendor LIKE ?)"
        kw = f"%{keyword}%"
        params += [kw, kw, kw, kw]
    sql += " ORDER BY m.maint_date DESC, m.id DESC"
    return paginate(query_all(conn, sql, params), page, size)


@router.post("")
def create_maintenance(body: MaintenanceIn, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    with transaction(conn):
        dev = query_one(conn, "SELECT * FROM device WHERE id=? AND is_deleted=0", (body.device_id,))
        if not dev:
            raise HTTPException(status_code=404, detail="设备不存在")
        if body.maint_type in ("维修", "故障"):
            conn.execute("UPDATE device SET status='repairing', updated_at=? WHERE id=? AND status<>'borrowed'",
                         (now_str(), body.device_id))
        cur = conn.execute("""
            INSERT INTO device_maintenance(device_id, maint_type, maint_date, content, cost,
                                           vendor, next_date, operator_id, created_at)
            VALUES(?,?,?,?,?,?,?,?,?)
        """, (body.device_id, body.maint_type, body.maint_date, body.content, body.cost,
              body.vendor, body.next_date, user["id"], now_str()))
        conn.execute("INSERT INTO sys_log(user_id, action, target_type, target_id, detail, created_at) VALUES(?,?,?,?,?,?)",
                     (user["id"], "maintenance", "device", body.device_id,
                      f"{dev['name']} 记录{body.maint_type}，费用 ¥{body.cost:.2f}", now_str()))
        return {"id": cur.lastrowid}


@router.delete("/{maint_id}")
def delete_maintenance(maint_id: int, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    with transaction(conn):
        if not query_one(conn, "SELECT id FROM device_maintenance WHERE id=?", (maint_id,)):
            raise HTTPException(status_code=404, detail="记录不存在")
        conn.execute("DELETE FROM device_maintenance WHERE id=?", (maint_id,))
    return {"ok": True}
