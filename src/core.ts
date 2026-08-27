import * as fontkit from "fontkit";
import type { Font } from "fontkit";
import { GLYPH_MAP } from "./font-map";

export interface Chapter {
  itemId: string;
  title: string;
  locked: boolean;
}

export interface Book {
  id: string;
  name: string;
  chapters: Chapter[];
  fontUrl: string | null;
}

type State = Record<string, any>;

export function parseFanqieUrl(value: string): { type: "reader" | "page"; id: string } {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("请粘贴完整的番茄小说链接");
  }
  const match = url.pathname.match(/^\/(reader|page)\/(\d+)\/?$/);
  if (!/^(www\.)?fanqienovel\.com$/.test(url.hostname) || !match) {
    throw new Error("仅支持 fanqienovel.com 的书籍页或章节页链接");
  }
  return { type: match[1] as "reader" | "page", id: match[2] };
}

export async function fetchPage(path: string, signal?: AbortSignal): Promise<string> {
  const target = `https://fanqienovel.com${path}`;
  const response = await fetch(`/api/page?url=${encodeURIComponent(target)}`, { signal });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? `请求失败（${response.status}）`);
  }
  return response.text();
}

export function extractInitialState(html: string): State {
  const marker = "window.__INITIAL_STATE__=";
  const markerAt = html.indexOf(marker);
  if (markerAt < 0) throw new Error("页面结构已经变化，暂时无法读取内容");

  const start = html.indexOf("{", markerAt + marker.length);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const char = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw new Error("页面数据不完整，请稍后重试");
}

function getFontUrl(state: State): string | null {
  const css = state.common?.css;
  if (typeof css !== "string") return null;
  return css.match(/url\((https:\/\/[^)]+\.woff2)\)/)?.[1] ?? null;
}

export async function resolveBook(input: string, signal?: AbortSignal): Promise<Book> {
  const parsed = parseFanqieUrl(input);
  let bookId = parsed.id;
  if (parsed.type === "reader") {
    const readerState = extractInitialState(await fetchPage(`/reader/${parsed.id}`, signal));
    bookId = String(readerState.reader?.chapterData?.bookId ?? "");
    if (!bookId) throw new Error("没有在章节页中找到书籍信息");
  }

  const pageState = extractInitialState(await fetchPage(`/page/${bookId}`, signal));
  const page = pageState.page;
  if (!page?.bookName || !Array.isArray(page.chapterListWithVolume)) {
    throw new Error("没有找到书名或章节目录");
  }

  const chapters = page.chapterListWithVolume.flat().map((chapter: State) => ({
    itemId: String(chapter.itemId),
    title: String(chapter.title ?? "未命名章节"),
    locked: Boolean(chapter.isChapterLock),
  }));
  let fontUrl = getFontUrl(pageState);
  if (!fontUrl) {
    const sample = chapters.find((chapter: Chapter) => !chapter.locked);
    if (sample) {
      const readerState = extractInitialState(await fetchPage(`/reader/${sample.itemId}`, signal));
      fontUrl = getFontUrl(readerState);
    }
  }
  return { id: bookId, name: page.bookName, chapters, fontUrl };
}

export async function buildFontMapping(fontUrl: string | null): Promise<Map<string, string>> {
  if (!fontUrl) return new Map();
  const response = await fetch(`/api/font?url=${encodeURIComponent(fontUrl)}`);
  if (!response.ok) throw new Error("字体文件下载失败");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const font = fontkit.create(bytes as never) as Font;
  const mapping = new Map<string, string>();
  for (const codePoint of font.characterSet) {
    const glyphName = font.glyphForCodePoint(codePoint).name ?? "";
    const glyphId = Number(glyphName.replace(/^gid/, ""));
    const decoded = GLYPH_MAP[glyphId];
    if (decoded) mapping.set(String.fromCodePoint(codePoint), decoded);
  }
  return mapping;
}

export function decrypt(value: string, mapping: Map<string, string>): string {
  if (!mapping.size) return value;
  return Array.from(value, (char) => mapping.get(char) ?? char).join("");
}

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const paragraphs = Array.from(doc.querySelectorAll("p"))
    .map((node) => node.textContent?.trim() ?? "")
    .filter(Boolean);
  return (paragraphs.length ? paragraphs.join("\n\n") : doc.body.textContent ?? "").trim();
}

export async function fetchChapter(chapter: Chapter, mapping: Map<string, string>, signal?: AbortSignal) {
  const state = extractInitialState(await fetchPage(`/reader/${chapter.itemId}`, signal));
  const data = state.reader?.chapterData;
  if (!data) throw new Error("章节内容为空");
  return {
    title: decrypt(String(data.title ?? chapter.title), mapping),
    content: decrypt(htmlToText(String(data.content ?? "")), mapping),
  };
}

export function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 100) || "未命名";
}
