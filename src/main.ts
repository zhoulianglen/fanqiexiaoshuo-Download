import { strToU8, zipSync } from "fflate";
import "./styles.css";
import { buildFontMapping, fetchChapter, resolveBook, safeFilename, type Book } from "./core";

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
  <header class="masthead">
    <a class="wordmark" href="/" aria-label="番茄藏书首页"><span>番茄</span>藏书</a>
    <p>公开章节 · 本地整理</p>
  </header>
  <section class="hero" aria-labelledby="page-title">
    <div class="hero-copy">
      <p class="eyebrow">A quiet tool for readers · 01</p>
      <h1 id="page-title">把喜欢的故事，<br><em>留在自己的书架。</em></h1>
      <p class="lede">粘贴番茄小说链接。章节解析、文字还原与文件打包都在你的浏览器内完成，不建立在线书库。</p>
    </div>
    <div class="folio" aria-hidden="true"><span>阅</span><b>读</b></div>
  </section>
  <section class="workbench" aria-labelledby="tool-title">
    <div class="section-number" aria-hidden="true">01</div>
    <div class="tool">
      <div class="tool-heading">
        <div><p class="eyebrow">开始整理</p><h2 id="tool-title">粘贴书籍或章节链接</h2></div>
        <span class="privacy-note">文件只在本机生成</span>
      </div>
      <form id="resolve-form">
        <label for="book-url" class="sr-only">番茄小说链接</label>
        <div class="url-row">
          <input id="book-url" type="url" required autocomplete="url" spellcheck="false" placeholder="https://fanqienovel.com/page/…" />
          <button class="primary" type="submit"><span>解析链接</span><span aria-hidden="true">→</span></button>
        </div>
        <p class="field-hint">支持 fanqienovel.com 的 reader 与 page 链接，仅处理公开且未锁定章节。</p>
      </form>
      <div id="status" class="status" aria-live="polite"></div>
    </div>
  </section>
  <section class="principles" aria-label="工作方式">
    <article><span>Ⅰ</span><h3>轻量代理</h3><p>Cloudflare 每次只读取一个公开页面，不在服务器批量打包。</p></article>
    <article><span>Ⅱ</span><h3>本地完成</h3><p>字体还原和文件生成使用你的设备算力，内容不上传到存储桶。</p></article>
    <article><span>Ⅲ</span><h3>有节制地请求</h3><p>逐章顺序处理并保持间隔，暂停后可由你决定是否继续。</p></article>
  </section>
  <footer><p>请仅整理你有权访问的内容。</p><p>不支持付费或锁定章节</p></footer>
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
    status.innerHTML = `<div class="loading-line"><span></span><p><b>正在辨认这本书</b><small>读取书名与公开章节目录…</small></p></div>`;
    return;
  }
  if (state.phase === "error") {
    status.innerHTML = `<div class="notice error"><strong>没有完成</strong><p>${escapeHtml(state.message)}</p></div>`;
    return;
  }
  if (!state.book) return;

  const available = state.book.chapters.filter((chapter) => !chapter.locked).length;
  if (state.phase === "ready") {
    status.innerHTML = `
      <div class="book-result">
        <div class="book-meta"><p class="eyebrow">已找到</p><h3>${escapeHtml(state.book.name)}</h3><p>${state.book.chapters.length} 章 · ${available} 章可整理 · ${state.book.chapters.length - available} 章已锁定</p></div>
        <fieldset><legend>导出格式</legend><label><input type="radio" name="output" value="zip" checked> Markdown ZIP</label><label><input type="radio" name="output" value="txt"> 合并 TXT</label></fieldset>
        <button id="start-download" class="primary" type="button"><span>开始整理 ${available} 章</span><span aria-hidden="true">↓</span></button>
      </div>`;
    document.querySelector("#start-download")?.addEventListener("click", startDownload);
    document.querySelectorAll<HTMLInputElement>('input[name="output"]').forEach((radio) => radio.addEventListener("change", () => state.output = radio.value as "zip" | "txt"));
    return;
  }

  const percent = state.total ? Math.round(state.completed / state.total * 100) : 0;
  const action = state.phase === "downloading"
    ? `<button id="pause-download" class="secondary" type="button">暂停</button>`
    : state.phase === "paused"
      ? `<button id="resume-download" class="primary compact" type="button">继续整理</button>`
      : state.phase === "done"
        ? `<button id="save-download" class="primary compact" type="button">保存到本机</button>` : "";
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
