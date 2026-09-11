import { strToU8, zipSync } from "fflate";
import "./styles.css";
import { buildFontMapping, fetchChapter, resolveBook, safeFilename, type Book } from "./core";

declare global {
  interface Window {
    dataLayer: unknown[][];
    gtag: (...args: unknown[]) => void;
  }
}

window.dataLayer = window.dataLayer || [];
window.gtag = (...args: unknown[]) => window.dataLayer.push(args);
window.gtag("js", new Date());
window.gtag("config", "G-X3DLNRZSTC");

type Phase = "idle" | "resolving" | "ready" | "downloading" | "paused" | "done" | "error";

const state: {
  phase: Phase;
  book: Book | null;
  completed: number;
  total: number;
  message: string;
  files: Record<string, Uint8Array>;
  controller: AbortController | null;
  output: "zip" | "txt";
} = {
  phase: "idle", book: null, completed: 0, total: 0, message: "", files: {}, controller: null, output: "zip",
};

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `
  <a class="skip-link" href="#download-tool">跳到下载工具</a>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="番茄藏书首页">
        <span class="brand-mark" aria-hidden="true"><i></i></span>
        <span>番茄藏书</span>
      </a>
      <div class="service-state"><span aria-hidden="true"></span>服务正常</div>
    </header>

    <main id="download-tool" class="workspace">
      <section class="intro" aria-labelledby="page-title">
        <p class="kicker">免费 · 无需安装 · 本地处理</p>
        <h1 id="page-title">番茄小说公开章节下载器</h1>
        <p>粘贴番茄小说的书籍页或章节页链接，将可公开访问的章节下载为 TXT 或 Markdown ZIP。文件直接在浏览器生成，不会上传到服务器。</p>
      </section>

      <section class="download-panel" aria-label="下载设置">
        <form id="resolve-form">
          <label for="book-url">番茄小说链接</label>
          <div class="url-row">
            <input id="book-url" type="url" required autocomplete="url" spellcheck="false" placeholder="https://fanqienovel.com/page/…" />
            <button class="primary" type="submit">
              <span>解析小说链接</span>
              <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M4 10h11m-4-4 4 4-4 4"/></svg>
            </button>
          </div>
          <div class="form-meta">
            <span><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 1.75 13 4v3.6c0 3.1-2.1 5.8-5 6.65-2.9-.85-5-3.55-5-6.65V4l5-2.25Z"/><path d="m5.8 8 1.4 1.4L10.5 6"/></svg>内容不上传、不留存</span>
            <span>支持书籍页和章节页链接</span>
          </div>
        </form>
        <div id="status" class="status" aria-live="polite"></div>
      </section>

      <aside class="usage-note" aria-label="使用说明">
        <div>
          <span class="note-index">01</span>
          <p><strong>下载公开章节</strong>自动识别书名和目录，跳过登录、付费或已锁定章节。下载时请保持页面打开。</p>
        </div>
        <div>
          <span class="note-index">02</span>
          <p><strong>导出 TXT 或 Markdown</strong>正文还原和文件打包都在你的设备上完成，网站不保存小说内容。</p>
        </div>
      </aside>
    </main>

    <footer class="footer">
      <p>请仅整理你有权访问的内容</p>
      <p>不绕过登录、付费或章节锁定</p>
    </footer>
  </div>
`;

const form = document.querySelector<HTMLFormElement>("#resolve-form")!;
const input = document.querySelector<HTMLInputElement>("#book-url")!;
const status = document.querySelector<HTMLElement>("#status")!;

function escapeHtml(value: string): string {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

function setStatus(): void {
  if (state.phase === "idle") { status.innerHTML = ""; return; }
  if (state.phase === "resolving") {
    status.innerHTML = `<div class="loading-line"><span></span><p><b>正在获取章节</b><small>读取书名与公开目录…</small></p></div>`;
    return;
  }
  if (state.phase === "error") {
    status.innerHTML = `<div class="notice error"><span aria-hidden="true">!</span><div><strong>无法获取</strong><p>${escapeHtml(state.message)}</p></div></div>`;
    return;
  }
  if (!state.book) return;

  const available = state.book.chapters.filter((chapter) => !chapter.locked).length;
  if (state.phase === "ready") {
    status.innerHTML = `
      <div class="book-result">
        <div class="book-meta"><p class="result-label"><span></span>已读取目录</p><h2>${escapeHtml(state.book.name)}</h2><p>共 ${state.book.chapters.length} 章，<b>${available} 章可下载</b><span>，${state.book.chapters.length - available} 章已锁定</span></p></div>
        <div class="result-controls">
          <fieldset><legend>导出格式</legend><div class="format-options"><label><input type="radio" name="output" value="zip" checked><span>Markdown ZIP</span></label><label><input type="radio" name="output" value="txt"><span>合并 TXT</span></label></div></fieldset>
          <button id="start-download" class="primary" type="button"><span>下载 ${available} 章</span><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M10 3v10m-4-4 4 4 4-4M4 16h12"/></svg></button>
        </div>
      </div>`;
    document.querySelector("#start-download")?.addEventListener("click", startDownload);
    document.querySelectorAll<HTMLInputElement>('input[name="output"]').forEach((radio) => radio.addEventListener("change", () => state.output = radio.value as "zip" | "txt"));
    return;
  }

  const percent = state.total ? Math.round(state.completed / state.total * 100) : 0;
  const action = state.phase === "downloading"
    ? `<button id="pause-download" class="secondary" type="button">暂停任务</button>`
    : state.phase === "paused"
      ? `<button id="resume-download" class="primary compact" type="button">继续</button>`
      : state.phase === "done"
        ? `<button id="save-download" class="primary compact" type="button">保存文件</button>` : "";
  status.innerHTML = `
    <div class="progress-block">
      <div class="progress-copy"><p><strong>${escapeHtml(state.book.name)}</strong><span>${state.completed} / ${state.total} 章</span></p><p>${escapeHtml(state.message)}</p></div>
      <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="transform:scaleX(${percent / 100})"></span></div>
      <div class="progress-actions"><b>${percent}%</b>${action}</div>
    </div>`;
  document.querySelector("#pause-download")?.addEventListener("click", pauseDownload);
  document.querySelector("#resume-download")?.addEventListener("click", startDownload);
  document.querySelector("#save-download")?.addEventListener("click", saveDownload);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.controller?.abort();
  state.controller = new AbortController();
  state.phase = "resolving";
  state.book = null;
  setStatus();
  try {
    state.book = await resolveBook(input.value, state.controller.signal);
    state.phase = "ready";
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    state.phase = "error";
    state.message = error instanceof Error ? error.message : "发生未知错误";
  }
  setStatus();
});

function pauseDownload(): void {
  state.controller?.abort();
  state.phase = "paused";
  state.message = "已暂停，当前进度保留在这个页面中";
  setStatus();
}

async function startDownload(): Promise<void> {
  if (!state.book) return;
  state.controller = new AbortController();
  state.phase = "downloading";
  state.files = state.completed ? state.files : {};
  const chapters = state.book.chapters.filter((chapter) => !chapter.locked);
  state.total = chapters.length;
  state.message = state.completed ? "继续整理剩余章节…" : "正在准备文字还原规则…";
  setStatus();

  try {
    const mapping = await buildFontMapping(state.book.fontUrl);
    for (let index = state.completed; index < chapters.length; index += 1) {
      const chapter = chapters[index];
      state.message = `正在整理：${chapter.title}`;
      setStatus();
      const result = await fetchChapter(chapter, mapping, state.controller.signal);
      const heading = `# ${result.title}\n\n${result.content}\n`;
      state.files[`${String(index + 1).padStart(4, "0")}-${safeFilename(result.title)}.md`] = strToU8(heading);
      state.completed = index + 1;
      setStatus();
      if (index < chapters.length - 1) await new Promise((resolve) => setTimeout(resolve, 850));
    }
    state.phase = "done";
    state.message = "整理完成，文件尚未离开你的浏览器";
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    state.phase = "error";
    state.message = error instanceof Error ? `${error.message}（已完成的章节仍保留在页面中）` : "整理过程中发生错误";
  }
  setStatus();
}

function saveDownload(): void {
  if (!state.book) return;
  let blob: Blob;
  let filename: string;
  if (state.output === "txt") {
    const decoder = new TextDecoder();
    const combined = Object.values(state.files).map((bytes) => decoder.decode(bytes).replace(/^# /, "")).join("\n\n\n");
    blob = new Blob([combined], { type: "text/plain;charset=utf-8" });
    filename = `${safeFilename(state.book.name)}.txt`;
  } else {
    const zipped = zipSync(state.files, { level: 6 });
    blob = new Blob([zipped.buffer as ArrayBuffer], { type: "application/zip" });
    filename = `${safeFilename(state.book.name)}-Markdown.zip`;
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
}
