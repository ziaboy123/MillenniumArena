// The WebSocket to the duel server, with automatic reconnects.
import { useEffect, useRef, useState } from 'react';
import type { ClientMessage, ServerMessage } from '@arena/shared';

export function useArenaSocket(onMessage: (msg: ServerMessage) => void) {
  const [connected, setConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    let stopped = false, retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${import.meta.env.BASE_URL}ws`;
      const socket = new WebSocket(url);
      ws.current = socket;
      socket.onopen = () => setConnected(true);
      socket.onmessage = e => handler.current(JSON.parse(e.data));
      socket.onclose = e => {
        // the server closes with 4001 when this login has ended (logged out elsewhere, password changed, suspended):
        // reload, so the page shows you logged out instead of carrying on as nobody
        if (e.code === 4001 && !stopped) { location.reload(); return; }
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, 1500);
      };
    };
    connect();
    return () => { stopped = true; clearTimeout(retry); ws.current?.close(); };
  }, []);

  const send = (msg: ClientMessage) => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg)); };
  return { connected, send };
}
