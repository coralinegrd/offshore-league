import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

const configuredApiBase = String(import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "");

function resolveApiUrl(inputUrl) {
  if (!configuredApiBase || typeof inputUrl !== "string") {
    return inputUrl;
  }

  if (!(inputUrl.startsWith("/api") || inputUrl.startsWith("/uploads"))) {
    return inputUrl;
  }

  return `${configuredApiBase}${inputUrl}`;
}

if (configuredApiBase && typeof window !== "undefined") {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === "string") {
      return nativeFetch(resolveApiUrl(input), init);
    }

    if (input instanceof Request) {
      const requestUrl = new URL(input.url, window.location.origin);
      const isSameOrigin = requestUrl.origin === window.location.origin;
      const isApiPath = requestUrl.pathname.startsWith("/api") || requestUrl.pathname.startsWith("/uploads");
      if (isSameOrigin && isApiPath) {
        const proxiedUrl = `${configuredApiBase}${requestUrl.pathname}${requestUrl.search}`;
        return nativeFetch(new Request(proxiedUrl, input), init);
      }
    }

    return nativeFetch(input, init);
  };

  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function patchedOpen(method, url, async, user, password) {
    const nextUrl = resolveApiUrl(url);
    return nativeXhrOpen.call(this, method, nextUrl, async, user, password);
  };
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
