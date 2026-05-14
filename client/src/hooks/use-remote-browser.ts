import { useState, useEffect, useRef, useCallback } from "react";
import type { WsClientMessage, WsServerMessage } from "@shared/schema";

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

interface UseRemoteBrowserProps {
  onFrame?: (base64Data: string) => void;
}

export function useRemoteBrowser({ onFrame }: UseRemoteBrowserProps = {}) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [currentUrl, setCurrentUrl] = useState<string>("");
  const [memoryUsage, setMemoryUsage] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const isComponentMounted = useRef(true);
  const shouldReconnectRef = useRef(true);

  const connect = useCallback(() => {
    if (!shouldReconnectRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    setStatus("connecting");
    setError(null);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setStatus("connected");
      // Initialize the browser
      ws.send(JSON.stringify({ 
        type: "init", 
        viewport: { width: 1280, height: 720 } 
      } as WsClientMessage));
    };

    ws.onmessage = (event) => {
      try {
        const rawData = JSON.parse(event.data) as WsServerMessage;
        
        switch (rawData.type) {
          case "frame":
            if (onFrame) onFrame(rawData.data);
            break;
          case "navigated":
            setCurrentUrl(rawData.url);
            break;
          case "memory":
            setMemoryUsage(rawData.usage);
            break;
          case "error":
            setError(rawData.message);
            if (/Could not find Chrome/i.test(rawData.message)) {
              // Fatal server-side setup error; avoid reconnect loop.
              shouldReconnectRef.current = false;
            }
            break;
        }
      } catch (err) {
        console.error("Failed to parse WS message", err);
        console.log("[WS] Failed to parse WS message:", err);
      }
    };

    ws.onerror = () => {
      setStatus("error");
    };

    ws.onclose = () => {
      if (!isComponentMounted.current) return;
      setStatus("disconnected");
      wsRef.current = null;
      
      // Auto reconnect
      clearTimeout(reconnectTimeoutRef.current);
      if (shouldReconnectRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isComponentMounted.current) connect();
        }, 3000);
      }
    };

    wsRef.current = ws;
  }, [onFrame]);

  useEffect(() => {
    isComponentMounted.current = true;
    shouldReconnectRef.current = true;
    connect();

    return () => {
      isComponentMounted.current = false;
      clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const send = useCallback((message: WsClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const navigate = useCallback((url: string) => {
    send({ type: "goto", url });
  }, [send]);

  const updateSettings = useCallback((settings: { everyNthFrame?: number; quality?: number }) => {
    send({ type: "settings", ...settings });
  }, [send]);

  return {
    status,
    currentUrl,
    memoryUsage,
    error,
    send,
    navigate,
    updateSettings,
    reconnect: connect
  };
}
