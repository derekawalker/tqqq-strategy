export function useCardBg(color: string): string {
  const base = `linear-gradient(135deg, light-dark(color-mix(in srgb, var(--mantine-color-${color}-3) 50%, white), color-mix(in srgb, var(--mantine-color-${color}-9) 15%, var(--mantine-color-dark-8))) 0%, light-dark(white, var(--mantine-color-dark-8)) 100%)`;
  const gloss = `linear-gradient(160deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 10%, rgba(255,255,255,0) 20%), linear-gradient(340deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 5%, rgba(255,255,255,0) 10%)`;
  return `${gloss}, ${base}`;
}
