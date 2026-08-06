/**
 * The app's card surface: a 135° wash of the colour into the dark base, with
 * two gloss sweeps over it.
 *
 * `mix` is how much of the hue reaches the wash. The 15% default is the neutral
 * card everything uses; push it higher when a card's colour is carrying meaning
 * — the hedge page's put and VIX cards are filled that way — and the gloss and
 * geometry stay identical, so a tinted card still reads as the same object.
 */
export function useCardBg(color: string, mix = 15): string {
  const base = `linear-gradient(135deg, color-mix(in srgb, var(--mantine-color-${color}-9) ${mix}%, var(--mantine-color-dark-8)) 0%, var(--mantine-color-dark-8) 100%)`;
  const gloss = `linear-gradient(160deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 10%, rgba(255,255,255,0) 20%), linear-gradient(340deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 5%, rgba(255,255,255,0) 10%)`;
  return `${gloss}, ${base}`;
}
