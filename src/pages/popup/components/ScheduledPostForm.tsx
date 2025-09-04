import { useState } from "react";
import type { FormEvent } from "react";

type Props = {
  sheetUrl: string;
  onSheetUrlChange: (url: string) => void;
  onFetch: () => Promise<void>;
  loading: boolean;
};

export default function ScheduledPostForm({ sheetUrl, onSheetUrlChange, onFetch, loading }: Props) {
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage("");
    
    if (!sheetUrl.trim()) {
      setMessage("Please enter a Google Sheet URL");
      return;
    }
    
    try {
      await onFetch();
      setMessage("Posts loaded successfully!");
      setTimeout(() => setMessage(""), 2000);
    } catch {
      setMessage("Failed to load posts from sheet");
    }
  };

  return (
    <form className="flex flex-col gap-4 p-4" onSubmit={handleSubmit}>
      <div className={`text-sm ${message.includes("success") ? "text-green-500" : "text-red-500"}`}>
        {message}
      </div>

      <div className="flex flex-col gap-2">
        <label className="font-medium">Google Sheet URL</label>
        <input
          type="text"
          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
          value={sheetUrl}
          onChange={e => onSheetUrlChange(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
        />
        <div className="text-xs text-gray-500">
          Paste the URL of your Google Sheet containing the posts schedule
        </div>
      </div>

      <button
        type="submit"
        className="w-full px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-blue-300 text-sm"
        disabled={!sheetUrl.trim() || loading}
      >
        {loading ? "Loading..." : "Load Posts"}
      </button>
    </form>
  );
}