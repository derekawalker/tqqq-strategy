export function useCardBg(color: string): string {
  return `linear-gradient(135deg, light-dark(color-mix(in srgb, var(--mantine-color-${color}-3) 50%, white), color-mix(in srgb, var(--mantine-color-${color}-9) 15%, var(--mantine-color-dark-8))) 0%, light-dark(white, var(--mantine-color-dark-8)) 100%)`;
}
