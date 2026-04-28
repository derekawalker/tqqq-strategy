import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: "6px",
        }}
      >
        <span
          style={{
            color: "#40c057",
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: "-1px",
          }}
        >
          TQ
        </span>
      </div>
    ),
    { ...size }
  );
}
