"""演示种子数据：部门/人员/账号/分类/供应商/耗材/设备/历史出入库/借用/维保/校准。"""
import random
from datetime import date, timedelta

from .db import query_scalar, transaction, write_txn
from .security import hash_password
from .utils import add_days, gen_order_no, month_range, now_str, round2, today_str

RND = random.Random(20260101)

DEPARTMENTS = [
    ("综合办公室", "张伟"),
    ("研发中心", "李强"),
    ("质量检验部", "王芳"),
    ("生产制造部", "刘洋"),
    ("设备工程部", "陈静"),
]

STAFF = [
    ("张伟", "综合办公室", "GH1001", "13800000001"),
    ("李强", "研发中心", "GH1002", "13800000002"),
    ("王芳", "质量检验部", "GH1003", "13800000003"),
    ("刘洋", "生产制造部", "GH1004", "13800000004"),
    ("陈静", "设备工程部", "GH1005", "13800000005"),
    ("赵磊", "研发中心", "GH1006", "13800000006"),
    ("孙悦", "质量检验部", "GH1007", "13800000007"),
    ("周浩", "生产制造部", "GH1008", "13800000008"),
    ("吴敏", "综合办公室", "GH1009", "13800000009"),
    ("郑凯", "设备工程部", "GH1010", "13800000010"),
]

CATEGORIES = {
    "耗材": ["实验试剂", "办公耗材", "清洁用品", "防护用品", "五金配件"],
    "设备": ["检测仪器", "生产设备", "办公设备", "计量器具"],
}

SUPPLIERS = [
    ("国药试剂（上海）有限公司", "杨经理", "021-60000001", "上海市浦东新区张江路 88 号"),
    ("华东办公用品批发中心", "孙老板", "025-80000002", "南京市玄武区中央路 120 号"),
    ("安捷伦科技（中国）有限公司", "刘工", "010-50000003", "北京市朝阳区酒仙桥路 6 号"),
    ("苏州精密仪器制造有限公司", "徐总", "0512-70000004", "苏州市工业园区星湖街 218 号"),
    ("明辉清洁用品商行", "马经理", "0571-90000005", "杭州市余杭区文一西路 969 号"),
]

# (编码, 名称, 分类, 规格, 单位, 品牌, 安全库存, 期初库存, 单价, 库位)
CONSUMABLES = [
    ("HC00001", "无水乙醇", "实验试剂", "AR 500mL", "瓶", "国药", 30, 120, 28.50, "A-01-01"),
    ("HC00002", "移液枪吸头", "实验试剂", "1000μL 96支/盒", "盒", "Axygen", 20, 85, 62.00, "A-01-02"),
    ("HC00003", "一次性手套", "防护用品", "丁腈 M 号 100只/盒", "盒", "英科", 40, 200, 45.00, "A-02-01"),
    ("HC00004", "A4 复印纸", "办公耗材", "70g 500张/包", "包", "晨光", 60, 320, 23.80, "B-01-01"),
    ("HC00005", "硒鼓", "办公耗材", "HP CF280A", "个", "惠普", 10, 26, 385.00, "B-01-02"),
    ("HC00006", "中性笔", "办公耗材", "0.5mm 黑色", "支", "晨光", 100, 560, 2.50, "B-01-03"),
    ("HC00007", "灭菌培养基", "实验试剂", "LB 250g/瓶", "瓶", "OXOID", 15, 48, 158.00, "A-01-03"),
    ("HC00008", "离心管", "实验试剂", "50mL 圆底 500个/包", "包", "Corning", 12, 55, 92.00, "A-01-04"),
    ("HC00009", "一次性口罩", "防护用品", "医用外科 50只/盒", "盒", "稳健", 50, 180, 32.00, "A-02-02"),
    ("HC00010", "防护眼镜", "防护用品", "防飞溅", "副", "3M", 25, 70, 38.00, "A-02-03"),
    ("HC00011", "多酶清洗剂", "清洁用品", "5L/桶", "桶", "明辉", 8, 18, 268.00, "C-01-01"),
    ("HC00012", "无尘布", "清洁用品", "9寸 100片/包", "包", "明辉", 30, 96, 56.00, "C-01-02"),
    ("HC00013", "记号笔", "办公耗材", "粗细双头", "支", "斑马", 60, 240, 8.50, "B-01-04"),
    ("HC00014", "移液器吸头盒", "实验试剂", "96孔 PP", "个", "Axygen", 15, 42, 46.00, "A-01-05"),
    ("HC00015", "丁腈手套", "防护用品", "L 号 100只/盒", "盒", "英科", 40, 150, 48.00, "A-02-04"),
    ("HC00016", "六角螺栓", "五金配件", "M8×40 304不锈钢 100个/包", "包", "国标", 20, 65, 42.00, "D-01-01"),
    ("HC00017", "生料带", "五金配件", "20m/卷", "卷", "国标", 30, 88, 5.50, "D-01-02"),
    ("HC00018", "标记标签纸", "办公耗材", "24×70mm 500张/卷", "卷", "兄弟", 25, 72, 34.00, "B-01-05"),
    ("HC00019", "pH 试纸", "实验试剂", "1-14 广泛试纸 80条/本", "本", "国药", 35, 105, 12.00, "A-01-06"),
    ("HC00020", "实验室天平砝码组", "五金配件", "1mg-200g 套装", "套", "上海舜宇", 3, 6, 1280.00, "D-02-01"),
    # 特意设置几个低库存，用于演示预警
    ("HC00021", "乙醇消毒液", "清洁用品", "75% 2.5L/桶", "桶", "明辉", 30, 12, 36.00, "C-01-03"),
    ("HC00022", "移液器密封圈", "五金配件", "通用型 10个/包", "包", "Axygen", 20, 0, 25.00, "D-01-03"),
]

# (资产编号, 名称, 分类, 品牌, 型号, 序列号, 购置日期偏移天数, 价格, 库位, 责任人, 部门, 状态, 校准周期天)
DEVICES = [
    ("SB00001", "高效液相色谱仪", "检测仪器", "Agilent", "1260 Infinity II", "AGL1260-2021-001", -1180, 386000, "仪器室-01", "王芳", "质量检验部", "in_use", 365),
    ("SB00002", "电子分析天平", "计量器具", "梅特勒", "ME204E", "MT204-2022-014", -960, 32800, "仪器室-02", "孙悦", "质量检验部", "in_use", 365),
    ("SB00003", "生物显微镜", "检测仪器", "奥林巴斯", "CX43", "OLY43-2022-007", -880, 18600, "仪器室-03", "王芳", "质量检验部", "in_use", 730),
    ("SB00004", "紫外分光光度计", "检测仪器", "岛津", "UV-1900i", "SHM1900-2021-022", -1090, 76500, "仪器室-04", "孙悦", "质量检验部", "idle", 365),
    ("SB00005", "恒温培养箱", "生产设备", "上海一恒", "BPH-9042A", "YH9042-2023-031", -540, 12800, "实验室 201", "赵磊", "研发中心", "in_use", 365),
    ("SB00006", "超纯水机", "生产设备", "Millipore", "Milli-Q Direct 8", "MQD8-2022-005", -820, 88600, "实验室 202", "赵磊", "研发中心", "in_use", 180),
    ("SB00007", "高速离心机", "生产设备", "Eppendorf", "5425R", "EP5425-2023-018", -470, 42500, "实验室 203", "李强", "研发中心", "in_use", 365),
    ("SB00008", "双光束分光光度计", "检测仪器", "Thermo", "Evolution 201", "TH201-2020-009", -1520, 92800, "仪器室-05", "王芳", "质量检验部", "repairing", 365),
    ("SB00009", "数显游标卡尺", "计量器具", "三丰", "500-196-30", "MF500-2023-044", -390, 1680, "车间工具柜1", "周浩", "生产制造部", "in_use", 180),
    ("SB00010", "数字万用表", "计量器具", "福禄克", "Fluke 87V", "FL87V-2022-011", -900, 3480, "设备部工具间", "郑凯", "设备工程部", "borrowed", 365),
    ("SB00011", "激光测距仪", "计量器具", "徕卡", "DISTO X4", "LX4-2023-026", -430, 2680, "设备部工具间", "陈静", "设备工程部", "idle", 365),
    ("SB00012", "笔记本电脑", "办公设备", "联想", "ThinkPad T14", "LN-T14-2024-051", -320, 7800, "研发中心办公区", "李强", "研发中心", "in_use", 0),
    ("SB00013", "投影仪", "办公设备", "爱普生", "CB-X06", "EPS-X06-2022-003", -1010, 4200, "会议室 A", "张伟", "综合办公室", "idle", 0),
    ("SB00014", "空调净化机", "生产设备", "格力", "KFR-72LW", "GL-72LW-2021-015", -1260, 9200, "实验室 201", "陈静", "设备工程部", "in_use", 0),
    ("SB00015", "冰箱（-80℃）", "生产设备", "海尔", "DW-86L388J", "HR-86L-2021-002", -1420, 68000, "冷库", "赵磊", "研发中心", "in_use", 365),
    ("SB00016", "原子吸收光谱仪", "检测仪器", "岛津", "AA-7000", "SHMAA-2018-004", -2260, 268000, "仪器室-06", "王芳", "质量检验部", "scrapped", 0),
]


def _is_empty() -> bool:
    with write_txn() as conn:
        return query_scalar(conn, "SELECT COUNT(*) FROM sys_user") == 0


def seed(force: bool = False) -> None:
    if not force and not _is_empty():
        return
    _seed_all()


def _seed_all() -> None:
    with write_txn() as conn:
        c = conn
        ts = now_str()

        # 部门
        dept_ids = {}
        for name, mgr in DEPARTMENTS:
            cur = c.execute("INSERT INTO org_department(name, manager, created_at) VALUES(?,?,?)",
                            (name, mgr, ts))
            dept_ids[name] = cur.lastrowid

        # 人员
        staff_ids = {}
        for name, dept, job_no, phone in STAFF:
            cur = c.execute(
                "INSERT INTO org_staff(name, department_id, job_no, phone, status, created_at) "
                "VALUES(?,?,?,?,?,?)",
                (name, dept_ids.get(dept), job_no, phone, "active", ts))
            staff_ids[name] = cur.lastrowid

        # 用户
        c.execute("INSERT INTO sys_user(username, password_hash, display_name, role, department_id, created_at) VALUES(?,?,?,?,?,?)",
                  ("admin", hash_password("admin123"), "系统管理员", "admin", dept_ids["综合办公室"], ts))
        c.execute("INSERT INTO sys_user(username, password_hash, display_name, role, department_id, created_at) VALUES(?,?,?,?,?,?)",
                  ("keeper", hash_password("keeper123"), "仓库管理员·吴敏", "keeper", dept_ids["综合办公室"], ts))
        c.execute("INSERT INTO sys_user(username, password_hash, display_name, role, department_id, created_at) VALUES(?,?,?,?,?,?)",
                  ("user", hash_password("user123"), "李强（研发中心）", "dept_user", dept_ids["研发中心"], ts))

        # 分类
        cat_ids = {}
        sort = 0
        for group, names in CATEGORIES.items():
            for n in names:
                sort += 1
                cur = c.execute("INSERT INTO item_category(name, sort_order) VALUES(?,?)", (n, sort))
                cat_ids[n] = cur.lastrowid
        # 设备分类不建独立物品记录，设备表直接用分类 id

        # 供应商
        sup_ids = {}
        for name, contact, phone, addr in SUPPLIERS:
            cur = c.execute("INSERT INTO supplier(name, contact, phone, address, created_at) VALUES(?,?,?,?,?)",
                            (name, contact, phone, addr, ts))
            sup_ids[name] = cur.lastrowid

        # 耗材物品
        item_ids = {}
        for (code, name, cat, spec, unit, brand, safety, stock, price, loc) in CONSUMABLES:
            sup = None
            if cat == "实验试剂":
                sup = sup_ids["国药试剂（上海）有限公司"]
            elif cat == "办公耗材":
                sup = sup_ids["华东办公用品批发中心"]
            elif cat == "清洁用品":
                sup = sup_ids["明辉清洁用品商行"]
            cur = c.execute("""
                INSERT INTO item(code, name, category_id, item_type, spec, unit, brand,
                                 safety_stock, current_stock, unit_price, location, supplier_id,
                                 created_at, updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (code, name, cat_ids.get(cat), "consumable", spec, unit, brand,
                  safety, stock, price, loc, sup, ts, ts))
            item_ids[code] = cur.lastrowid
            # 期初库存写一条流水，保证余额可追溯
            if stock > 0:
                c.execute("""
                    INSERT INTO stock_txn(item_id, txn_type, quantity, before_qty, after_qty,
                                          unit_price, amount, ref_type, remark, created_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?)
                """, (cur.lastrowid, "in", stock, 0, stock, price, round2(stock * price),
                      "init", "期初库存结存", ts))

        # 设备
        dev_ids = {}
        for (asset_no, name, cat, brand, model, sn, offset, price, loc, custodian, dept,
             status, cycle) in DEVICES:
            purchase = add_days(today_str(), offset)
            need_cal = 1 if cycle > 0 else 0
            # 上次校准时间：按周期回推一段随机时间，制造不同剩余天数
            last_cal = None
            next_cal = None
            if need_cal:
                # 让部分设备已过期、部分临期、部分正常
                ratio = RND.choice([0.6, 0.75, 0.9, 1.0, 1.12, 1.3])
                days_ago = int(cycle * ratio)
                last_cal = add_days(today_str(), -days_ago)
                next_cal = add_days(last_cal, cycle)
            cur = c.execute("""
                INSERT INTO device(asset_no, name, category_id, brand, model, spec, serial_no,
                                   purchase_date, price, location, custodian_id, department_id,
                                   status, need_calibration, calibration_cycle_days,
                                   last_calibration_date, next_calibration_date, warranty_until,
                                   created_at, updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (asset_no, name, cat_ids.get(cat), brand, model, model, sn, purchase, price, loc,
                  staff_ids.get(custodian), dept_ids.get(dept), status, need_cal, cycle,
                  last_cal, next_cal, add_days(purchase, 1095), ts, ts))
            dev_ids[asset_no] = cur.lastrowid

        # 校准记录（对已校准设备补一条历史）
        for asset_no, (asset_no2, name, cat, brand, model, sn, offset, price, loc, custodian,
                       dept, status, cycle) in zip(dev_ids, DEVICES):
            d = _get_device(c, dev_ids[asset_no])
            if d and d["last_calibration_date"]:
                c.execute("""
                    INSERT INTO device_calibration(device_id, calibration_date, result,
                                                   certificate_no, agency, cycle_days, next_date,
                                                   cost, operator_id, created_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?)
                """, (dev_ids[asset_no], d["last_calibration_date"], "合格",
                      f"JL{asset_no[-5:]}-{RND.randint(100, 999)}",
                      RND.choice(["省计量科学研究院", "市计量测试所", "中国计量院"]),
                      cycle, d["next_calibration_date"], round2(RND.choice([380, 450, 600, 800])),
                      1, ts))

        # 维保记录
        maint_data = [
            ("SB00001", "保养", -120, "更换流动相过滤头，清洗色谱柱，检查管路密封性", 1850.0, "安捷伦科技（中国）有限公司"),
            ("SB00005", "维修", -75, "温控模块故障，更换加热元件与温度传感器", 960.0, "上海一恒售后"),
            ("SB00008", "故障", -30, "光路系统异常，检测器信号漂移，送厂检修", 0.0, "Thermo 维修中心"),
            ("SB00002", "保养", -60, "天平水平校准，内部砝码自校，清洁称量室", 420.0, "梅特勒服务商"),
            ("SB00015", "保养", -95, "更换门封条，除霜清理，检查压缩机运行电流", 680.0, "海尔售后"),
            ("SB00006", "保养", -45, "更换预处理柱与终端滤器，耗材更换", 2260.0, "Millipore 服务"),
        ]
        for asset_no, mtype, off, content, cost, vendor in maint_data:
            c.execute("""
                INSERT INTO device_maintenance(device_id, maint_type, maint_date, content,
                                               cost, vendor, operator_id, created_at)
                VALUES(?,?,?,?,?,?,?,?)
            """, (dev_ids[asset_no], mtype, add_days(today_str(), off), content, cost, vendor, 1, ts))

        # 借还记录
        borrows = [
            ("SB00010", "郑凯", "设备工程部", -12, -2, None, "borrowed", "前往车间进行电气参数测量"),
            ("SB00013", "吴敏", "综合办公室", -25, -18, -19, "returned", "季度会议投影使用"),
            ("SB00009", "周浩", "生产制造部", -40, -33, -34, "returned", "工件尺寸抽检"),
            ("SB00011", "陈静", "设备工程部", -55, -48, -50, "returned", "机房面积测量"),
            ("SB00003", "孙悦", "质量检验部", -80, -73, -74, "returned", "样品显微观察"),
            ("SB00007", "赵磊", "研发中心", -8, -1, None, "borrowed", "外送样品离心处理"),
        ]
        for asset_no, borrower, dept, b_off, d_off, r_off, st, purpose in borrows:
            c.execute("""
                INSERT INTO device_borrow(device_id, borrower_id, borrower_name, borrower_dept_id,
                                          borrow_date, due_date, return_date, status, purpose,
                                          operator_id, created_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)
            """, (dev_ids[asset_no], staff_ids.get(borrower), borrower, dept_ids.get(dept),
                  add_days(today_str(), b_off), add_days(today_str(), d_off),
                  add_days(today_str(), r_off) if r_off else None, st, purpose, 2, ts))

        # 历史出库（耗材领用）+ 入库单，覆盖近 3 个月
        _seed_history(c, item_ids, dept_ids, staff_ids, sup_ids)

        # 操作日志
        c.execute("INSERT INTO sys_log(user_id, action, target_type, detail, created_at) VALUES(?,?,?,?,?)",
                  (1, "init", "system", "系统初始化完成，已写入演示数据", ts))


def _get_device(conn, device_id: int):
    row = conn.execute("SELECT * FROM device WHERE id=?", (device_id,)).fetchone()
    return dict(row) if row else None


def _seed_history(c, item_ids, dept_ids, staff_ids, sup_ids) -> None:
    """生成近 3 个月的入库单与出库领用单。"""
    today = date.today()
    months = []
    for back in range(2, -1, -1):
        m = today.month - back
        y = today.year
        while m <= 0:
            m += 12
            y -= 1
        months.append((y, m))

    op_keeper = 2   # keeper 用户 id
    consume_items = [(code, iid) for code, iid in item_ids.items()]
    staff_pool = list(staff_ids.items())
    dept_names = list(dept_ids.keys())

    for y, m in months:
        start, end = month_range(y, m)
        # 每月 2 张入库单
        for _ in range(2):
            sup_name = RND.choice(SUPPLIERS)[0]
            odate = _rand_date_in(y, m)
            order_no = f"RK{odate.replace('-', '')}{RND.randint(1000, 9999)}"
            cur = c.execute("""
                INSERT INTO inbound_order(order_no, order_date, supplier_id, supplier_name,
                                          status, handler, operator_id, remark, created_at, confirmed_at)
                VALUES(?,?,?,?,?,?,?,?,?,?)
            """, (order_no, odate, sup_ids.get(sup_name), sup_name, "confirmed",
                  "吴敏", op_keeper, "月度采购入库", odate + " 09:30:00", odate + " 09:35:00"))
            oid = cur.lastrowid
            total = 0.0
            for code, iid in RND.sample(consume_items, k=RND.randint(2, 4)):
                qty = RND.choice([20, 30, 50, 80, 100, 120, 200])
                price = _item_price(c, iid)
                amt = round2(qty * price)
                total += amt
                c.execute("""
                    INSERT INTO inbound_item(order_id, item_id, quantity, unit_price, amount, batch_no)
                    VALUES(?,?,?,?,?,?)
                """, (oid, iid, qty, price, amt, f"P{odate[:7].replace('-', '')}{RND.randint(100, 999)}"))
                before = _stock(c, iid)
                after = before + qty
                c.execute("UPDATE item SET current_stock=? WHERE id=?", (after, iid))
                c.execute("""
                    INSERT INTO stock_txn(item_id, txn_type, quantity, before_qty, after_qty,
                                          unit_price, amount, ref_type, ref_id, operator_id, remark, created_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                """, (iid, "in", qty, before, after, price, amt, "inbound", oid, op_keeper,
                      f"入库单 {order_no}", odate + " 09:35:00"))
            c.execute("UPDATE inbound_order SET total_amount=? WHERE id=?", (round2(total), oid))

        # 每月 5 张出库领用单
        for _ in range(5):
            odate = _rand_date_in(y, m)
            dept_name = RND.choice(dept_names)
            dept_id = dept_ids[dept_name]
            dept_staff = [s for s in staff_pool if s[1] == dept_id] or staff_pool
            borrower, bid = RND.choice(dept_staff)
            order_no = f"CK{odate.replace('-', '')}{RND.randint(1000, 9999)}"
            cust = RND.choice(["日常办公领用", "实验耗材补充", "车间生产消耗", "清洁保养使用"])
            cur = c.execute("""
                INSERT INTO outbound_order(order_no, order_date, out_type, department_id,
                                           receiver, staff_id, purpose, status, operator_id,
                                           remark, created_at, confirmed_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            """, (order_no, odate, "consume", dept_id, borrower, bid, cust, "confirmed",
                  op_keeper, "耗材领用", odate + " 14:00:00", odate + " 14:02:00"))
            oid = cur.lastrowid
            total = 0.0
            for code, iid in RND.sample(consume_items, k=RND.randint(1, 3)):
                avail = _stock(c, iid)
                if avail <= 0:
                    continue
                qty = min(RND.choice([2, 3, 5, 8, 10, 15, 20]), avail)
                if qty <= 0:
                    continue
                price = _item_price(c, iid)
                amt = round2(qty * price)
                total += amt
                c.execute("""
                    INSERT INTO outbound_item(order_id, item_id, quantity, unit_price, amount)
                    VALUES(?,?,?,?,?)
                """, (oid, iid, qty, price, amt))
                before = avail
                after = before - qty
                c.execute("UPDATE item SET current_stock=? WHERE id=?", (after, iid))
                c.execute("""
                    INSERT INTO stock_txn(item_id, txn_type, quantity, before_qty, after_qty,
                                          unit_price, amount, ref_type, ref_id, department_id,
                                          operator_id, remark, created_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (iid, "out", qty, before, after, price, amt, "outbound", oid, dept_id,
                      op_keeper, f"出库单 {order_no}", odate + " 14:02:00"))
                # 领用登记
                c.execute("""
                    INSERT INTO consumable_issue(order_id, order_no, item_id, quantity, unit_price,
                                                 amount, department_id, staff_id, purpose, issued_at,
                                                 operator_id, created_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                """, (oid, order_no, iid, qty, price, amt, dept_id, bid, cust, odate, op_keeper,
                      odate + " 14:02:00"))
            if total > 0:
                c.execute("UPDATE outbound_order SET total_amount=? WHERE id=?", (round2(total), oid))
            else:
                c.execute("DELETE FROM outbound_order WHERE id=?", (oid,))


def _rand_date_in(y: int, m: int) -> str:
    start, end = month_range(y, m)
    s = date.fromisoformat(start)
    e = date.fromisoformat(end)
    span = max(1, (e - s).days)
    d = s + timedelta(days=RND.randint(0, span))
    # 不超出今天
    if d > date.today():
        d = date.today()
    return d.isoformat()


def _stock(conn, item_id: int) -> int:
    return query_scalar(conn, "SELECT current_stock FROM item WHERE id=?", (item_id,))


def _item_price(conn, item_id: int) -> float:
    return float(query_scalar(conn, "SELECT unit_price FROM item WHERE id=?", (item_id,)) or 0)
