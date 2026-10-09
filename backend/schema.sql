-- 耗材与设备管理仓库系统 数据库结构
PRAGMA foreign_keys = ON;

-- ============ 基础数据 ============
CREATE TABLE IF NOT EXISTS org_department (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    manager     TEXT,
    remark      TEXT,
    is_deleted  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT
);

CREATE TABLE IF NOT EXISTS org_staff (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    department_id INTEGER REFERENCES org_department(id),
    job_no        TEXT,
    phone         TEXT,
    email         TEXT,
    status        TEXT NOT NULL DEFAULT 'active',
    is_deleted    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT
);

CREATE TABLE IF NOT EXISTS sys_user (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'dept_user',
    department_id INTEGER REFERENCES org_department(id),
    status        TEXT NOT NULL DEFAULT 'active',
    is_deleted    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT
);

CREATE TABLE IF NOT EXISTS item_category (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    parent_id  INTEGER REFERENCES item_category(id),
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS supplier (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    contact    TEXT,
    phone      TEXT,
    address    TEXT,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT
);

-- ============ 物品与库存 ============
CREATE TABLE IF NOT EXISTS item (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    category_id   INTEGER REFERENCES item_category(id),
    item_type     TEXT NOT NULL DEFAULT 'consumable',
    spec          TEXT,
    unit          TEXT,
    brand         TEXT,
    safety_stock  INTEGER NOT NULL DEFAULT 0,
    current_stock INTEGER NOT NULL DEFAULT 0,
    unit_price    REAL NOT NULL DEFAULT 0,
    location      TEXT,
    supplier_id   INTEGER REFERENCES supplier(id),
    remark        TEXT,
    is_deleted    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT,
    updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS stock_txn (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id       INTEGER NOT NULL REFERENCES item(id),
    txn_type      TEXT NOT NULL,
    quantity      INTEGER NOT NULL,
    before_qty    INTEGER NOT NULL DEFAULT 0,
    after_qty     INTEGER NOT NULL DEFAULT 0,
    unit_price    REAL NOT NULL DEFAULT 0,
    amount        REAL NOT NULL DEFAULT 0,
    ref_type      TEXT,
    ref_id        INTEGER,
    department_id INTEGER REFERENCES org_department(id),
    operator_id   INTEGER REFERENCES sys_user(id),
    remark        TEXT,
    created_at    TEXT
);

CREATE TABLE IF NOT EXISTS inbound_order (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no      TEXT NOT NULL UNIQUE,
    order_date    TEXT NOT NULL,
    supplier_id   INTEGER REFERENCES supplier(id),
    supplier_name TEXT,
    total_amount  REAL NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'draft',
    handler       TEXT,
    operator_id   INTEGER REFERENCES sys_user(id),
    remark        TEXT,
    created_at    TEXT,
    confirmed_at  TEXT
);

CREATE TABLE IF NOT EXISTS inbound_item (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL REFERENCES inbound_order(id) ON DELETE CASCADE,
    item_id    INTEGER NOT NULL REFERENCES item(id),
    quantity   INTEGER NOT NULL,
    unit_price REAL NOT NULL DEFAULT 0,
    amount     REAL NOT NULL DEFAULT 0,
    batch_no   TEXT,
    expire_date TEXT,
    remark     TEXT
);

CREATE TABLE IF NOT EXISTS outbound_order (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no      TEXT NOT NULL UNIQUE,
    order_date    TEXT NOT NULL,
    out_type      TEXT NOT NULL DEFAULT 'consume',
    department_id INTEGER REFERENCES org_department(id),
    receiver      TEXT,
    staff_id      INTEGER REFERENCES org_staff(id),
    purpose       TEXT,
    total_amount  REAL NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'draft',
    operator_id   INTEGER REFERENCES sys_user(id),
    remark        TEXT,
    created_at    TEXT,
    confirmed_at  TEXT
);

CREATE TABLE IF NOT EXISTS outbound_item (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL REFERENCES outbound_order(id) ON DELETE CASCADE,
    item_id    INTEGER NOT NULL REFERENCES item(id),
    quantity   INTEGER NOT NULL,
    unit_price REAL NOT NULL DEFAULT 0,
    amount     REAL NOT NULL DEFAULT 0,
    remark     TEXT
);

CREATE TABLE IF NOT EXISTS consumable_issue (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id      INTEGER REFERENCES outbound_order(id),
    order_no      TEXT,
    item_id       INTEGER NOT NULL REFERENCES item(id),
    quantity      INTEGER NOT NULL,
    unit_price    REAL NOT NULL DEFAULT 0,
    amount        REAL NOT NULL DEFAULT 0,
    department_id INTEGER REFERENCES org_department(id),
    staff_id      INTEGER REFERENCES org_staff(id),
    purpose       TEXT,
    issued_at     TEXT,
    operator_id   INTEGER REFERENCES sys_user(id),
    remark        TEXT,
    created_at    TEXT
);

-- ============ 设备 ============
CREATE TABLE IF NOT EXISTS device (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_no              TEXT NOT NULL UNIQUE,
    name                  TEXT NOT NULL,
    category_id           INTEGER REFERENCES item_category(id),
    brand                 TEXT,
    model                 TEXT,
    spec                  TEXT,
    serial_no             TEXT,
    purchase_date         TEXT,
    price                 REAL NOT NULL DEFAULT 0,
    location              TEXT,
    custodian_id          INTEGER REFERENCES org_staff(id),
    department_id         INTEGER REFERENCES org_department(id),
    status                TEXT NOT NULL DEFAULT 'in_use',
    need_calibration      INTEGER NOT NULL DEFAULT 0,
    calibration_cycle_days INTEGER NOT NULL DEFAULT 0,
    last_calibration_date TEXT,
    next_calibration_date TEXT,
    warranty_until        TEXT,
    remark                TEXT,
    is_deleted            INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT,
    updated_at            TEXT
);

CREATE TABLE IF NOT EXISTS device_borrow (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id        INTEGER NOT NULL REFERENCES device(id),
    borrower_id      INTEGER REFERENCES org_staff(id),
    borrower_name    TEXT,
    borrower_dept_id INTEGER REFERENCES org_department(id),
    borrow_date      TEXT NOT NULL,
    due_date         TEXT,
    return_date      TEXT,
    status           TEXT NOT NULL DEFAULT 'borrowed',
    purpose          TEXT,
    operator_id      INTEGER REFERENCES sys_user(id),
    return_remark    TEXT,
    created_at       TEXT
);

CREATE TABLE IF NOT EXISTS device_maintenance (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   INTEGER NOT NULL REFERENCES device(id),
    maint_type  TEXT NOT NULL DEFAULT '保养',
    maint_date  TEXT NOT NULL,
    content     TEXT,
    cost        REAL NOT NULL DEFAULT 0,
    vendor      TEXT,
    next_date   TEXT,
    operator_id INTEGER REFERENCES sys_user(id),
    created_at  TEXT
);

CREATE TABLE IF NOT EXISTS device_calibration (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id        INTEGER NOT NULL REFERENCES device(id),
    calibration_date TEXT NOT NULL,
    result           TEXT NOT NULL DEFAULT '合格',
    certificate_no   TEXT,
    agency           TEXT,
    cycle_days       INTEGER NOT NULL DEFAULT 0,
    next_date        TEXT,
    cost             REAL NOT NULL DEFAULT 0,
    operator_id      INTEGER REFERENCES sys_user(id),
    remark           TEXT,
    created_at       TEXT
);

-- ============ 系统 ============
CREATE TABLE IF NOT EXISTS sys_token (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES sys_user(id),
    expires_at TEXT NOT NULL,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS sys_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES sys_user(id),
    action      TEXT,
    target_type TEXT,
    target_id   INTEGER,
    detail      TEXT,
    created_at  TEXT
);

-- ============ 索引 ============
CREATE INDEX IF NOT EXISTS idx_stock_txn_item    ON stock_txn(item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_txn_created ON stock_txn(created_at);
CREATE INDEX IF NOT EXISTS idx_item_type         ON item(item_type, is_deleted);
CREATE INDEX IF NOT EXISTS idx_device_status     ON device(status, is_deleted);
CREATE INDEX IF NOT EXISTS idx_device_next_cal   ON device(next_calibration_date);
CREATE INDEX IF NOT EXISTS idx_borrow_device     ON device_borrow(device_id, status);
CREATE INDEX IF NOT EXISTS idx_issue_dim         ON consumable_issue(item_id, department_id, staff_id, issued_at);
CREATE INDEX IF NOT EXISTS idx_inbound_status    ON inbound_order(status, order_date);
CREATE INDEX IF NOT EXISTS idx_outbound_status   ON outbound_order(status, order_date);
