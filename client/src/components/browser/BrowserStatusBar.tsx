import { ShieldCheck, Monitor, Activity, ServerCrash } from "lucide-react";

interface DownloadFile {
  name: string;
  size: number;
  url: string;
}

interface BrowserStatusBarProps {
  status: string;
  memoryUsage: number;
  downloads: DownloadFile[];
}

export function BrowserStatusBar({ status, memoryUsage, downloads }: BrowserStatusBarProps) {
  const statusLabelMap: Record<string, string> = {
    connecting: "接続中",
    connected: "接続済み",
    disconnected: "切断",
    error: "エラー",
  };
  const latestDownload = downloads[0];
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="h-10 border-t border-border/50 bg-background flex items-center justify-between px-4 text-xs font-medium text-muted-foreground z-20">
      
      {/* Status Info */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          {status === "connected" ? (
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
          ) : (
            <ServerCrash className="w-4 h-4 text-destructive" />
          )}
          <span>{statusLabelMap[status] ?? status}</span>
        </div>
        
        <div className="hidden sm:flex items-center gap-2 border-l border-border/50 pl-4">
          <Monitor className="w-4 h-4" />
          <span>リモートセッション</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {latestDownload ? (
          <a
            href={latestDownload.url}
            className="hidden md:flex items-center gap-2 bg-secondary/50 px-3 py-1 rounded-full hover:bg-secondary transition-colors"
            title={latestDownload.name}
          >
            <span className="font-mono">DL {downloads.length}</span>
            <span className="max-w-52 truncate">{latestDownload.name}</span>
            <span className="font-mono text-[11px]">{formatSize(latestDownload.size)}</span>
          </a>
        ) : null}

        {/* Memory Usage */}
        <div className="flex items-center gap-2 bg-secondary/50 px-3 py-1 rounded-full">
          <Activity className="w-3 h-3 text-primary/70" />
          <span className="font-mono">{memoryUsage.toFixed(1)} MB</span>
        </div>
      </div>

    </div>
  );
}
