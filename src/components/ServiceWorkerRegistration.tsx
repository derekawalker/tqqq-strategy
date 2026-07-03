"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Registered in every environment, including dev — sw.js itself detects
    // localhost and skips all asset caching there (it was previously skipped
    // entirely in dev to dodge a stale-chunk caching bug, but that also made
    // push notifications untestable locally).
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {});
  }, []);

  return null;
}
