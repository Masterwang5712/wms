"""pydantic 请求模型，按模块分组。"""
from pydantic import BaseModel, Field


# ---------- 认证 ----------
class LoginIn(BaseModel):
    username: str
    password: str


# ---------- 基础数据 ----------
class DepartmentIn(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    manager: str | None = None
    remark: str | None = None


class StaffIn(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    department_id: int | None = None
    job_no: str | None = None
    phone: str | None = None
    email: str | None = None
    status: str = "active"


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    parent_id: int | None = None
    sort_order: int = 0


class SupplierIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    contact: str | None = None
    phone: str | None = None
    address: str | None = None


# ---------- 物品 ----------
class ItemIn(BaseModel):
    code: str | None = None
    name: str = Field(min_length=1, max_length=100)
    category_id: int | None = None
    item_type: str = "consumable"
    spec: str | None = None
    unit: str | None = None
    brand: str | None = None
    safety_stock: int = 0
    unit_price: float = 0
    location: str | None = None
    supplier_id: int | None = None
    remark: str | None = None
    init_stock: int = 0  # 仅新建时生效


# ---------- 库存 ----------
class StockAdjustIn(BaseModel):
    item_id: int
    new_qty: int = Field(ge=0)
    reason: str | None = None


# ---------- 单据 ----------
class OrderLineIn(BaseModel):
    item_id: int
    quantity: int = Field(gt=0)
    unit_price: float = 0
    batch_no: str | None = None
    expire_date: str | None = None
    remark: str | None = None


class InboundIn(BaseModel):
    order_date: str
    supplier_id: int | None = None
    supplier_name: str | None = None
    handler: str | None = None
    remark: str | None = None
    items: list[OrderLineIn] = Field(min_length=1)
    auto_confirm: bool = False


class OutboundIn(BaseModel):
    order_date: str
    out_type: str = "consume"
    department_id: int | None = None
    receiver: str | None = None
    staff_id: int | None = None
    purpose: str | None = None
    remark: str | None = None
    items: list[OrderLineIn] = Field(min_length=1)
    auto_confirm: bool = False


class QuickIssueIn(BaseModel):
    """耗材快速领用。"""
    item_id: int
    quantity: int = Field(gt=0)
    department_id: int | None = None
    staff_id: int | None = None
    purpose: str | None = None
    issued_at: str | None = None
    remark: str | None = None


# ---------- 设备 ----------
class DeviceIn(BaseModel):
    asset_no: str | None = None
    name: str = Field(min_length=1, max_length=100)
    category_id: int | None = None
    brand: str | None = None
    model: str | None = None
    spec: str | None = None
    serial_no: str | None = None
    purchase_date: str | None = None
    price: float = 0
    location: str | None = None
    custodian_id: int | None = None
    department_id: int | None = None
    status: str = "in_use"
    need_calibration: int = 0
    calibration_cycle_days: int = 0
    last_calibration_date: str | None = None
    warranty_until: str | None = None
    remark: str | None = None


class DeviceStatusIn(BaseModel):
    to_status: str
    reason: str | None = None


class BorrowIn(BaseModel):
    device_id: int
    borrower_id: int | None = None
    borrower_name: str | None = None
    borrower_dept_id: int | None = None
    borrow_date: str | None = None
    due_date: str | None = None
    purpose: str | None = None


class ReturnIn(BaseModel):
    return_date: str | None = None
    return_remark: str | None = None


class MaintenanceIn(BaseModel):
    device_id: int
    maint_type: str = "保养"
    maint_date: str
    content: str | None = None
    cost: float = 0
    vendor: str | None = None
    next_date: str | None = None


class CalibrationIn(BaseModel):
    device_id: int
    calibration_date: str
    result: str = "合格"
    certificate_no: str | None = None
    agency: str | None = None
    cycle_days: int = 0
    cost: float = 0
    remark: str | None = None
