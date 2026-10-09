"""基础档案：部门 / 人员 / 分类 / 供应商。"""
from fastapi import APIRouter, Depends, HTTPException

from ..db import get_conn, query_all, query_one, query_scalar, transaction
from ..models.schemas import CategoryIn, DepartmentIn, StaffIn, SupplierIn
from ..security import current_user, require_admin
from ..utils import now_str

router = APIRouter(tags=["基础档案"])


# ================= 部门 =================
@router.get("/departments")
def list_departments(conn=Depends(get_conn), user: dict = Depends(current_user)):
    return query_all(conn, """
        SELECT d.*, (SELECT COUNT(*) FROM org_staff s WHERE s.department_id=d.id AND s.is_deleted=0) AS staff_count
        FROM org_department d WHERE d.is_deleted=0 ORDER BY d.id
    """)


@router.post("/departments")
def create_department(body: DepartmentIn, conn=Depends(get_conn), user: dict = Depends(require_admin)):
    with transaction(conn):
        if query_one(conn, "SELECT id FROM org_department WHERE name=? AND is_deleted=0", (body.name,)):
            raise HTTPException(status_code=400, detail="部门名称已存在")
        cur = conn.execute("INSERT INTO org_department(name, manager, remark, created_at) VALUES(?,?,?,?)",
                           (body.name, body.manager, body.remark, now_str()))
        return {"id": cur.lastrowid}


@router.put("/departments/{dept_id}")
def update_department(dept_id: int, body: DepartmentIn, conn=Depends(get_conn), user: dict = Depends(require_admin)):
    with transaction(conn):
        if not query_one(conn, "SELECT id FROM org_department WHERE id=? AND is_deleted=0", (dept_id,)):
            raise HTTPException(status_code=404, detail="部门不存在")
        dup = query_one(conn, "SELECT id FROM org_department WHERE name=? AND id<>? AND is_deleted=0", (body.name, dept_id))
        if dup:
            raise HTTPException(status_code=400, detail="部门名称已存在")
        conn.execute("UPDATE org_department SET name=?, manager=?, remark=? WHERE id=?",
                     (body.name, body.manager, body.remark, dept_id))
    return {"ok": True}


@router.delete("/departments/{dept_id}")
def delete_department(dept_id: int, conn=Depends(get_conn), user: dict = Depends(require_admin)):
    with transaction(conn):
        used = query_scalar(conn, "SELECT COUNT(*) FROM org_staff WHERE department_id=? AND is_deleted=0", (dept_id,))
        if used:
            raise HTTPException(status_code=400, detail=f"该部门下仍有 {used} 名人员，无法删除")
        conn.execute("UPDATE org_department SET is_deleted=1 WHERE id=?", (dept_id,))
    return {"ok": True}


# ================= 人员 =================
@router.get("/staff")
def list_staff(department_id: int | None = None, keyword: str | None = None,
               conn=Depends(get_conn), user: dict = Depends(current_user)):
    sql = """SELECT s.*, d.name AS department_name FROM org_staff s
             LEFT JOIN org_department d ON d.id=s.department_id
             WHERE s.is_deleted=0"""
    params = []
    if department_id:
        sql += " AND s.department_id=?"
        params.append(department_id)
    if keyword:
        sql += " AND (s.name LIKE ? OR s.job_no LIKE ? OR s.phone LIKE ?)"
        kw = f"%{keyword}%"
        params += [kw, kw, kw]
    sql += " ORDER BY s.id"
    return query_all(conn, sql, params)


@router.post("/staff")
def create_staff(body: StaffIn, conn=Depends(get_conn), user: dict = Depends(require_admin)):
    with transaction(conn):
        cur = conn.execute("""INSERT INTO org_staff(name, department_id, job_no, phone, email, status, created_at)
                              VALUES(?,?,?,?,?,?,?)""",
                           (body.name, body.department_id, body.job_no, body.phone, body.email,
                            body.status, now_str()))
        return {"id": cur.lastrowid}


@router.put("/staff/{staff_id}")
def update_staff(staff_id: int, body: StaffIn, conn=Depends(get_conn), user: dict = Depends(require_admin)):
    with transaction(conn):
        if not query_one(conn, "SELECT id FROM org_staff WHERE id=? AND is_deleted=0", (staff_id,)):
            raise HTTPException(status_code=404, detail="人员不存在")
        conn.execute("""UPDATE org_staff SET name=?, department_id=?, job_no=?, phone=?, email=?, status=?
                        WHERE id=?""",
                     (body.name, body.department_id, body.job_no, body.phone, body.email, body.status, staff_id))
    return {"ok": True}


@router.delete("/staff/{staff_id}")
def delete_staff(staff_id: int, conn=Depends(get_conn), user: dict = Depends(require_admin)):
    with transaction(conn):
        conn.execute("UPDATE org_staff SET is_deleted=1 WHERE id=?", (staff_id,))
    return {"ok": True}


# ================= 分类 =================
@router.get("/categories")
def list_categories(conn=Depends(get_conn), user: dict = Depends(current_user)):
    return query_all(conn, "SELECT * FROM item_category ORDER BY sort_order, id")


@router.post("/categories")
def create_category(body: CategoryIn, conn=Depends(get_conn), user: dict = Depends(require_admin)):
    with transaction(conn):
        if query_one(conn, "SELECT id FROM item_category WHERE name=?", (body.name,)):
            raise HTTPException(status_code=400, detail="分类名称已存在")
        cur = conn.execute("INSERT INTO item_category(name, parent_id, sort_order) VALUES(?,?,?)",
                           (body.name, body.parent_id, body.sort_order))
        return {"id": cur.lastrowid}


@router.put("/categories/{cat_id}")
def update_category(cat_id: int, body: CategoryIn, conn=Depends(get_conn), user: dict = Depends(require_admin)):
    with transaction(conn):
        dup = query_one(conn, "SELECT id FROM item_category WHERE name=? AND id<>?", (body.name, cat_id))
        if dup:
            raise HTTPException(status_code=400, detail="分类名称已存在")
        conn.execute("UPDATE item_category SET name=?, parent_id=?, sort_order=? WHERE id=?",
                     (body.name, body.parent_id, body.sort_order, cat_id))
    return {"ok": True}


@router.delete("/categories/{cat_id}")
def delete_category(cat_id: int, conn=Depends(get_conn), user: dict = Depends(require_admin)):
    with transaction(conn):
        used = query_scalar(conn, "SELECT COUNT(*) FROM item WHERE category_id=? AND is_deleted=0", (cat_id,))
        if used:
            raise HTTPException(status_code=400, detail=f"该分类下仍有 {used} 个物品，无法删除")
        conn.execute("DELETE FROM item_category WHERE id=?", (cat_id,))
    return {"ok": True}


# ================= 供应商 =================
@router.get("/suppliers")
def list_suppliers(conn=Depends(get_conn), user: dict = Depends(current_user)):
    return query_all(conn, "SELECT * FROM supplier WHERE is_deleted=0 ORDER BY id")


@router.post("/suppliers")
def create_supplier(body: SupplierIn, conn=Depends(get_conn), user: dict = Depends(require_admin)):
    with transaction(conn):
        if query_one(conn, "SELECT id FROM supplier WHERE name=? AND is_deleted=0", (body.name,)):
            raise HTTPException(status_code=400, detail="供应商已存在")
        cur = conn.execute("INSERT INTO supplier(name, contact, phone, address, created_at) VALUES(?,?,?,?,?)",
                           (body.name, body.contact, body.phone, body.address, now_str()))
        return {"id": cur.lastrowid}


@router.put("/suppliers/{sup_id}")
def update_supplier(sup_id: int, body: SupplierIn, conn=Depends(get_conn), user: dict = Depends(require_admin)):
    with transaction(conn):
        conn.execute("UPDATE supplier SET name=?, contact=?, phone=?, address=? WHERE id=?",
                     (body.name, body.contact, body.phone, body.address, sup_id))
    return {"ok": True}


@router.delete("/suppliers/{sup_id}")
def delete_supplier(sup_id: int, conn=Depends(get_conn), user: dict = Depends(require_admin)):
    with transaction(conn):
        conn.execute("UPDATE supplier SET is_deleted=1 WHERE id=?", (sup_id,))
    return {"ok": True}
