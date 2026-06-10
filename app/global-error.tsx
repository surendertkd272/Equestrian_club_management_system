"use client";

import { useEffect } from "react";

// Last-resort boundary: renders only when the ROOT layout itself throws.
// It replaces <html>, so it must be fully self-contained — inline styles
// only (globals.css never loaded if we're here).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: "100%",
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            padding: 24,
            textAlign: "center",
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ fontSize: 40, lineHeight: 1 }}>⚠️</div>
          <h1 style={{ fontSize: 18, margin: "16px 0 8px" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, color: "#64748b", margin: "0 0 8px" }}>
            The app hit an unexpected error. Your data is safe — reload to
            continue.
          </p>
          {error.digest && (
            <p style={{ fontSize: 11, color: "#94a3b8", margin: "0 0 16px" }}>
              Reference: <code>{error.digest}</code>
            </p>
          )}
          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              marginTop: 16,
            }}
          >
            <button
              onClick={() => reset()}
              style={{
                background: "#0f172a",
                color: "#ffffff",
                border: "none",
                borderRadius: 8,
                padding: "8px 16px",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              onClick={() => (window.location.href = "/")}
              style={{
                background: "#ffffff",
                color: "#0f172a",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "8px 16px",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Go home
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
