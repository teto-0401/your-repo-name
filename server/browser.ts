import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page, CDPSession } from 'puppeteer';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

const LOCK_RETRY_DELAY_MS = 500;
const LOCK_RETRY_COUNT = 8;
const ACCEPT_LANGUAGE = "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7";
const PROFILE_LOCK_PATTERNS = [
  /already running.*userDataDir/i,
  /profile appears to be in use/i,
  /has locked the profile/i,
  /SingletonLock/i,
];

function isProfileLockError(message: string): boolean {
  return PROFILE_LOCK_PATTERNS.some((pattern) => pattern.test(message));
}

function getFallbackUserDataDir(baseDir: string, attempt: number): string {
  const suffix = `${process.pid}-${Date.now()}-${attempt}`;
  return path.join(path.dirname(baseDir), `${path.basename(baseDir)}-session-${suffix}`);
}


function findChromeFromPlaywrightCache(baseDir: string): string | undefined {
  if (!fs.existsSync(baseDir)) return undefined;

  const candidates: string[] = [];
  const dirs = fs.readdirSync(baseDir, { withFileTypes: true });
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    if (!dir.name.startsWith('chromium-') && !dir.name.startsWith('chrome-')) continue;
    const root = path.join(baseDir, dir.name);
    candidates.push(
      path.join(root, 'chrome-linux', 'chrome'),
      path.join(root, 'chrome-linux64', 'chrome'),
      path.join(root, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
      path.join(root, 'chrome-headless-shell-linux64', 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
    );
  }

  return candidates.find((candidate) => fs.existsSync(candidate));
}
function findChromeFromPuppeteerCache(cacheRoot: string): string | undefined {
  const chromeRoot = path.join(cacheRoot, 'chrome');
  if (!fs.existsSync(chromeRoot)) return undefined;

  const builds = fs.readdirSync(chromeRoot, { withFileTypes: true });
  for (const build of builds) {
    if (!build.isDirectory()) continue;
    const base = path.join(chromeRoot, build.name);
    const candidates = [
      path.join(base, 'chrome-linux64', 'chrome'),
      path.join(base, 'chrome-linux', 'chrome'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return undefined;
}

export class BrowserManager {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private cdp: CDPSession | null = null;
  private isClosing = false;
  private downloadDir = process.env.BROWSER_DOWNLOAD_DIR || path.join(process.cwd(), '.cache', 'downloads');
  
  constructor(
    private onFrame: (data: string) => void,
    private onNavigated: (url: string) => void,
    private onError: (msg: string) => void
  ) {}

  async start() {
    try {
      process.env.PUPPETEER_CACHE_DIR ??= path.join(process.cwd(), '.cache', 'puppeteer');
      process.env.PLAYWRIGHT_BROWSERS_PATH ??= process.env.RENDER
        ? '/opt/render/.cache/ms-playwright'
        : path.join(process.cwd(), '.cache', 'ms-playwright');
      const configuredUserDataDir = process.env.BROWSER_USER_DATA_DIR || path.join(process.cwd(), '.cache', 'chrome-user-data');
      fs.mkdirSync(configuredUserDataDir, { recursive: true });
      fs.mkdirSync(this.downloadDir, { recursive: true });
      let execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
      if (!execPath) {
        const puppeteerCachePaths = [
          process.env.PUPPETEER_CACHE_DIR,
          path.join(process.cwd(), '.cache', 'puppeteer'),
          path.join(process.env.HOME || '', '.cache', 'puppeteer'),
          '/opt/render/.cache/puppeteer',
        ].filter(Boolean) as string[];

        for (const cachePath of puppeteerCachePaths) {
          const found = findChromeFromPuppeteerCache(cachePath);
          if (found) {
            execPath = found;
            break;
          }
        }
      }

      if (!execPath) {
        const pwPaths = [
          process.env.PLAYWRIGHT_BROWSERS_PATH,
          path.join(process.cwd(), '.cache', 'ms-playwright'),
          path.join(process.env.HOME || '', '.cache/ms-playwright'),
          '/opt/render/.cache/ms-playwright',
        ].filter(Boolean) as string[];

        for (const base of pwPaths) {
          const found = findChromeFromPlaywrightCache(base);
          if (found) {
            execPath = found;
            break;
          }
        }
      }
      
      if (!execPath) {
        try {
          execPath = execSync('which chromium || which google-chrome-stable || which google-chrome').toString().trim();
        } catch (e) {
          // fallback
        }
      }

      if (execPath) {
        console.log(`[Browser] Launching with executable: ${execPath}`);
      } else {
        console.warn(`[Browser] No executablePath found, relying on Puppeteer cache: ${process.env.PUPPETEER_CACHE_DIR}`);
      }

      let launchError: unknown;
      let launchUserDataDir = configuredUserDataDir;
      for (let attempt = 1; attempt <= LOCK_RETRY_COUNT; attempt++) {
        try {
          fs.mkdirSync(launchUserDataDir, { recursive: true });
          this.browser = await puppeteer.launch({
            headless: true,
            executablePath: execPath,
            userDataDir: launchUserDataDir,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
              '--lang=ja-JP',
              '--accept-lang=ja-JP,ja',
              '--window-size=1280,720'
            ],
            defaultViewport: { width: 1280, height: 720 }
          });
          launchError = undefined;
          break;
        } catch (err) {
          launchError = err;
          const message = err instanceof Error ? err.message : String(err);
          const isLockError = isProfileLockError(message);
          if (!isLockError || attempt === LOCK_RETRY_COUNT) break;

          const nextUserDataDir = getFallbackUserDataDir(configuredUserDataDir, attempt);
          console.warn(
            `[Browser] userDataDir is locked (${launchUserDataDir}). retry ${attempt}/${LOCK_RETRY_COUNT} in ${LOCK_RETRY_DELAY_MS}ms with ${nextUserDataDir}`,
          );
          launchUserDataDir = nextUserDataDir;
          await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
        }
      }

      if (!this.browser) {
        if (!execPath) {
          throw new Error(
            'Browser executable could not be resolved. Set PUPPETEER_EXECUTABLE_PATH or ensure Playwright/Chromium is installed.',
          );
        }
        throw launchError instanceof Error
          ? launchError
          : new Error(String(launchError ?? 'Failed to launch browser'));
      }

      this.browser.on('disconnected', () => {
        if (!this.isClosing) {
          console.error('[Browser] Abnormal termination: Browser disconnected unexpectedly.');
          this.onError('Browser disconnected abnormally');
        }
      });

      const pages = await this.browser.pages();
      this.page = pages[0] || await this.browser.newPage();
      await this.page.setExtraHTTPHeaders({
        "Accept-Language": ACCEPT_LANGUAGE,
      });
      await this.page.setBypassCSP(true);
      await this.page.evaluateOnNewDocument(() => {
        const setNavigatorLocale = () => {
          const nav = window.navigator as Navigator & {
            language?: string;
            languages?: string[];
          };
          try {
            Object.defineProperty(nav, "language", {
              get: () => "ja-JP",
              configurable: true,
            });
          } catch {}
          try {
            Object.defineProperty(nav, "languages", {
              get: () => ["ja-JP", "ja", "en-US", "en"],
              configurable: true,
            });
          } catch {}
        };

        setNavigatorLocale();

        const ensureJapaneseFont = () => {
          if (document.getElementById("codex-ja-font-style")) return;
          const style = document.createElement("style");
          style.id = "codex-ja-font-style";
          style.textContent = `
            html, body,
            :lang(ja), [lang="ja"], [lang^="ja-"] {
              font-family:
                "Noto Sans CJK JP",
                "Noto Sans JP",
                "Noto Sans CJK",
                "Noto Serif CJK JP",
                "Hiragino Kaku Gothic ProN",
                "Yu Gothic",
                "Meiryo",
                sans-serif !important;
            }
          `;
          (document.head || document.documentElement).appendChild(style);
        };
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", ensureJapaneseFont, {
            once: true,
          });
        } else {
          ensureJapaneseFont();
        }
      });

      this.page.on('framenavigated', (frame) => {
        if (frame === this.page?.mainFrame()) {
          this.onNavigated(frame.url());
        }
      });

      this.page.on('error', (err) => {
        console.error('[Browser Page] Crash/Error:', err.message);
        this.onError(`Page crashed: ${err.message}`);
      });

      this.cdp = await this.page.target().createCDPSession();
      await this.cdp.send('Page.enable');
      await this.cdp.send('Network.enable');
      await this.cdp.send('Network.setExtraHTTPHeaders', {
        headers: {
          'Accept-Language': ACCEPT_LANGUAGE,
        },
      });
      await this.cdp.send('Emulation.setLocaleOverride', {
        locale: 'ja-JP',
      });
      await this.cdp.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: this.downloadDir,
      }).catch((err) => {
        console.warn('[Browser] Failed to set download behavior:', err);
      });
      await this.cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 40,
        everyNthFrame: 1
      });

      this.cdp.on('Page.screencastFrame', async (event) => {
        const { data, sessionId } = event;
        this.onFrame(data);
        if (this.cdp) {
          await this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
        }
      });

      console.log('[Browser] Started successfully');
    } catch (err) {
      console.error('[Browser] Failed to start:', err);
      this.onError(err instanceof Error ? err.message : String(err));
    }
  }
  
  async updateScreencastSettings(quality: number, everyNthFrame: number) {
    if (!this.cdp) return;
    try {
      await this.cdp.send('Page.stopScreencast');
      await this.cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality,
        everyNthFrame
      });
      console.log(`[Browser] Screencast settings updated: quality=${quality}, everyNthFrame=${everyNthFrame}`);
    } catch (err) {
      console.error('[Browser] Failed to update screencast:', err);
    }
  }

  async goto(url: string) {
    if (!this.page) return;
    try {
      let targetUrl = url;
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
         targetUrl = 'https://' + targetUrl;
      }
      const parsed = new URL(targetUrl);
      const host = parsed.hostname.toLowerCase();
      const isGoogleDomain = host === "google.com" || host.endsWith(".google.com") || host.endsWith(".google.co.jp");
      if (isGoogleDomain) {
        if (host === "google.com" || host.endsWith(".google.com")) {
          parsed.hostname = "www.google.co.jp";
        }
        parsed.searchParams.set("hl", "ja");
        parsed.searchParams.set("gl", "JP");
        if (parsed.pathname === "/" || parsed.pathname === "") {
          parsed.searchParams.set("gws_rd", "cr");
        }
        await this.page.setCookie(
          {
            name: "PREF",
            value: "hl=ja&gl=JP",
            domain: ".google.com",
            path: "/",
          },
          {
            name: "PREF",
            value: "hl=ja&gl=JP",
            domain: ".google.co.jp",
            path: "/",
          },
        );
      }
      targetUrl = parsed.toString();
      await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    } catch (err) {
      console.error(`[Browser] Failed to navigate to ${url}:`, err);
    }
  }
  
  async mouseMove(x: number, y: number) {
    await this.page?.mouse.move(x, y).catch(() => {});
  }

  async mouseDown(button: 'left'|'middle'|'right') {
    await this.page?.mouse.down({ button }).catch(() => {});
  }

  async mouseUp(button: 'left'|'middle'|'right') {
    await this.page?.mouse.up({ button }).catch(() => {});
  }

  async keyDown(key: string) {
    await this.page?.keyboard.down(key as any).catch(() => {});
  }

  async keyUp(key: string) {
    await this.page?.keyboard.up(key as any).catch(() => {});
  }

  async insertText(text: string) {
    if (!text) return;

    if (this.cdp) {
      await this.cdp.send('Input.insertText', { text }).catch(() => {});
      return;
    }

    await this.page?.keyboard.type(text).catch(() => {});
  }

  async scroll(deltaX: number, deltaY: number) {
    await this.page?.evaluate((dx, dy) => {
      window.scrollBy(dx, dy);
    }, deltaX, deltaY).catch(() => {});
  }

  async close() {
    this.isClosing = true;
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  getDownloadDir() {
    return this.downloadDir;
  }
}
