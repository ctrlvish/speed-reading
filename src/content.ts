import { Readability } from "@mozilla/readability";
import atkinsonFontUrl from "@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2?inline";
import { tokenizeArticleText } from "./tokenize";

type ReaderWindow = Window & typeof globalThis & {
    __speedReader?: SpeedReader;
};

type WordParts = {
    before: string;
    focus: string;
    after: string;
};

const readerWindow = window as ReaderWindow;

function getOrpIndex(length: number): number {
    if (length <= 1) return 0;
    if (length <= 5) return 1;
    if (length <= 9) return 2;
    if (length <= 13) return 3;
    return 4;
}

function splitWord(word: string): WordParts {
    const visibleCharacters = Array.from(word);
    const letterPositions = visibleCharacters
        .map((character, index) => (/^[\p{L}\p{N}]$/u.test(character) ? index : -1))
        .filter((index) => index >= 0);

    if (letterPositions.length === 0) {
        return { before: "", focus: visibleCharacters[0] ?? "", after: visibleCharacters.slice(1).join("") };
    }

    const focusPosition = letterPositions[Math.min(getOrpIndex(letterPositions.length), letterPositions.length - 1)];
    return {
        before: visibleCharacters.slice(0, focusPosition).join(""),
        focus: visibleCharacters[focusPosition],
        after: visibleCharacters.slice(focusPosition + 1).join(""),
    };
}

function icon(name: "close" | "back" | "forward" | "pause" | "play"): string {
    const paths = {
        close: '<path d="M18 6 6 18M6 6l12 12"/>',
        back: '<path d="m12 8-5 4 5 4v-3.2c3.2 0 5.3 1 6.5 3.2-.3-4.6-2.8-7-6.5-7.2V8Z"/><path d="M5 7v4H1"/>',
        forward: '<path d="m12 8 5 4-5 4v-3.2c-3.2 0-5.3 1-6.5 3.2.3-4.6 2.8-7 6.5-7.2V8Z"/><path d="M19 7v4h4"/>',
        pause: '<path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" stroke="none"/>',
        play: '<path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none"/>',
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}

class SpeedReader {
    private readonly host: HTMLDivElement;
    private readonly root: ShadowRoot;
    private readonly words: string[];
    private index = 0;
    private wpm = 350;
    private playing = false;
    private hasStarted = false;
    private timer: number | undefined;
    private lastFrame = performance.now();
    private remaining = this.interval;

    constructor(words: string[], title: string) {
        this.words = words;
        this.host = document.createElement("div");
        this.host.id = "speed-reader-root";
        this.root = this.host.attachShadow({ mode: "open" });
        this.root.innerHTML = `<style>${styles}</style>${this.template(title)}`;
        document.documentElement.appendChild(this.host);
        document.documentElement.style.overflow = "hidden";
        this.bindEvents();
        this.render();
        requestAnimationFrame(() => this.root.querySelector(".shell")?.classList.add("is-visible"));
        this.schedule();
    }

    private get interval(): number {
        return 60_000 / this.wpm;
    }

    private template(title: string): string {
        return `
            <main class="shell" role="dialog" aria-modal="true" aria-label="Speed reader">
                <header class="topbar">
                    <div class="brand"><span class="brand-mark"></span>Speed Reader</div>
                    <div class="article-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
                    <button class="icon-button close" aria-label="Close reader">${icon("close")}</button>
                </header>

                <section class="stage" aria-live="off">
                    <div class="guide guide-top"></div>
                    <div class="word" aria-label="Current word">
                        <span class="before"></span>
                        <span class="focus"></span>
                        <span class="after"></span>
                    </div>
                    <div class="guide guide-bottom"></div>
                    <div class="start-prompt" role="status">
                        <span>Press</span><kbd>Space</kbd><span>to begin</span>
                    </div>
                </section>

                <footer class="controls">
                    <div class="progress-row">
                        <span class="position">1 of ${this.words.length.toLocaleString()}</span>
                        <div class="progress-track"><div class="progress-fill"></div></div>
                        <span class="remaining">0 min left</span>
                    </div>
                    <div class="control-row">
                        <div class="speed-control">
                            <label for="speed-reader-wpm">Speed</label>
                            <input id="speed-reader-wpm" type="range" min="100" max="900" step="25" value="350" aria-label="Words per minute">
                            <output>350 <span>WPM</span></output>
                        </div>
                        <div class="transport">
                            <button class="icon-button rewind" aria-label="Rewind 10 words">${icon("back")}<kbd>←</kbd></button>
                            <button class="play-button" aria-label="Pause">${icon("pause")}</button>
                            <button class="icon-button forward" aria-label="Skip 10 words">${icon("forward")}<kbd>→</kbd></button>
                        </div>
                        <div class="hint"><kbd>Space</kbd><span>Play / pause</span><kbd>Esc</kbd><span>Close</span></div>
                    </div>
                </footer>
            </main>`;
    }

    private bindEvents(): void {
        this.root.querySelector(".close")?.addEventListener("click", () => this.destroy());
        this.root.querySelector(".play-button")?.addEventListener("click", () => this.toggle());
        this.root.querySelector(".rewind")?.addEventListener("click", () => this.seek(-10));
        this.root.querySelector(".forward")?.addEventListener("click", () => this.seek(10));
        this.root.querySelector<HTMLInputElement>("#speed-reader-wpm")?.addEventListener("input", (event) => {
            this.wpm = Number((event.target as HTMLInputElement).value);
            this.remaining = this.interval;
            this.root.querySelector("output")!.innerHTML = `${this.wpm} <span>WPM</span>`;
            this.schedule();
            this.renderMeta();
        });
        document.addEventListener("keydown", this.onKeyDown, true);
    }

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" && event.key !== "Escape") return;

        if ([" ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape"].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
        }

        if (event.key === " ") this.toggle();
        if (event.key === "ArrowLeft") this.seek(-10);
        if (event.key === "ArrowRight") this.seek(10);
        if (event.key === "ArrowUp") this.setSpeed(this.wpm + 25);
        if (event.key === "ArrowDown") this.setSpeed(this.wpm - 25);
        if (event.key === "Escape") this.destroy();
    };

    private schedule(): void {
        window.clearTimeout(this.timer);
        if (!this.playing) return;
        this.lastFrame = performance.now();
        this.timer = window.setTimeout(() => this.advance(), this.remaining);
    }

    private advance(): void {
        if (this.index >= this.words.length - 1) {
            this.playing = false;
            this.renderControls();
            return;
        }
        this.index += 1;
        this.remaining = this.interval;
        this.render();
        this.schedule();
    }

    private toggle(): void {
        if (this.index >= this.words.length - 1 && !this.playing) this.index = 0;
        this.playing = !this.playing;
        if (!this.playing) {
            this.remaining = Math.max(0, this.remaining - (performance.now() - this.lastFrame));
        } else {
            this.hasStarted = true;
            if (this.remaining <= 0) this.remaining = this.interval;
            this.schedule();
        }
        this.render();
    }

    private seek(amount: number): void {
        this.index = Math.max(0, Math.min(this.words.length - 1, this.index + amount));
        this.remaining = this.interval;
        this.render();
        this.schedule();
    }

    private setSpeed(speed: number): void {
        this.wpm = Math.max(100, Math.min(900, speed));
        const input = this.root.querySelector<HTMLInputElement>("#speed-reader-wpm")!;
        input.value = String(this.wpm);
        this.root.querySelector("output")!.innerHTML = `${this.wpm} <span>WPM</span>`;
        this.remaining = this.interval;
        this.renderMeta();
        this.schedule();
    }

    private render(): void {
        const parts = splitWord(this.words[this.index]);
        this.root.querySelector(".before")!.textContent = parts.before;
        this.root.querySelector(".focus")!.textContent = parts.focus;
        this.root.querySelector(".after")!.textContent = parts.after;
        this.renderMeta();
        this.renderControls();
    }

    private renderMeta(): void {
        const count = this.words.length;
        const progress = count <= 1 ? 100 : (this.index / (count - 1)) * 100;
        const minutesLeft = Math.max(0, Math.ceil((count - this.index - 1) / this.wpm));
        this.root.querySelector(".position")!.textContent = `${(this.index + 1).toLocaleString()} of ${count.toLocaleString()}`;
        this.root.querySelector<HTMLElement>(".progress-fill")!.style.width = `${progress}%`;
        this.root.querySelector(".remaining")!.textContent = `${minutesLeft} min left`;
    }

    private renderControls(): void {
        const button = this.root.querySelector<HTMLButtonElement>(".play-button")!;
        button.innerHTML = icon(this.playing ? "pause" : "play");
        button.setAttribute("aria-label", this.playing ? "Pause" : "Play");
        this.root.querySelector(".start-prompt")?.classList.toggle("is-hidden", this.hasStarted);
    }

    destroy(): void {
        window.clearTimeout(this.timer);
        document.removeEventListener("keydown", this.onKeyDown, true);
        this.root.querySelector(".shell")?.classList.remove("is-visible");
        window.setTimeout(() => this.host.remove(), 180);
        document.documentElement.style.overflow = "";
        delete readerWindow.__speedReader;
    }
}

function escapeHtml(value: string): string {
    const element = document.createElement("div");
    element.textContent = value;
    return element.innerHTML;
}

function showExtractionNotice(): void {
    const existing = document.getElementById("speed-reader-extraction-notice");
    existing?.remove();
    const notice = document.createElement("div");
    notice.id = "speed-reader-extraction-notice";
    const root = notice.attachShadow({ mode: "open" });
    root.innerHTML = `
        <style>
            :host { all: initial; }
            .notice { position: fixed; z-index: 2147483647; right: 24px; bottom: 24px; width: 312px; box-sizing: border-box; padding: 18px; color: #f4f0e8; background: #181716; border: 1px solid #35322f; border-radius: 12px; box-shadow: 0 18px 55px #0008; font: 14px/1.45 ui-sans-serif, system-ui, sans-serif; animation: enter .2s ease-out; }
            strong { display: block; margin-bottom: 5px; font-weight: 600; letter-spacing: -.01em; }
            p { margin: 0; color: #aaa39a; }
            @keyframes enter { from { opacity: 0; transform: translateY(8px); } }
        </style>
        <div class="notice" role="status"><strong>No article found</strong><p>Speed Reader works best on pages with a clear article or essay.</p></div>`;
    document.documentElement.appendChild(notice);
    window.setTimeout(() => notice.remove(), 4500);
}

function cloneWithoutNonArticleText(): Document {
    const clonedDocument = document.cloneNode(true) as Document;
    const excludedSelectors = [
        "figure",
        "figcaption",
        ".caption",
        ".image-caption",
        ".photo-caption",
        "[data-testid*='caption' i]",
    ];

    clonedDocument
        .querySelectorAll(excludedSelectors.join(","))
        .forEach((element) => element.remove());

    return clonedDocument;
}

function launch(): void {
    if (readerWindow.__speedReader) {
        readerWindow.__speedReader.destroy();
        return;
    }

    const article = new Readability(cloneWithoutNonArticleText()).parse();
    const words = tokenizeArticleText(article?.textContent ?? "");

    if (words.length < 20) {
        showExtractionNotice();
        return;
    }

    readerWindow.__speedReader = new SpeedReader(
        words,
        article?.title || document.title || "Untitled article",
    );
}

const styles = `
    @font-face {
        font-family: "Atkinson Hyperlegible";
        font-style: normal;
        font-display: swap;
        font-weight: 400;
        src: url("${atkinsonFontUrl}") format("woff2");
    }
    :host {
        all: initial;
        color-scheme: dark;
        --paper: #f3efe7;
        --muted: #928c83;
        --line: #34312e;
        --surface: #151412;
        --accent: #ef5a42;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    button, input { font: inherit; }
    button { color: inherit; }
    .shell {
        position: fixed;
        z-index: 2147483647;
        inset: 0;
        display: grid;
        grid-template-rows: 72px 1fr auto;
        min-width: 320px;
        min-height: 480px;
        overflow: hidden;
        color: var(--paper);
        background:
            radial-gradient(circle at 50% 43%, rgba(255,255,255,.025), transparent 32%),
            #11100f;
        opacity: 0;
        transition: opacity 180ms ease;
    }
    .shell::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        opacity: .025;
        background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.8'/%3E%3C/svg%3E");
    }
    .shell.is-visible { opacity: 1; }
    .topbar {
        display: grid;
        grid-template-columns: 1fr minmax(0, 1.2fr) 1fr;
        align-items: center;
        padding: 0 28px;
        border-bottom: 1px solid rgba(255,255,255,.07);
    }
    .brand { display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 600; letter-spacing: -.01em; }
    .brand-mark { width: 7px; height: 7px; background: var(--accent); border-radius: 50%; box-shadow: 0 0 18px rgba(239,90,66,.45); }
    .article-title { overflow: hidden; color: var(--muted); font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
    .icon-button, .play-button { display: grid; place-items: center; padding: 0; border: 0; cursor: pointer; }
    .icon-button { width: 36px; height: 36px; background: transparent; border-radius: 8px; transition: color .15s ease, background .15s ease; }
    .icon-button:hover { color: #fff; background: rgba(255,255,255,.06); }
    .icon-button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    .close { justify-self: end; color: var(--muted); }
    .stage { position: relative; display: grid; place-items: center; min-height: 0; }
    .word {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
        align-items: baseline;
        width: min(92vw, 1180px);
        font-family: "Atkinson Hyperlegible", ui-sans-serif, sans-serif;
        font-size: clamp(52px, 8.2vw, 126px);
        font-weight: 400;
        line-height: 1;
        letter-spacing: -.01em;
        font-variant-ligatures: none;
        text-wrap: nowrap;
    }
    .before { justify-self: end; }
    .focus { justify-self: center; color: var(--accent); }
    .after { justify-self: start; }
    .guide { position: absolute; left: 50%; width: 1px; height: 28px; background: var(--accent); opacity: .9; }
    .guide::after { content: ""; position: absolute; left: -3px; width: 7px; height: 1px; background: var(--accent); }
    .guide-top { top: calc(50% - 92px); }
    .guide-top::after { top: 0; }
    .guide-bottom { top: calc(50% + 64px); }
    .guide-bottom::after { bottom: 0; }
    .start-prompt {
        position: absolute;
        top: calc(50% + 126px);
        display: flex;
        align-items: center;
        gap: 7px;
        color: #6f6a63;
        font: 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
        letter-spacing: .02em;
        transition: opacity .2s ease, transform .2s ease;
    }
    .start-prompt kbd {
        padding: 5px 7px;
        color: #aaa39a;
        background: rgba(255,255,255,.035);
        border: 1px solid #35322f;
        border-radius: 5px;
        box-shadow: 0 1px 0 #000;
        font: inherit;
    }
    .start-prompt.is-hidden { opacity: 0; transform: translateY(4px); pointer-events: none; }
    .controls { padding: 0 28px 24px; }
    .progress-row { display: grid; grid-template-columns: 94px 1fr 94px; align-items: center; gap: 16px; color: var(--muted); font: 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: .04em; }
    .remaining { text-align: right; }
    .progress-track { height: 1px; overflow: hidden; background: var(--line); }
    .progress-fill { width: 0; height: 100%; background: var(--paper); transition: width .16s linear; }
    .control-row {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        min-height: 88px;
        margin-top: 14px;
        padding: 0 20px;
        background: rgba(24,23,21,.82);
        border: 1px solid rgba(255,255,255,.075);
        border-radius: 14px;
        box-shadow: 0 16px 42px rgba(0,0,0,.2);
        backdrop-filter: blur(16px);
    }
    .speed-control { display: grid; grid-template-columns: auto minmax(100px, 180px) 74px; align-items: center; gap: 14px; }
    .speed-control label { color: var(--muted); font-size: 12px; }
    .speed-control output { font: 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .speed-control output span { color: var(--muted); font-size: 9px; }
    input[type="range"] { width: 100%; height: 16px; margin: 0; appearance: none; background: transparent; cursor: pointer; }
    input[type="range"]::-webkit-slider-runnable-track { height: 2px; background: var(--line); }
    input[type="range"]::-webkit-slider-thumb { width: 12px; height: 12px; margin-top: -5px; appearance: none; background: var(--paper); border: 3px solid var(--surface); border-radius: 50%; box-shadow: 0 0 0 1px #625d56; }
    .transport { display: flex; align-items: center; gap: 10px; }
    .transport .icon-button { position: relative; width: 44px; height: 44px; color: var(--muted); }
    .transport kbd { position: absolute; bottom: -13px; color: #625d56; font: 9px/1 ui-monospace, monospace; }
    .play-button { width: 52px; height: 52px; color: #151412; background: var(--paper); border-radius: 50%; box-shadow: 0 4px 20px rgba(0,0,0,.28); transition: transform .15s ease, background .15s ease; }
    .play-button:hover { transform: scale(1.04); background: #fff; }
    .play-button:active { transform: scale(.98); }
    .play-button svg { width: 20px; height: 20px; }
    .hint { justify-self: end; display: flex; align-items: center; gap: 8px; color: #6e6962; font-size: 10px; }
    .hint kbd { padding: 4px 6px; color: #aaa39a; background: #211f1d; border: 1px solid #393632; border-radius: 5px; font: 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; box-shadow: 0 1px 0 #000; }
    .hint span + kbd { margin-left: 8px; }
    @media (max-width: 760px) {
        .shell { grid-template-rows: 62px 1fr auto; }
        .topbar { grid-template-columns: 1fr auto; padding: 0 18px; }
        .article-title, .hint { display: none; }
        .controls { padding: 0 14px 14px; }
        .control-row { grid-template-columns: 1fr; gap: 16px; padding: 18px; }
        .speed-control { grid-row: 2; grid-template-columns: auto 1fr 70px; }
        .transport { justify-self: center; }
        .guide-top { top: calc(50% - 70px); }
        .guide-bottom { top: calc(50% + 48px); }
        .start-prompt { top: calc(50% + 98px); }
    }
    @media (prefers-reduced-motion: reduce) {
        .shell, .play-button, .progress-fill, .start-prompt { transition: none; }
    }
`;

chrome.runtime.onMessage.addListener((message: unknown) => {
    if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "speed-reader:toggle"
    ) {
        launch();
    }
});

launch();
