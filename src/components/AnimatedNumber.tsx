"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  style?: React.CSSProperties;
  className?: string;
}

export function AnimatedNumber({ value, style, className }: Props) {
  const [prev, setPrev] = useState(value);
  const [animating, setAnimating] = useState(false);
  const [dir, setDir] = useState<"up" | "down">("up");
  const prevRef = useRef(value);

  useEffect(() => {
    if (value === prevRef.current) return;
    const oldNum = parseFloat(prevRef.current.replace(/[^0-9.-]/g, "")) || 0;
    const newNum = parseFloat(value.replace(/[^0-9.-]/g, "")) || 0;
    setPrev(prevRef.current);
    setDir(newNum >= oldNum ? "up" : "down");
    prevRef.current = value;
    setAnimating(true);
    const t = setTimeout(() => setAnimating(false), 400);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <span style={{ position: "relative", display: "block", overflow: "hidden", ...style }} className={className}>
      {animating && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: `numSlide${dir === "up" ? "Up" : "Down"}Out 0.4s cubic-bezier(0.4,0,0.2,1) forwards`,
          }}
        >
          {prev}
        </span>
      )}
      <span
        style={{
          display: "block",
          textAlign: "center",
          animation: animating
            ? `numSlide${dir === "up" ? "Up" : "Down"}In 0.4s cubic-bezier(0.4,0,0.2,1) forwards`
            : undefined,
        }}
      >
        {value}
      </span>
    </span>
  );
}
