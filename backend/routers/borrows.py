"""设备借用 / 归还 / 逾期查询。"""
from fastapi import APIRouter, Depends, HTTPException

from ..db import get_conn, query_all, query_one, query_scalar, transaction
from ..models.schemas import BorrowIn, ReturnIn
from ..security import current_user, require_keeper
from ..utils import days_between, now_str, paginate, today_str

router = APIRouter(prefix="/borrows", tags=["借用归还"])

BORROWABLE = ("in_use", "idle")


@router.get("")
def list_borrows(status: str | None = None, device_id: int | None = None,
                 keyword: str | None = None, page: int = 1, size: int = 20,
                 conn=Depends(get_conn), user: dict = Depends(current_user)):
    sql = """SELECT b.*, dv.name AS device_name, dv.asset_no, dv.model,
                    d.name AS department_name, u.display_name AS operator_name
             FROM device_borrow b
             JOIN device dv ON dv.id=b.device_id
             LEFT JOIN org_department d ON d.id=b.borrower_dept_id
             LEFT JOIN sys_user u ON u.id=b.operator_id
             WHERE 1=1"""
    params = []
    if status:
        sql += " AND b.status=?"
        params.append(status)
    if device_id:
        sql += " AND b.device_id=?"
        params.append(device_id)
    if keyword:
        sql += " AND (dv.name LIKE ? OR dv.asset_no LIKE ? OR b.borrower_name LIKE ?)"
        kw = f"%{keyword}%"
        params += [kw, kw, kw]
    sql += " ORDER BY (b.status='borrowed') DESC, b.id DESC"
    rows = query_all(conn, sql, params)
    today = today_str()
    for r in rows:
        if r["status"] == "borrowed":
            left = days_between(r["due_date"], today)
            r["days_left"] = -left if left is not None else None  # 距应还剩余天数的相反数 → 逾期为正
            r["overdue_days"] = max(0, -left) if left is not None else 0
            r["is_overdue"] = bool(left is not None and left < 0)
        else:
            r["days_left"] = None
            r["overdue_days"] = 0
            r["is_overdue"] = False
    return paginate(rows, page, size)


@router.get("/overdue")
def list_overdue(conn=Depends(get_conn), user: dict = Depends(current_user)):
    rows = query_all(conn, """
        SELECT b.*, dv.name AS device_name, dv.asset_no, d.name AS department_name
        FROM device_borrow b
        JOIN device dv ON dv.id=b.device_id
        LEFT JOIN org_department d ON d.id=b.borrower_dept_id
        WHERE b.status='borrowed' AND date(b.due_date) < date('now','localtime')
        ORDER BY b.due_date
    """)
    today = today_str()
    for r in rows:
        r["overdue_days"] = max(0, -(days_between(r["due_date"], today) or 0))
    return rows


@router.post("")
def borrow_device(body: BorrowIn, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    with transaction(conn):
        dev = query_one(conn, "SELECT * FROM device WHERE id=? AND is_deleted=0", (body.device_id,))
        if not dev:
            raise HTTPException(status_code=404, detail="设备不存在")
        if dev["status"] == "borrowed":
            raise HTTPException(status_code=400, detail="该设备已借出，尚未归还")
        if dev["status"] not in BORROWABLE:
            raise HTTPException(status_code=400,
                                detail=f"设备当前状态为「{dev['status']}」，不可借出")
        if query_one(conn, "SELECT id FROM device_borrow WHERE device_id=? AND status='borrowed'", (body.device_id,)):
            raise HTTPException(status_code=400, detail="该设备存在未归还的借用记录")

        borrower_name = body.borrower_name
        if body.borrower_id and not borrower_name:
            s = query_one(conn, "SELECT name FROM org_staff WHERE id=?", (body.borrower_id,))
            borrower_name = s["name"] if s else None
        if not borrower_name:
            raise HTTPException(status_code=400, detail="请填写借用人")

        borrow_date = body.borrow_date or today_str()
        if body.due_date and body.due_date < borrow_date:
            raise HTTPException(status_code=400, detail="应归还日期不能早于借出日期")

        ts = now_str()
        cur = conn.execute("""
            INSERT INTO device_borrow(device_id, borrower_id, borrower_name, borrower_dept_id,
                                      borrow_date, due_date, status, purpose, operator_id, created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)
        """, (body.device_id, body.borrower_id, borrower_name, body.borrower_dept_id,
              borrow_date, body.due_date, "borrowed", body.purpose, user["id"], ts))
        # 借出前记录设备原状态，便于归还时恢复
        conn.execute("UPDATE device SET status='borrowed', updated_at=? WHERE id=?", (ts, body.device_id))
        conn.execute("INSERT INTO sys_log(user_id, action, target_type, target_id, detail, created_at) VALUES(?,?,?,?,?,?)",
                     (user["id"], "borrow", "device", body.device_id,
                      f"{dev['name']} 借出给 {borrower_name}，应还 {body.due_date or '未指定'}", ts))
        return {"id": cur.lastrowid}


@router.post("/{record_id}/return")
def return_device(record_id: int, body: ReturnIn, conn=Depends(get_conn), user: dict = Depends(require_keeper)):
    with transaction(conn):
        rec = query_one(conn, "SELECT * FROM device_borrow WHERE id=?", (record_id,))
        if not rec:
            raise HTTPException(status_code=404, detail="借用记录不存在")
        if rec["status"] == "returned":
            raise HTTPException(status_code=400, detail="该记录已归还，无需重复操作")
        dev = query_one(conn, "SELECT * FROM device WHERE id=?", (rec["device_id"],))
        if not dev:
            raise HTTPException(status_code=404, detail="设备不存在")

        ret_date = body.return_date or today_str()
        ts = now_str()
        # 归还后设备状态：报废/维修中保持原状，否则回到在用
        if dev["status"] in ("scrapped", "repairing"):
            new_status = dev["status"]
        else:
            new_status = "in_use"
        conn.execute("""UPDATE device_borrow SET status='returned', return_date=?, return_remark=?
                        WHERE id=?""", (ret_date, body.return_remark, record_id))
        conn.execute("UPDATE device SET status=?, updated_at=? WHERE id=?", (new_status, ts, rec["device_id"]))
        conn.execute("INSERT INTO sys_log(user_id, action, target_type, target_id, detail, created_at) VALUES(?,?,?,?,?,?)",
                     (user["id"], "return", "device", rec["device_id"],
                      f"{dev['name']} 归还，归还日期 {ret_date}", ts))
    return {"ok": True}
