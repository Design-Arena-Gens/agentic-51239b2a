"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Clip = {
  id: string;
  start: number; // seconds
  end: number; // seconds
  status?: "idle" | "downloading" | "done" | "error";
  url?: string; // blob url when done
  error?: string;
};

function extractYouTubeId(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.hostname === "youtu.be") {
      return url.pathname.slice(1);
    }
    if (url.hostname.includes("youtube.com")) {
      if (url.pathname.startsWith("/shorts/")) {
        return url.pathname.split("/")[2] || null;
      }
      if (url.pathname === "/watch") {
        return url.searchParams.get("v");
      }
      const parts = url.pathname.split("/").filter(Boolean);
      const idx = parts.indexOf("embed");
      if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    }
    return null;
  } catch {
    // Maybe they pasted a raw ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
    return null;
  }
}

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

export default function Home() {
  const [inputUrl, setInputUrl] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const playerRef = useRef<any>(null);
  const iframeContainerRef = useRef<HTMLDivElement | null>(null);

  const [clips, setClips] = useState<Clip[]>([]);
  const [draftStart, setDraftStart] = useState<number | null>(null);
  const [draftEnd, setDraftEnd] = useState<number | null>(null);

  const loadVideo = useCallback(() => {
    const id = extractYouTubeId(inputUrl.trim());
    if (!id) {
      alert("Enter a valid YouTube URL or video ID");
      return;
    }
    setVideoId(id);
  }, [inputUrl]);

  // Load YouTube Iframe API once
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.YT && window.YT.Player) return; // already loaded
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.body.appendChild(script);
  }, []);

  // Initialize / reinitialize player when videoId changes
  useEffect(() => {
    if (!videoId) return;
    let destroyed = false;
    function createPlayer() {
      if (!iframeContainerRef.current) return;
      // Clear previous
      iframeContainerRef.current.innerHTML = "";
      const div = document.createElement("div");
      div.id = "yt-player"; // unique child
      iframeContainerRef.current.appendChild(div);
      playerRef.current = new window.YT.Player("yt-player", {
        videoId,
        events: {
          onReady: () => {
            if (destroyed) return;
            setPlayerReady(true);
          },
        },
        playerVars: {
          modestbranding: 1,
          rel: 0,
        },
      });
    }
    if (window.YT && window.YT.Player) {
      createPlayer();
    } else {
      window.onYouTubeIframeAPIReady = () => {
        createPlayer();
      };
    }
    return () => {
      destroyed = true;
      try {
        if (playerRef.current && playerRef.current.destroy) {
          playerRef.current.destroy();
        }
      } catch {
        // ignore
      }
      setPlayerReady(false);
    };
  }, [videoId]);

  const getCurrentTime = useCallback((): number => {
    try {
      if (playerRef.current && typeof playerRef.current.getCurrentTime === "function") {
        return Math.max(0, Number(playerRef.current.getCurrentTime()) || 0);
      }
    } catch {
      // ignore
    }
    return 0;
  }, []);

  const formatted = useMemo(() => {
    function fmt(t: number | null) {
      if (t == null || Number.isNaN(t)) return "--:--";
      const s = Math.floor(t);
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
    }
    return {
      start: fmt(draftStart),
      end: fmt(draftEnd),
    };
  }, [draftStart, draftEnd]);

  const addClip = () => {
    if (draftStart == null || draftEnd == null) {
      alert("Set both start and end");
      return;
    }
    if (draftEnd <= draftStart) {
      alert("End must be after start");
      return;
    }
    const id = Math.random().toString(36).slice(2, 9);
    setClips((prev) => [...prev, { id, start: draftStart, end: draftEnd, status: "idle" }]);
  };

  const removeClip = (id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id));
  };

  const downloadClip = async (clip: Clip) => {
    if (!inputUrl) {
      alert("Provide the original YouTube URL (not just ID)");
      return;
    }
    setClips((prev) => prev.map((c) => (c.id === clip.id ? { ...c, status: "downloading", error: undefined } : c)));
    try {
      const res = await fetch("/api/clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: inputUrl.trim(),
          start: clip.start,
          end: clip.end,
          format: "mp4",
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed with ${res.status}`);
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      setClips((prev) => prev.map((c) => (c.id === clip.id ? { ...c, status: "done", url: blobUrl } : c)));
      // Auto trigger download
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `clip_${Math.floor(clip.start)}-${Math.floor(clip.end)}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      setClips((prev) => prev.map((c) => (c.id === clip.id ? { ...c, status: "error", error: String(err?.message || err) } : c)));
    }
  };

  return (
    <div style={{ padding: "24px", maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>YouTube Clip Maker</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          style={{ flex: 1, padding: 8, border: "1px solid #ddd", borderRadius: 6 }}
          placeholder="Paste YouTube URL or video ID"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
        />
        <button onClick={loadVideo} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #333", background: "#111", color: "#fff" }}>
          Load Video
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div ref={iframeContainerRef} style={{ aspectRatio: "16 / 9", background: "#000", borderRadius: 8, overflow: "hidden", marginBottom: 12 }} />
          {videoId && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={() => setDraftStart(getCurrentTime())}
                disabled={!playerReady}
                style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ccc" }}
              >
                Mark Start ({formatted.start})
              </button>
              <button
                onClick={() => setDraftEnd(getCurrentTime())}
                disabled={!playerReady}
                style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ccc" }}
              >
                Mark End ({formatted.end})
              </button>
              <button onClick={addClip} disabled={draftStart == null || draftEnd == null} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #333", background: "#111", color: "#fff" }}>
                Add Clip
              </button>
            </div>
          )}
          {!videoId && <p style={{ color: "#666" }}>Paste a YouTube URL and click Load Video.</p>}
        </div>

        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Clips</h2>
          {clips.length === 0 && <p style={{ color: "#666" }}>No clips yet. Mark start and end, then Add Clip.</p>}
          <ul style={{ display: "flex", flexDirection: "column", gap: 8, padding: 0, listStyle: "none" }}>
            {clips.map((clip) => (
              <li key={clip.id} style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {Math.floor(clip.start)}s ? {Math.floor(clip.end)}s ({Math.max(0, Math.floor(clip.end - clip.start))}s)
                  </div>
                  <div style={{ fontSize: 12, color: "#666" }}>
                    {clip.status === "downloading" && "Processing..."}
                    {clip.status === "done" && clip.url && <a href={clip.url} download={`clip_${Math.floor(clip.start)}-${Math.floor(clip.end)}.mp4`}>Download ready</a>}
                    {clip.status === "error" && <span style={{ color: "#b00" }}>Error: {clip.error}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => downloadClip(clip)} disabled={clip.status === "downloading"} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #333", background: "#111", color: "#fff" }}>
                    {clip.status === "downloading" ? "Working..." : "Download"}
                  </button>
                  <button onClick={() => removeClip(clip.id)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ccc" }}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p style={{ marginTop: 16, fontSize: 12, color: "#888" }}>
        Note: Very long clips may fail due to server time limits. Keep clips short (e.g., under a minute).
      </p>
    </div>
  );
}
