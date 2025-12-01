const path = require('path');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;
const API_TARGET = process.env.API_TARGET || 'http://120.79.169.214:8087';

// 代理 /api 前缀到真实后端（移除 /api 前缀）
app.use(
  '/api',
  createProxyMiddleware({
    target: API_TARGET,
    changeOrigin: true,
    pathRewrite: {
      '^/api/(.*)': '/$1'
    }
  })
);

// 代理其他API前缀到真实后端
app.use(
  ['/detection', '/user', '/topic', '/admin'],
  createProxyMiddleware({
    target: API_TARGET,
    changeOrigin: true
  })
);

// 静态资源
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Dev server running at http://127.0.0.1:${PORT}`);
  console.log(`Proxying /api -> ${API_TARGET}`);
});
