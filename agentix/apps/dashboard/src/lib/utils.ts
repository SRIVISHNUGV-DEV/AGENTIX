import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges class-name inputs (strings, arrays, conditionals) with Tailwind conflict resolution.
 * @returns A single class string; "" when given no inputs.
 * Maps to: internal — className composition in every dashboard component.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
