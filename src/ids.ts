import { customAlphabet } from "nanoid";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const generator = customAlphabet(ALPHABET, 16);

export function nanoid(length = 16): string {
  return customAlphabet(ALPHABET, length)();
}

export function prefixedId(prefix: string, length = 16): string {
  return `${prefix}_${generator().slice(0, length)}`;
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || `item-${Date.now()}`
  );
}
