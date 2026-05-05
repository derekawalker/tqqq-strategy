import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#1a1b1e",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            color: "#40c057",
            fontSize: 80,
            fontWeight: 700,
            letterSpacing: "-3px",
          }}
        >
          TQ
        </span>
      </div>
    ),
    { ...size }
  );
}
