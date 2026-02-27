# 番茄小说下载器

下载 [番茄小说](https://fanqienovel.com) 的章节内容，每章保存为独立的 Markdown 文件。自动解密反爬字体，还原真实文字。

## 使用方法

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

## 工作原理

番茄小说使用自定义字体将部分汉字替换为 PUA（Private Use Area）字符来防止爬取。本工具通过以下步骤还原真实文字：

1. 从页面 `window.__INITIAL_STATE__` 提取章节内容和 CSS 中的字体 URL
2. 下载 woff2 字体文件，解析 cmap 表获取 PUA 码点到 glyph ID 的映射
3. 通过内置的 glyph ID → 真实字符映射表还原文字

需付费的锁定章节会自动跳过。

## 致谢

字体映射表来源于 [fanqienovel-decryptor](https://github.com/tianhuoDD/fanqienovel-decryptor)。
