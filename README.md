# 耗材与设备管理仓库系统（WMS）

面向企业 / 单位内部仓库的**前后端一体**管理系统，覆盖耗材出入库、实时库存、设备全生命周期（台账 / 借还 / 维保 / 校准）、领用消耗统计与报表导出。

- **后端**：FastAPI + Python 标准库 `sqlite3`（零额外 ORM 依赖）
- **前端**：原生 JS 单页应用（无框架、无构建、**零 CDN**），手写 SVG 图表
- **数据库**：SQLite（首次启动自动建表并写入演示数据）
- **鉴权**：Token + 三角色（管理员 / 仓管员 / 普通用户）

## 快速开始

```bash
cd /workspace
./start.sh
```

启动后访问 <http://localhost:8000>。接口文档 <http://localhost:8000/docs>。

也可手动启动：

```bash
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

> 端口被占用时 `start.sh` 会自动切换到下一个可用端口；也可用 `PORT=8080 ./start.sh` 指定。
> 如需重置数据库，删除 `/workspace/app.db*` 后重启即可（会重新写入演示数据）。

## 演示账号

| 账号 | 密码 | 角色 | 权限 |
|---|---|---|---|
| admin | admin123 | 系统管理员 | 全部功能，含基础数据与用户管理 |
| keeper | keeper123 | 仓库管理员 | 出入库、设备、借还、维保、校准、报表；不能删基础数据 |
| user | user123 | 普通用户 | 查看 + 领用申请；不能确认出入库 |

## 功能模块

| 模块 | 说明 |
|---|---|
| **数据看板** | 库存货值 / 本月出入库 / 设备总数 / 低库存 / 校准待处理 / 逾期未还 六项 KPI，30 天出入库趋势（SVG 折线）、分类货值占比（环形）、消耗排行、设备状态分布、待处理提醒面板 |
| **物品档案** | 耗材 / 设备基础信息 CRUD，编码自动生成（HC/SB 前缀），安全库存、参考单价、库位、供应商 |
| **实时库存** | 库存台账（水位条 + 低库存/缺货高亮）、出入库流水查询、盘点调整、Excel 导出 |
| **入库管理** | 多明细行入库单（自动带出单价、批次号、有效期），保存草稿或直接确认；确认后事务性增加库存 |
| **出库管理** | 多明细行出库单，前端即时校验 + 后端权威校验，**库存不足整单回滚**；出库类型支持领用/调拨/报废/销售 |
| **领用与消耗** | 快速领用登记；按**部门 / 人员 / 物品 / 月份**四维度消耗统计（图表 + 明细 + 导出） |
| **设备台账** | 设备全生命周期：状态机流转（在用 ↔ 闲置 / 维修中 / 报废，借出专用路径）、设备详情抽屉含**履历时间线** |
| **借用归还** | 借出登记（仅可借设备）、一键归还、**逾期未还**专项视图与红色告警 |
| **维保记录** | 保养 / 维修 / 故障记录，费用统计；登记维修或故障后设备自动置为「维修中」 |
| **校准提醒** | 三色统计（已过期 / 临期 30 天内 / 正常），按剩余天数排序；登记校准后自动计算下次校准日期 |
| **统计报表** | 年月度报表（入库 / 出库 / 部门消耗 / 物品消耗 / 维保 / 校准多 sheet），支持打印与 Excel 导出 |
| **基础数据** | 部门、人员、物品分类、供应商管理（仅管理员） |

## 核心业务规则

- **库存原子性**：所有库存变更在 `BEGIN IMMEDIATE` 写事务内完成，`item.current_stock` 与 `stock_txn` 流水严格同事务一致。
- **禁止负库存**：出库 / 领用时逐行校验，库存不足返回明确缺口信息并**整单回滚**，不做部分成功。
- **设备状态机**：非法流转被拒绝；维修中、已报废设备不可借出；有未归还记录的设备不可删除或改状态；归还后回到「在用」。
- **校准判定**：`下次校准 < 今天` → 已过期（红）；`≤ 今天+30 天` → 临期（橙）；其余正常（绿）。周期为 0 视为无需校准。
- **低库存预警**：`安全库存 > 0 且 当前库存 ≤ 安全库存` 触发；库存为 0 标记缺货（最高优先级）。
- **删除语义**：物品 / 设备 / 部门等采用逻辑删除，保护历史流水；有库存或流水的物品禁止删除。

## 目录结构

```
/workspace
├── start.sh                    一键启动脚本
├── Dockerfile                  生产容器镜像
├── .dockerignore               构建忽略清单
├── deploy/
│   └── wms.service             systemd 服务单元（生产常驻）
├── app.db                      SQLite 数据库（首次启动自动生成）
├── backend/
│   ├── main.py                 FastAPI 入口（API 路由 + 前端静态托管）
│   ├── config.py               配置常量
│   ├── db.py                   连接管理 + BEGIN IMMEDIATE 事务封装
│   ├── schema.sql              全部建表 DDL 与索引
│   ├── seed.py                 演示种子数据
│   ├── security.py             密码哈希 / Token / 角色校验
│   ├── utils.py                日期、编号、分页工具
│   ├── models/schemas.py       pydantic 请求模型
│   ├── services/inventory.py   库存原子变更服务（出入库共用）
│   └── routers/                auth base_data items stock inbound outbound
│                               consumables devices borrows maintenance
│                               calibration reports export
└── frontend/
    ├── index.html              SPA 外壳
    ├── css/theme.css app.css   CSS 变量主题（红涨绿跌）+ 布局样式
    └── js/                     api router store ui charts main
        └── pages/              dashboard items stock inbound outbound
                                consumables devices borrows maintenance
                                calibration reports basedata
```

## API 一览（前缀 `/api`）

| 分类 | 主要端点 |
|---|---|
| 认证 | `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` |
| 基础数据 | `GET/POST/PUT/DELETE /departments` `/staff` `/categories` `/suppliers` |
| 物品 | `GET/POST /items` · `GET /items/options` · `GET/PUT/DELETE /items/{id}` · `GET /items/{id}/txns` |
| 库存 | `GET /stock` · `GET /stock/alerts` · `GET /stock/txns` · `POST /stock/adjust` |
| 入库 | `GET/POST /inbound` · `GET /inbound/{id}` · `POST /inbound/{id}/confirm` |
| 出库 | `GET/POST /outbound` · `GET /outbound/{id}` · `POST /outbound/{id}/confirm` |
| 耗材 | `POST /consumables/issue` · `GET /consumables/issues` · `GET /consumables/stats?dim=` |
| 设备 | `GET/POST /devices` · `GET/PUT/DELETE /devices/{id}` · `POST /devices/{id}/status` · `GET /devices/{id}/timeline` |
| 借用 | `GET/POST /borrows` · `POST /borrows/{id}/return` · `GET /borrows/overdue` |
| 维保 | `GET/POST /maintenance` · `DELETE /maintenance/{id}` |
| 校准 | `GET/POST /calibrations` · `GET /calibrations/alerts?within=30` |
| 报表 | `GET /reports/overview` `/trend` `/monthly` `/consumption-top` `/category-share` `/device-summary` |
| 导出 | `GET /export/inventory.xlsx` `items` `txns` `consumption` `devices` `monthly` `calibration` `borrows` |

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | 8000 | 服务端口 |
| `HOST` | 0.0.0.0 | 监听地址（生产建议 `127.0.0.1` + Nginx 反代） |
| `WMS_DB` | ./app.db | 数据库文件路径（生产建议指向独立数据盘） |
| `CALIBRATION_WARN_DAYS` | 30 | 校准临期提醒天数 |
| `TOKEN_TTL_HOURS` | 24 | 登录有效期（小时） |
| `BORROW_WARN_DAYS` | 3 | 借用到期提醒天数 |

## 部署指南

本系统是**单体应用**（FastAPI 同时提供 API 与前端静态页面），无 MySQL/Redis 等外部依赖，也无 Node 构建步骤，拷贝到任意装了 Python 3.9+ 的机器即可运行。

### 一、依赖要求

| 项 | 要求 | 说明 |
|---|---|---|
| Python | 3.9+（推荐 3.11） | 代码使用了 `str \| None` 联合类型语法 |
| pip 包 | fastapi / uvicorn / pydantic / openpyxl | 见 `requirements.txt` |
| 数据库 | **无需安装** | Python 自带 `sqlite3` 标准库 |
| 反向代理（可选） | Nginx / Caddy | 用于 HTTPS 与 80 端口 |

### 二、标准部署（Linux / macOS）

```bash
# 1. 拷贝项目到目标机器
scp -r ./ user@server:/opt/wms && cd /opt/wms

# 2. 创建虚拟环境（推荐，避免污染系统 Python）
python3 -m venv venv && source venv/bin/activate

# 3. 安装依赖
pip install -r requirements.txt

# 4. 启动（首次启动自动建表 + 写入演示数据）
./start.sh
```

访问 `http://服务器IP:8000`，接口文档 `/docs`。

### 三、生产常驻（systemd）

项目已附带 [`deploy/wms.service`](deploy/wms.service)，按注释修改路径后：

```bash
sudo cp deploy/wms.service /etc/systemd/system/wms.service
sudo systemctl daemon-reload
sudo systemctl enable --now wms
sudo systemctl status wms       # 查看状态
sudo journalctl -u wms -f       # 实时日志
```

### 四、Docker 部署

项目已附带 [`Dockerfile`](Dockerfile)：

```bash
docker build -t wms .
docker run -d --name wms -p 8000:8000 -v /data/wms:/data --restart always wms
```

数据持久化在宿主机的 `/data/wms` 目录。

### 五、生产环境必做的三件事

**1. 修改默认密码** — 演示账号 `admin/admin123` 等**必须**在首次登录后修改，否则任何人都能登录。

**2. 前置反向代理 + HTTPS**（Nginx 示例）：

```nginx
server {
    listen 80;
    server_name wms.example.com;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    client_max_body_size 20m;
}
```

随后用 `certbot --nginx` 一键申请证书。

**3. 数据备份** — SQLite 备份即拷贝单文件，但 **WAL 模式下必须用 `.backup`**，直接 `cp` 可能丢失最近事务：

```bash
# 定时任务：每天 02:00 备份，保留 30 天
0 2 * * * sqlite3 /opt/wms/app.db ".backup '/backup/wms-$(date +\%F).db'" && find /backup -name 'wms-*.db' -mtime +30 -delete
```

### 六、升级与重置

```bash
# 升级：覆盖代码后重启即可，建表语句幂等，不会删除数据
sudo systemctl restart wms

# 重置为演示数据：删除数据库后重启
rm -f /opt/wms/app.db* && sudo systemctl restart wms
```

> ⚠️ **容量说明**：本系统为单进程 SQLite 架构，适合单机部署、并发几十人以内的企业内部场景。若需高并发或多实例横向扩展，需改用 PostgreSQL/MySQL 并引入外部会话存储（主要改动点为 `db.py` 与 `security.py`）。
