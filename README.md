# InsightNews 管理系统

## 项目简介
InsightNews 管理系统是一个功能完整的前端管理后台，专为高级管理员设计，用于管理平台用户和监控系统运行状态。

## 系统特性

### 🔐 安全认证
- **真实接口登录**: 支持通过 `http://120.79.169.214:8087` 的 True API 使用 **邮箱 + 动态验证码** 登录，自动写入后续所有 API 请求的 `Authorization` 头
- **Token 自动持久化**: True API 返回的 JWT 会在登录成功后写入 `admin_token` 并用于后续请求
- **本地管理员兜底**: 仍保留账号 `admin` / 密码 `123456` 以便在真实接口不可用时访问后台
- **会话管理**: 自动登录状态维护，24小时会话有效期
- **权限控制**: 基于角色的访问控制

### 🌐 True API 对接
- **统一配置**: `js/config.js` 中的 `ENDPOINTS.userService` 映射真实接口（注册、登录、信息、更新、退出、反馈、收藏、注销）
- **API 客户端增强**: `js/api.js` 现支持纯文本响应、`forceNetwork` 强制直连及自动错误提取，便于接入第三方接口
- **认证流程**: `js/auth.js` 登录时调用 True API，使用邮箱 + 验证码/密码换取 JWT，写入 `admin_token` 后调用 `/user/info`；若接口不可用则回落到本地管理员模式
- **辅助文档**: 查看 `True_api.md` 了解目前可用的用户相关接口示例请求

### 👥 用户管理
- **用户列表**: 完整的用户信息展示和搜索
- **用户操作**: 创建、编辑、删除、查看详情
- **批量操作**: 支持多选和批量操作
- **数据导出**: JSON格式数据导出

### 📊 数据可视化
- **仪表盘**: 系统概览和关键指标展示
- **图表展示**: 用户趋势和分布可视化
- **实时数据**: 动态更新的统计数据

### 🎨 用户体验
- **响应式设计**: 完美适配桌面和移动设备
- **主题切换**: 明暗主题一键切换
- **交互优化**: 加载状态、错误提示、确认对话框

## 技术架构

### 前端技术栈
- **HTML5**: 语义化标记和现代Web特性
- **CSS3**: 变量系统、Grid布局、Flexbox
- **JavaScript ES6+**: 模块化、类、异步编程
- **原生API**: Fetch API、LocalStorage、Canvas

### 启动步骤
1. 下载项目并安装依赖
   ```bash
   npm install
   ```
2. 启动内置开发服务器（包含 `/api` 代理）
   ```bash
   # 默认将 /api 代理到 http://120.79.169.214:8087
   npm run dev
   
   # 若需临时切换其他后端，可设置 API_TARGET
   # macOS/Linux
   API_TARGET="https://your-admin-api.example.com" npm run dev
   # PowerShell
   $env:API_TARGET="https://your-admin-api.example.com"; npm run dev
   ```
3. 浏览器访问 `http://127.0.0.1:3000` 即可登录后台。

> 仍可使用任意静态服务器预览页面，但若需要访问真实接口，必须通过 `npm run dev` 以启用代理。

### 对接香港管理后台 API

- **代理层**：`server.js` 会读取 `process.env.API_TARGET`，默认值已更新为香港环境 `http://120.79.169.214:8087`。
- **配置方式**：当前前端配置固定在 `js/config.js`，如需改动 API 基址或固定 token，请直接修改该文件或通过构建时注入不同版本。
- **真实登录优先**：`js/api.js` 会优先读取登录写入的 `admin_token`，若不存在再退回固定 token，确保邮箱验证码登录的 token 始终生效。
1. 下载项目文件到本地目录
2. 使用HTTP服务器启动（避免CORS问题）
   ```bash
   # 使用 Python
   python -m http.server 8000
   
   # 使用 Node.js
   npx http-server
   
   # 使用 PHP
   php -S localhost:8000