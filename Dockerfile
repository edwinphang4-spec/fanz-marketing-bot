FROM node:20-slim
# sharp 渲染 SVG 文字需要系统字体：slim 镜像不带任何字体，
# 没有这行则所有文字叠加静默输出空白字形（2026-07-07 线上实证，
# July 批次成品全部无字）。fonts-dejavu-core 提供 sans-serif 映射。
RUN apt-get update \
  && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "index.js"]
