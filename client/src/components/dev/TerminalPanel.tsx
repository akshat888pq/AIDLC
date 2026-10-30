import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { terminalUrl } from '../../services/devApi';

interface Props {
  sessionId: string;
  terminalId: string;
  visible: boolean;
  onConnectedChange?: (connected: boolean) => void;
}

export interface TerminalHandle {
  clear: () => void;
  restart: () => void;
  focus: () => void;
}

/** One shell. Several of these live side by side as tabs; hidden ones keep running. */
const TerminalPanel = forwardRef<TerminalHandle, Props>(function TerminalPanel(
  { sessionId, terminalId, visible, onConnectedChange },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const statusRef = useRef(onConnectedChange);
  statusRef.current = onConnectedChange;

  useImperativeHandle(ref, () => ({
    clear: () => termRef.current?.clear(),
    restart: () => {
      const term = termRef.current;
      socketRef.current?.send(JSON.stringify({ type: 'restart', cols: term?.cols, rows: term?.rows }));
    },
    focus: () => termRef.current?.focus(),
  }));

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Cascadia Code, Consolas, Menlo, monospace',
      theme: { background: '#0f172a', foreground: '#e2e8f0', cursor: '#93c5fd', selectionBackground: '#334155' },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current!);
    termRef.current = term;
    fitRef.current = fit;

    let disposed = false;
    let closedByServer = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const sendResize = () => {
      const ws = socketRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    const connect = () => {
      const ws = new WebSocket(terminalUrl(sessionId, terminalId));
      socketRef.current = ws;
      ws.onopen = () => {
        attempts = 0;
        statusRef.current?.(true);
        try {
          fit.fit();
        } catch {
          /* hidden */
        }
        sendResize();
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'output') {
          if (msg.replay) term.reset();
          term.write(msg.data);
        } else if (msg.type === 'clear') term.reset();
        else if (msg.type === 'closed') closedByServer = true;
      };
      ws.onclose = () => {
        statusRef.current?.(false);
        if (disposed || closedByServer) return;
        attempts++;
        retry = setTimeout(connect, Math.min(5000, 500 * attempts));
      };
    };
    connect();

    const input = term.onData((data) => {
      const ws = socketRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
    });

    const observer = new ResizeObserver(() => {
      if (!hostRef.current?.offsetParent) return;
      try {
        fit.fit();
        sendResize();
      } catch {
        /* not laid out yet */
      }
    });
    observer.observe(hostRef.current!);

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      observer.disconnect();
      input.dispose();
      socketRef.current?.close();
      term.dispose();
    };
  }, [sessionId, terminalId]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      try {
        fitRef.current?.fit();
        termRef.current?.focus();
      } catch {
        /* ignore */
      }
    }, 30);
    return () => clearTimeout(t);
  }, [visible]);

  return <div ref={hostRef} className={`h-full px-2 py-1 ${visible ? '' : 'hidden'}`} />;
});

export default TerminalPanel;
