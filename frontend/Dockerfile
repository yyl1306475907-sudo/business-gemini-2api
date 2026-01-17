FROM node:18-slim

# 安装 Chromium 和依赖
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libxss1 \
    libasound2 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 设置 Puppeteer 环境变量和内存限制
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_OPTIONS="--max-old-space-size=1024"

WORKDIR /app

# 复制 package.json 并安装依赖
COPY package.json ./
RUN npm install --production --no-audit --no-fund

# 复制应用代码
COPY app-v6.js ./

# 创建数据目录
RUN mkdir -p /tmp/data /tmp/screenshots

# 暴露端口
EXPOSE 7860

# 启动应用
CMD ["node", "--max-old-space-size=1024", "app-v6.js"]
