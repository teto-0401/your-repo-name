import { useRef, useCallback, useEffect, useState } from "react";
import { useRemoteBrowser } from "@/hooks/use-remote-browser";
import { BrowserToolbar } from "@/components/browser/BrowserToolbar";
import { BrowserCanvas, type BrowserCanvasRef } from "@/components/browser/BrowserCanvas";
import { BrowserStatusBar } from "@/components/browser/BrowserStatusBar";

interface DownloadFile {
  name: string;
  size: number;
  modifiedAt: string;
  url: string;
}

export default function BrowserPage() {
  const canvasRef = useRef<BrowserCanvasRef>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [downloads, setDownloads] = useState<DownloadFile[]>([]);

  // We pass onFrame callback so only the canvas updates via imperative handle,
  // preventing the whole page from re-rendering 30 times a second.
  const handleFrame = useCallback((base64Data: string) => {
    canvasRef.current?.drawFrame(base64Data);
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    await canvasRef.current?.toggleFullscreen();
    setIsFullscreen(canvasRef.current?.isFullscreen() ?? false);
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(canvasRef.current?.isFullscreen() ?? false);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  const { 
    status, 
    currentUrl, 
    memoryUsage, 
    error, 
    send, 
    navigate, 
    updateSettings 
  } = useRemoteBrowser({ onFrame: handleFrame });

  useEffect(() => {
    let isUnmounted = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchDownloads = async () => {
      try {
        const response = await fetch("/api/downloads");
        if (!response.ok) return;
        const payload = await response.json() as { files?: DownloadFile[] };
        if (!isUnmounted) {
          setDownloads(payload.files ?? []);
        }
      } catch {
        // ignore transient failures
      }
    };

    if (status === "connected") {
      void fetchDownloads();
      timer = setInterval(fetchDownloads, 4000);
    } else {
      setDownloads([]);
    }

    return () => {
      isUnmounted = true;
      if (timer) clearInterval(timer);
    };
  }, [status]);

  return (
    <div className="h-screen w-full flex flex-col bg-background overflow-hidden font-sans">
      
      {/* Top Address Bar & Controls */}
      <BrowserToolbar 
        currentUrl={currentUrl}
        onNavigate={navigate}
        onUpdateSettings={updateSettings}
        onToggleFullscreen={handleToggleFullscreen}
        isFullscreen={isFullscreen}
        status={status}
        error={error}
      />
      
      {/* Main Remote Viewport */}
      <BrowserCanvas 
        ref={canvasRef}
        onSend={send}
        status={status}
      />

      {/* Bottom Information */}
      <BrowserStatusBar 
        status={status}
        memoryUsage={memoryUsage}
        downloads={downloads}
      />
      
    </div>
  );
}
