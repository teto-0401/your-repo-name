import type { Express } from "express";
import { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { BrowserManager } from "./browser";
import { wsClientMessageSchema, WsServerMessage } from "@shared/schema";
import fs from "fs";
import path from "path";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const clients = new Set<WebSocket>();
  let browserManager: BrowserManager | null = null;
  let browserStartPromise: Promise<void> | null = null;
  let cleanupTimer: NodeJS.Timeout | null = null;
  const fallbackDownloadDir = process.env.BROWSER_DOWNLOAD_DIR || path.join(process.cwd(), ".cache", "downloads");

  const broadcast = (msg: WsServerMessage) => {
    const payload = JSON.stringify(msg);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  };

  const ensureBrowser = async () => {
    if (browserManager) return browserManager;
    if (!browserStartPromise) {
      browserManager = new BrowserManager(
        (data) => broadcast({ type: "frame", data }),
        (url) => broadcast({ type: "navigated", url }),
        (message) => broadcast({ type: "error", message })
      );

      browserStartPromise = browserManager
        .start()
        .then(() => {
          return browserManager?.goto("https://www.google.co.jp");
        })
        .finally(() => {
          browserStartPromise = null;
        });
    }

    await browserStartPromise;
    return browserManager;
  };

  const scheduleCleanup = () => {
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      cleanupTimer = null;
    }
    if (clients.size > 0) return;

    // Avoid tearing down browser during short reconnect windows.
    cleanupTimer = setTimeout(async () => {
      if (clients.size > 0) return;
      await browserManager?.close();
      browserManager = null;
    }, 5000);
  };

  const getDownloadDir = () => browserManager?.getDownloadDir() ?? fallbackDownloadDir;

  wss.on("connection", (ws: WebSocket) => {
    console.log("[WS] Client connected");
    clients.add(ws);
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      cleanupTimer = null;
    }
    ensureBrowser().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", message } satisfies WsServerMessage));
      }
    });

    ws.on("message", async (rawData) => {
      try {
        const parsed = JSON.parse(rawData.toString());
        const msg = wsClientMessageSchema.parse(parsed);

        const activeBrowser = await ensureBrowser();
        if (!activeBrowser) return;

        switch (msg.type) {
          case "goto":
            await activeBrowser.goto(msg.url);
            break;
          case "mouseMove":
            await activeBrowser.mouseMove(msg.x, msg.y);
            break;
          case "mouseDown":
            await activeBrowser.mouseDown(msg.button);
            break;
          case "mouseUp":
            await activeBrowser.mouseUp(msg.button);
            break;
          case "keyDown":
            await activeBrowser.keyDown(msg.key);
            break;
          case "keyUp":
            await activeBrowser.keyUp(msg.key);
            break;
          case "insertText":
            await activeBrowser.insertText(msg.text);
            break;
          case "scroll":
            await activeBrowser.scroll(msg.deltaX, msg.deltaY);
            break;
          case "settings":
            await activeBrowser.updateScreencastSettings(
              msg.quality ?? 50,
              msg.everyNthFrame ?? 1
            );
            break;
        }
      } catch (err) {
        console.error("[WS] Invalid message:", err);
      }
    });

    ws.on("close", () => {
      console.log("[WS] Client disconnected");
      clients.delete(ws);
      scheduleCleanup();
    });

    ws.on("error", (err) => {
      console.error("[WS] Error:", err);
      clients.delete(ws);
      scheduleCleanup();
    });
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/downloads", async (_req, res) => {
    try {
      const downloadDir = getDownloadDir();
      await fs.promises.mkdir(downloadDir, { recursive: true });
      const entries = await fs.promises.readdir(downloadDir, { withFileTypes: true });
      const files = await Promise.all(
        entries
          .filter((entry) => entry.isFile())
          .map(async (entry) => {
            const fullPath = path.join(downloadDir, entry.name);
            const stat = await fs.promises.stat(fullPath);
            return {
              name: entry.name,
              size: stat.size,
              modifiedAt: stat.mtime.toISOString(),
              url: `/api/downloads/${encodeURIComponent(entry.name)}`,
            };
          }),
      );

      files.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
      res.json({ files });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[Downloads] Failed to read downloads: ${message}`);
      res.status(500).json({ message: `Failed to read downloads: ${message}` });
    }
  });

  app.get("/api/downloads/:name", async (req, res) => {
    try {
      const rawName = req.params.name;
      const decodedName = decodeURIComponent(rawName);
      const safeName = path.basename(decodedName);
      if (!decodedName || decodedName !== safeName || decodedName === "." || decodedName === "..") {
        return res.status(400).json({ message: "Invalid file name" });
      }

      const downloadDir = getDownloadDir();
      const fullPath = path.join(downloadDir, safeName);
      const stat = await fs.promises.stat(fullPath);
      if (!stat.isFile()) {
        return res.status(404).json({ message: "File not found" });
      }

      return res.download(fullPath, safeName);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return res.status(404).json({ message: "File not found" });
      }
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[Downloads] Failed to download file: ${message}`);
      return res.status(500).json({ message: `Failed to download file: ${message}` });
    }
  });

  return httpServer;
}
