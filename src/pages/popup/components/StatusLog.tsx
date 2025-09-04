import { useEffect, useState } from "react";
import type { LogEntry } from "../utils/types";

export default function StatusLog() {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    // Lắng nghe log từ background
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "STATUS_LOG") {
        setLogs((prev) => [
          { time: new Date().toLocaleTimeString(), rowId: msg.rowId, status: msg.status },
          ...prev,
        ]);
      }
    });
  }, []);

  return (
    <div className="mt-4 border-t pt-2">
      <h3 className="font-bold text-sm mb-2">Lịch sử cập nhật Status</h3>
      <ul className="text-xs space-y-1 max-h-40 overflow-y-auto bg-gray-100 p-2 rounded">
        {logs.length === 0 && <li className="text-gray-500">Chưa có log nào.</li>}
        {logs.map((log, i) => (
          <li key={i}>
            <span className="text-gray-600">{log.time}</span> –{" "}
            <span className="font-mono">rowId={log.rowId}</span> →{" "}
            <span className="font-bold text-green-700">{log.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
