# Voyage Atelier

一个基于 Vue 3、Vite 和天地图 JavaScript API 的旅行行程规划网站。

## 当前功能

- 欢迎页作为默认首屏，向下滑动或点击按钮进入主规划页
- 编辑旅行基础信息：名称、目的地、日期、节奏、预算、备注
- 在地图上选点后，直接补全一条行程
- 按天查看行程，并在地图上显示同一天内的路线连线
- 搜索地点、回填地点、聚焦单条行程位置
- 拖拽排序当前天的行程，地图路线顺序同步更新
- 编辑已有行程内容并同步地图点位
- 导入和导出 JSON 行程文件
- 默认不写入浏览器本地存储，不保留个人行程数据

## 启动方式

1. 安装依赖

```bash
npm install
```

2. 配置天地图密钥

在项目根目录新建 `.env.local`：

```bash
VITE_TIANDITU_KEY=你的天地图浏览器端密钥
```

示例文件见 [.env.example](d:/code/random/.env.example)。

3. 启动开发环境

```bash
npm run dev
```

默认访问地址：

```text
http://localhost:5173
```

## 地图说明

- 当前地图内核已经全部切换为天地图官方 JavaScript API，不再使用 Leaflet。
- 如果页面提示“天地图加载失败，请检查密钥或网络连接”，优先检查以下几项：
  - `.env.local` 是否存在且已填写 `VITE_TIANDITU_KEY`
  - 使用的是否是“浏览器端”天地图密钥
  - 天地图后台的白名单或允许来源里是否包含 `localhost` 或 `localhost:5173`
  - 修改 `.env.local` 后是否已经重启 `npm run dev`

## 生产构建

```bash
npm run build
npm run preview
```

## 技术栈

- Vue 3
- Vite
- 天地图 JavaScript API 4.0
- 天地图地理编码 / 地名搜索 / 路径接口
- 原生 HTML / CSS

## 密钥说明

天地图密钥已经从源码中移除，改为通过 Vite 环境变量注入。

注意：这是前端项目，浏览器端密钥在运行时仍然会出现在请求中。当前做法只能避免把密钥直接提交到仓库，不能让浏览器端密钥彻底不可见。
