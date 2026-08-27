# 番茄藏书

面向 Cloudflare 的番茄小说公开章节整理工具。用户粘贴书籍页或章节页链接后，网页会逐章读取内容，在浏览器本地完成字体还原与 ZIP/TXT 打包。

项目仍保留原有 Python 命令行工具 `download.py`。

## 网页版架构

- **Cloudflare Worker**：只代理经过白名单校验的番茄书籍页、章节页和字体文件
- **浏览器**：解析目录、还原反爬字体、控制下载节奏并生成文件
- **Cloudflare Cache**：短期复用目录、章节和字体响应
- **无需数据库和对象存储**：小说正文和导出文件不会被上传或长期保存

这种设计让每次 Worker 调用通常只有一个上游请求，计算与打包成本由用户设备承担，更适合低成本公共服务。

## 本地开发

要求 Node.js 22 或更高版本。

```bash
npm install
npm run build
```

联调时分别启动 Worker 与 Vite：

```bash
# 终端一：代理与生产静态资源
npm run dev:worker

# 终端二：带热更新的前端（/api 会转发到 8787 端口）
npm run dev
```

也可以先执行 `npm run build`，再只运行 `npm run dev:worker`，打开 `http://localhost:8787`。

## 部署到 Cloudflare

首次部署前登录 Cloudflare：

```bash
npx wrangler login
npm run deploy
```

部署完成后可在 Cloudflare 控制台绑定自定义域名。正式公开前，建议为 `/api/*` 配置 Cloudflare Rate Limiting 和 Turnstile，并根据可接受成本设置账户用量告警。

### 安全边界

- 页面代理只接受 `fanqienovel.com/page/<数字>` 与 `reader/<数字>`
- 字体代理只接受 `*.bytetos.com/obj/awesome-font/c/*.woff2`
- 拒绝上游跳转，避免白名单绕过和 SSRF
- 页面最大 8 MB、字体最大 5 MB
- 仅整理公开且未锁定章节

> 请仅下载或整理你有权访问的内容，并遵守内容来源的服务条款与适用法律。本项目不绕过登录、付费或章节锁定。

## Python 命令行版本

### 安装依赖

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install fonttools brotli
```

### 下载小说

支持章节页和书籍页两种 URL：

```bash
# 从章节页 URL
python3 download.py https://fanqienovel.com/reader/7362805062902481432 -o ./output

# 从书籍页 URL
python3 download.py https://fanqienovel.com/page/7362803513664998424 -o ./output
```

### 参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `url` | 番茄小说 URL（必填） | - |
| `-o, --output` | 输出目录 | 当前目录 |
| `-d, --delay` | 章节间下载间隔（秒） | 1.0 |

### 输出格式

下载的文件按 `序号-章节标题.md` 命名，存放在以书名命名的子目录中：

```
output/
└── 书名/
    ├── 001-第1章 标题.md
    ├── 002-第2章 标题.md
    └── ...
```

## 字体还原原理

番茄小说使用自定义字体将部分汉字替换为 PUA（Private Use Area）字符来防止爬取。本工具通过以下步骤还原真实文字：

1. 从页面 `window.__INITIAL_STATE__` 提取章节内容和 CSS 中的字体 URL
2. 下载 woff2 字体文件，解析 cmap 表获取 PUA 码点到 glyph ID 的映射
3. 通过内置的 glyph ID → 真实字符映射表还原文字

需付费的锁定章节会自动跳过。

## 致谢

字体映射表来源于 [fanqienovel-decryptor](https://github.com/tianhuoDD/fanqienovel-decryptor)。
