"use client";

import { useEffect, useRef, useState } from "react";

// Renders a vertical strip of 0-9 and slides to the target digit
function DigitReel({ digit }: { digit: string }) {
  const target = parseInt(digit, 10);
  const [pos, setPos] = useState(target);
  const isFirst = useRef(true);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    setPos(target);
  }, [target]);

  return (
    <span style={{
      display: "inline-block",
      overflow: "hidden",
      height: "1em",
      verticalAlign: "text-bottom",
    }}>
      <span style={{
        display: "flex",
        flexDirection: "column",
        transform: `translateY(-${pos * 10}%)`,
        transition: "transform 0.5s cubic-bezier(0.4,0,0.2,1)",
        willChange: "transform",
      }}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <span key={d} style={{ display: "block", height: "1em", lineHeight: 1 }}>{d}</span>
        ))}
      </span>
    </span>
  );
}

interface Props {
  value: string;
  style?: React.CSSProperties;
  className?: string;
}

export function AnimatedNumber({ value, style, className }: Props) {
  // We only care about value changes — DigitReel handles its own animation internally
  const totalDigits = (value.match(/[0-9]/g) ?? []).length;
  let digitIdx = 0;

  const chars = value.split("").map((char, i) => {
    if (/[0-9]/.test(char)) {
      // Key by right-aligned position so reels survive formatting changes (e.g. $999 → $1,000)
      const rightPos = totalDigits - 1 - digitIdx;
      digitIdx++;
      return <DigitReel key={`d-${rightPos}`} digit={char} />;
    }
    return <span key={`s-${i}-${char}`}>{char}</span>;
  });

  return (
    <span style={{ display: "block", textAlign: "center", ...style }} className={className}>
      {chars}
    </span>
  );
}
