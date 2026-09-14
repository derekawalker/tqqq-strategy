"use client";

import { useEffect, useState } from "react";

// TEMPORARY: on-screen viewport measurements for diagnosing the iOS PWA bottom-nav gap.
// Tap to hide. Remove once the nav position is sorted.
export default function ViewportDebug() {
  const [lines, setLines] = useState<string[]>([]);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
    document.body.appendChild(probe);

    const read = () => {
      const cs = getComputedStyle(probe);
      const root = getComputedStyle(document.documentElement);
      const nav = document.querySelector(".app-bottom-nav")?.getBoundingClientRect();
      const vv = window.visualViewport;
      setLines([
        `standalone ${window.matchMedia("(display-mode: standalone)").matches}`,
        `screen.h ${screen.height}  dpr ${window.devicePixelRatio}`,
        `innerH ${window.innerHeight}  clientH ${document.documentElement.clientHeight}`,
        `vv.h ${vv?.height.toFixed(1)}  vv.top ${vv?.offsetTop.toFixed(1)}`,
        `safe top ${cs.paddingTop}  bottom ${cs.paddingBottom}`,
        `shim ${root.getPropertyValue("--ios-bottom-shim")}  navH ${root.getPropertyValue("--bottom-nav-height")}`,
        nav ? `nav top ${nav.top.toFixed(1)}  bottom ${nav.bottom.toFixed(1)}  h ${nav.height.toFixed(1)}` : "nav —",
        `scrollY ${window.scrollY}`,
      ]);
    };

    read();
    const id = setInterval(read, 1000);
    return () => {
      clearInterval(id);
      probe.remove();
    };
  }, []);

  if (hidden) return null;
  return (
    <div
      onClick={() => setHidden(true)}
      style={{
        position: "fixed",
        top: "40%",
        left: 8,
        right: 8,
        zIndex: 1000,
        padding: 8,
        background: "rgba(0,0,0,0.85)",
        color: "#0f0",
        font: "11px/1.4 ui-monospace, Menlo, monospace",
        borderRadius: 6,
        whiteSpace: "pre",
      }}
    >
      {lines.join("\n")}
      {"\n(tap to hide)"}
    </div>
  );
}
