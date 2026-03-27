import type { CSSProperties } from "react";

const RADIUS = 6;

export const dateGroupHeaderCellLeft: CSSProperties = {
  paddingTop: 4,
  paddingBottom: 4,
  borderRadius: `${RADIUS}px ${RADIUS}px 0 0`,
};

export const dateGroupHeaderCellRight: CSSProperties = {
  paddingTop: 4,
  paddingBottom: 4,
  borderRadius: `0 ${RADIUS}px 0 0`,
};

export const dateGroupLastCellLeft: CSSProperties = {
  borderBottomLeftRadius: RADIUS,
};

export const dateGroupLastCellRight: CSSProperties = {
  borderBottomRightRadius: RADIUS,
};

export const dateGroupHeaderBg = "rgba(0,0,0,0.15)";
