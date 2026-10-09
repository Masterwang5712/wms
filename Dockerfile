# 耗材与设备管理仓库系统 —— 生产容器镜像
# 构建：docker build -t wms .
# 运行：docker run -d --name wms -p 8000:8000 -v /data/wms:/data --restart always wms
FROM python:3.11-slim

# 时区（校准提醒按当地时间判定，务必设置）
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

WORKDIR /app

# 先装依赖，利用镜像层缓存
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 拷贝应用代码与前端
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY start.sh README.md ./

# 数据库落在挂载卷，便于持久化与备份
ENV HOST=0.0.0.0 \
    PORT=8000 \
    WMS_DB=/data/app.db
VOLUME ["/data"]

EXPOSE 8000

# 健康检查：容器编排时可用于就绪探测
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health').status==200 else 1)"

CMD ["python3", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
