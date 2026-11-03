export const DEFAULT_SOUND = 74;
export const SOUND_OPTIONS = [
  { label: "Whistle-like, recorder", program: 74 },
  { label: "Accordion", program: 21 },
  { label: "Flute", program: 73 },
  { label: "Piano", program: 0 },
] as const;

export function isSound(value: unknown): value is number {
  return typeof value === "number" && SOUND_OPTIONS.some((sound) => sound.program === value);
}
