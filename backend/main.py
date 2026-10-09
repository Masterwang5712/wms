"""FastAPI 应用入口：API 路由 + 前端静态托管。"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import FRONTEND_DIR
from .db import init_db
from .seed import seed
from .routers import (auth, base_data, borrows, calibration, consumables, devices,
                      export, inbound, items, maintenance, outbound, reports, stock)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    seed()
    yield


app = FastAPI(title="耗材与设备管理仓库系统", version="1.0.0", lifespan=lifespan)

# ---------- API 路由（必须先于静态挂载注册） ----------
API_PREFIX = "/api"
app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(base_data.router, prefix=API_PREFIX)
app.include_router(items.router, prefix=API_PREFIX)
app.include_router(stock.router, prefix=API_PREFIX)
app.include_router(inbound.router, prefix=API_PREFIX)
app.include_router(outbound.router, prefix=API_PREFIX)
app.include_router(consumables.router, prefix=API_PREFIX)
app.include_router(devices.router, prefix=API_PREFIX)
app.include_router(borrows.router, prefix=API_PREFIX)
app.include_router(maintenance.router, prefix=API_PREFIX)
app.include_router(calibration.router, prefix=API_PREFIX)
app.include_router(reports.router, prefix=API_PREFIX)
app.include_router(export.router, prefix=API_PREFIX)


@app.get(f"{API_PREFIX}/health")
def health():
    return {"status": "ok", "service": "wms"}


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"detail": "请求参数不合法", "errors": exc.errors()})


# ---------- 前端静态资源 ----------
app.mount("/css", StaticFiles(directory=FRONTEND_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=FRONTEND_DIR / "js"), name="js")
app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")


@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/download/wms-source.zip")
def download_source():
    """源码包下载（供部署时取用）。"""
    import os
    zip_path = FRONTEND_DIR.parent / "wms-source.zip"
    if not zip_path.exists():
        zip_path = FRONTEND_DIR.parent.parent / "wms-source.zip"
    if not zip_path.exists():
        return JSONResponse(status_code=404, content={"detail": "源码包不存在"})
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename="wms-source.zip",
        headers={"Content-Disposition": "attachment; filename=wms-source.zip"},
    )


@app.get("/favicon.ico")
def favicon():
    icon = FRONTEND_DIR / "assets" / "logo.svg"
    if icon.exists():
        return FileResponse(icon, media_type="image/svg+xml")
    return JSONResponse(status_code=204, content=None)
