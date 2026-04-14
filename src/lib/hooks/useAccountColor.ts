import { useApp } from "@/lib/context/AppContext";

/** Returns the active account's color, falling back to the provided default (defaults to "blue"). */
export function useAccountColor(fallback = "blue"): string {
  const { activeAccount } = useApp();
  return activeAccount?.color ?? fallback;
}
