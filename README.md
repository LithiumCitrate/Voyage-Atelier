# Voyage Atelier

一个基于 Vue 3、Vite、Leaflet 和天地图的旅行行程规划网站。

## 功能

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

在项目根目录新建 `.env.local`，内容如下：

```bash
VITE_TIANDITU_KEY=你的天地图密钥
```

项目里提供了示例文件：[.env.example](d:/code/random/.env.example)

3. 启动开发环境

```bash
npm run dev
```

默认访问地址：

```text
http://localhost:5173
```

## 生产构建

```bash
npm run build
npm run preview
```

## 技术栈

- Vue 3
- Vite
- Leaflet
- 天地图 WMTS / 地理编码 / 路径接口
- 原生 HTML / CSS

## 密钥说明

天地图密钥已从源码中移除，改为通过 Vite 环境变量注入。

注意：这是前端项目，运行时密钥仍会出现在浏览器请求中；这样做只能避免把密钥直接提交到仓库，不能把浏览器端密钥彻底隐藏。
