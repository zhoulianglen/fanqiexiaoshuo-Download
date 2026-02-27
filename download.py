#!/usr/bin/env python3
"""番茄小说下载器 - 下载番茄小说的完整章节内容，保存为 Markdown 文件。

支持反爬字体解密，自动将 PUA 字符还原为真实文字。
"""

import argparse
import io
import json
import os
import re
import time
import urllib.request

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/133.0.0.0 Safari/537.36"
    ),
}

# 字体 glyph ID → 真实字符 映射表
# 来源: https://github.com/tianhuoDD/fanqienovel-decryptor
FONT_MAP = {
    '58670': '0', '58413': '1', '58678': '2', '58371': '3', '58353': '4',
    '58480': '5', '58359': '6', '58449': '7', '58540': '8', '58692': '9',
    '58712': 'a', '58542': 'b', '58575': 'c', '58626': 'd', '58691': 'e',
    '58561': 'f', '58362': 'g', '58619': 'h', '58430': 'i', '58531': 'j',
    '58588': 'k', '58440': 'l', '58681': 'm', '58631': 'n', '58376': 'o',
    '58429': 'p', '58555': 'q', '58498': 'r', '58518': 's', '58453': 't',
    '58397': 'u', '58356': 'v', '58435': 'w', '58514': 'x', '58482': 'y',
    '58529': 'z', '58515': 'A', '58688': 'B', '58709': 'C', '58344': 'D',
    '58656': 'E', '58381': 'F', '58576': 'G', '58516': 'H', '58463': 'I',
    '58649': 'J', '58571': 'K', '58558': 'L', '58433': 'M', '58517': 'N',
    '58387': 'O', '58687': 'P', '58537': 'Q', '58541': 'R', '58458': 'S',
    '58390': 'T', '58466': 'U', '58386': 'V', '58697': 'W', '58519': 'X',
    '58511': 'Y', '58634': 'Z', '58611': '的', '58590': '一', '58398': '是',
    '58422': '了', '58657': '我', '58666': '不', '58562': '人', '58345': '在',
    '58510': '他', '58496': '有', '58654': '这', '58441': '个', '58493': '上',
    '58714': '们', '58618': '来', '58528': '到', '58620': '时', '58403': '大',
    '58461': '地', '58481': '为', '58700': '子', '58708': '中', '58503': '你',
    '58442': '说', '58639': '生', '58506': '国', '58663': '年', '58436': '着',
    '58563': '就', '58391': '那', '58357': '和', '58354': '要', '58695': '她',
    '58372': '出', '58696': '也', '58551': '得', '58445': '里', '58408': '后',
    '58599': '自', '58424': '以', '58394': '会', '58348': '家', '58426': '可',
    '58673': '下', '58417': '而', '58556': '过', '58603': '天', '58565': '去',
    '58604': '能', '58522': '对', '58632': '小', '58622': '多', '58350': '然',
    '58605': '于', '58617': '心', '58401': '学', '58637': '么', '58684': '之',
    '58382': '都', '58464': '好', '58487': '看', '58693': '起', '58608': '发',
    '58392': '当', '58474': '没', '58601': '成', '58355': '只', '58573': '如',
    '58499': '事', '58469': '把', '58361': '还', '58698': '用', '58489': '第',
    '58711': '样', '58457': '道', '58635': '想', '58492': '作', '58647': '种',
    '58623': '开', '58521': '美', '58609': '总', '58530': '从', '58665': '无',
    '58652': '情', '58676': '己', '58456': '面', '58581': '最', '58509': '女',
    '58488': '但', '58363': '现', '58685': '前', '58396': '些', '58523': '所',
    '58471': '同', '58485': '日', '58613': '手', '58533': '又', '58589': '行',
    '58527': '意', '58593': '动', '58699': '方', '58707': '期', '58414': '它',
    '58596': '头', '58570': '经', '58660': '长', '58364': '儿', '58526': '回',
    '58501': '位', '58638': '分', '58404': '爱', '58677': '老', '58535': '因',
    '58629': '很', '58577': '给', '58606': '名', '58497': '法', '58662': '间',
    '58479': '斯', '58532': '知', '58380': '世', '58385': '什', '58405': '两',
    '58644': '次', '58578': '使', '58505': '身', '58564': '者', '58412': '被',
    '58686': '高', '58624': '已', '58667': '亲', '58607': '其', '58616': '进',
    '58368': '此', '58427': '话', '58423': '常', '58633': '与', '58525': '活',
    '58543': '正', '58418': '感', '58597': '见', '58683': '明', '58507': '问',
    '58621': '力', '58703': '理', '58438': '尔', '58536': '点', '58384': '文',
    '58484': '几', '58539': '定', '58554': '本', '58421': '公', '58347': '特',
    '58569': '做', '58710': '外', '58574': '孩', '58375': '相', '58645': '西',
    '58592': '果', '58572': '走', '58388': '将', '58370': '月', '58399': '十',
    '58651': '实', '58546': '向', '58504': '声', '58419': '车', '58407': '全',
    '58672': '信', '58675': '重', '58538': '三', '58465': '机', '58374': '工',
    '58579': '物', '58402': '气', '58702': '每', '58553': '并', '58360': '别',
    '58389': '真', '58560': '打', '58690': '太', '58473': '新', '58512': '比',
    '58653': '才', '58704': '便', '58545': '夫', '58641': '再', '58475': '书',
    '58583': '部', '58472': '水', '58478': '像', '58664': '眼', '58586': '等',
    '58568': '体', '58674': '却', '58490': '加', '58476': '电', '58346': '主',
    '58630': '界', '58595': '门', '58502': '利', '58713': '海', '58587': '受',
    '58548': '听', '58351': '表', '58547': '德', '58443': '少', '58460': '克',
    '58636': '代', '58585': '员', '58625': '许', '58694': '稜', '58428': '先',
    '58640': '口', '58628': '由', '58612': '死', '58446': '安', '58468': '写',
    '58410': '性', '58508': '马', '58594': '光', '58483': '白', '58544': '或',
    '58495': '住', '58450': '难', '58643': '望', '58486': '教', '58406': '命',
    '58447': '花', '58669': '结', '58415': '乐', '58444': '色', '58549': '更',
    '58494': '拉', '58409': '东', '58658': '神', '58557': '记', '58602': '处',
    '58559': '让', '58610': '母', '58513': '父', '58500': '应', '58378': '直',
    '58680': '字', '58352': '场', '58383': '平', '58454': '报', '58671': '友',
    '58668': '关', '58452': '放', '58627': '至', '58400': '张', '58455': '认',
    '58416': '接', '58552': '告', '58614': '入', '58582': '笑', '58534': '内',
    '58701': '英', '58349': '军', '58491': '候', '58467': '民', '58365': '岁',
    '58598': '往', '58425': '何', '58462': '度', '58420': '山', '58661': '觉',
    '58615': '路', '58648': '带', '58470': '万', '58377': '男', '58520': '边',
    '58646': '风', '58600': '解', '58431': '叫', '58715': '任', '58524': '金',
    '58439': '快', '58566': '原', '58477': '吃', '58642': '妈', '58437': '变',
    '58411': '通', '58451': '师', '58395': '立', '58369': '象', '58706': '数',
    '58705': '四', '58379': '失', '58567': '满', '58373': '战', '58448': '远',
    '58659': '格', '58434': '士', '58679': '音', '58432': '轻', '58689': '目',
    '58591': '条', '58682': '呢',
}


def fetch_url(url: str) -> str:
    """发起 HTTP GET 请求，返回响应文本。"""
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def fetch_bytes(url: str) -> bytes:
    """发起 HTTP GET 请求，返回响应字节。"""
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def extract_initial_state(html: str) -> dict:
    """从 HTML 中提取 window.__INITIAL_STATE__ JSON 数据。"""
    marker = "window.__INITIAL_STATE__="
    start = html.find(marker)
    if start == -1:
        raise ValueError("无法从页面中提取 __INITIAL_STATE__ 数据")
    start += len(marker)
    depth = 0
    end = start
    for i in range(start, len(html)):
        if html[i] == "{":
            depth += 1
        elif html[i] == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    return json.loads(html[start:end])


def build_font_mapping(html: str) -> dict:
    """从页面的自定义字体中构建 PUA → 真实字符 的映射表。

    工作原理：
    1. 从 CSS 中提取自定义字体的 woff2 URL
    2. 下载字体文件，解析 cmap 表（PUA 码点 → glyph 名称如 "gid58670"）
    3. 用 FONT_MAP 将 glyph ID 映射到真实字符
    """
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        print("警告: fontTools 未安装，无法解密字体。请运行: pip install fonttools brotli")
        return {}

    # 从 __INITIAL_STATE__ 中提取 CSS
    state = extract_initial_state(html)
    css = state.get("common", {}).get("css", "")
    if not css:
        return {}

    # 提取 woff2 字体 URL
    font_url_match = re.search(r'url\((https://[^)]+\.woff2)\)', css)
    if not font_url_match:
        return {}

    font_url = font_url_match.group(1)
    font_data = fetch_bytes(font_url)
    font = TTFont(io.BytesIO(font_data))
    cmap = font.getBestCmap()

    # 构建映射: PUA 字符 → 真实字符
    mapping = {}
    for pua_codepoint, glyph_name in cmap.items():
        gid = glyph_name.replace("gid", "")
        if gid in FONT_MAP:
            mapping[chr(pua_codepoint)] = FONT_MAP[gid]

    return mapping


def decrypt_content(text: str, mapping: dict) -> str:
    """将文本中的 PUA 字符替换为真实字符。"""
    if not mapping:
        return text
    return "".join(mapping.get(ch, ch) for ch in text)


def parse_url(url: str) -> tuple[str, str]:
    """解析 URL，返回 (url_type, id)。url_type 为 'reader' 或 'page'。"""
    m = re.search(r"fanqienovel\.com/(reader|page)/(\d+)", url)
    if not m:
        raise ValueError(f"无法解析 URL: {url}")
    return m.group(1), m.group(2)


def get_book_info_from_reader(item_id: str) -> tuple[str, dict]:
    """从章节页面获取 bookId 和字体映射。"""
    html = fetch_url(f"https://fanqienovel.com/reader/{item_id}")
    state = extract_initial_state(html)
    font_mapping = build_font_mapping(html)
    return state["reader"]["chapterData"]["bookId"], font_mapping


def get_chapter_list(book_id: str) -> tuple[str, list[dict], dict]:
    """获取小说目录，返回 (书名, 章节列表, 字体映射)。"""
    html = fetch_url(f"https://fanqienovel.com/page/{book_id}")
    state = extract_initial_state(html)
    font_mapping = build_font_mapping(html)

    book_name = state["page"]["bookName"]
    chapters = []
    for volume in state["page"]["chapterListWithVolume"]:
        for ch in volume:
            chapters.append(
                {
                    "item_id": ch["itemId"],
                    "title": ch.get("title", ""),
                    "is_locked": ch.get("isChapterLock", False),
                }
            )
    return book_name, chapters, font_mapping


def html_to_markdown(html_content: str) -> str:
    """将章节 HTML 内容转换为 Markdown 文本。"""
    text = html_content
    text = re.sub(r"<p[^>]*>", "", text)
    text = re.sub(r"</p>", "\n\n", text)
    text = re.sub(r"<br\s*/?>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("&nbsp;", " ")
    text = text.replace("&lt;", "<")
    text = text.replace("&gt;", ">")
    text = text.replace("&amp;", "&")
    text = text.replace("&quot;", '"')
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def download_chapter(item_id: str, font_mapping: dict) -> tuple[str, str]:
    """下载单个章节，返回 (标题, markdown内容)。"""
    html = fetch_url(f"https://fanqienovel.com/reader/{item_id}")
    state = extract_initial_state(html)

    chapter_data = state["reader"]["chapterData"]
    title = chapter_data.get("title", "未知标题")
    content = chapter_data.get("content", "")

    # 先转 Markdown，再解密字体
    markdown = html_to_markdown(content)
    markdown = decrypt_content(markdown, font_mapping)
    title = decrypt_content(title, font_mapping)
    return title, markdown


def sanitize_filename(name: str) -> str:
    """清理文件名中的非法字符。"""
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip()


def main():
    parser = argparse.ArgumentParser(description="番茄小说下载器")
    parser.add_argument("url", help="番茄小说 URL（章节页或书籍页）")
    parser.add_argument(
        "-o", "--output", default=".", help="输出目录（默认当前目录）"
    )
    parser.add_argument(
        "-d", "--delay", type=float, default=1.0, help="章节间下载延迟秒数（默认 1.0）"
    )
    args = parser.parse_args()

    # 解析 URL
    url_type, url_id = parse_url(args.url)

    # 获取 bookId 和字体映射
    if url_type == "reader":
        print("从章节页获取书籍信息...")
        book_id, font_mapping = get_book_info_from_reader(url_id)
    else:
        book_id = url_id
        font_mapping = {}

    # 获取目录
    print("获取小说目录...")
    book_name, chapters, page_font_mapping = get_chapter_list(book_id)
    # 合并字体映射（不同页面可能用相同的映射）
    if page_font_mapping:
        font_mapping.update(page_font_mapping)

    print(f"小说: {book_name}")
    print(f"共 {len(chapters)} 章")
    print(f"字体映射: {len(font_mapping)} 个字符")

    # 创建输出目录
    output_dir = os.path.join(args.output, sanitize_filename(book_name))
    os.makedirs(output_dir, exist_ok=True)
    print(f"输出目录: {output_dir}\n")

    # 逐章下载
    downloaded = 0
    skipped = 0
    for i, ch in enumerate(chapters, 1):
        prefix = f"[{i}/{len(chapters)}]"

        if ch["is_locked"]:
            print(f"{prefix} 跳过（需付费）: {ch['title']}")
            skipped += 1
            continue

        print(f"{prefix} 下载: {ch['title']}...", end=" ", flush=True)
        try:
            title, content = download_chapter(ch["item_id"], font_mapping)
            md = f"# {title}\n\n{content}\n"
            filename = f"{i:03d}-{sanitize_filename(title)}.md"
            filepath = os.path.join(output_dir, filename)
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(md)
            print("完成")
            downloaded += 1
        except Exception as e:
            print(f"失败: {e}")

        if i < len(chapters):
            time.sleep(args.delay)

    print(f"\n下载完成！共 {downloaded} 章，跳过 {skipped} 章（需付费）")
    print(f"文件保存在: {output_dir}")


if __name__ == "__main__":
    main()
