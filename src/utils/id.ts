import { customAlphabet } from "nanoid";

/**
 * Options for generating a random alphanumeric ID.
 */
interface GenerateIdOptions {
  /**
   * The length of the generated ID.
   * @default 5
   * @example 5 => "abc12"
   */
  length?: number;
}

/**
 * Generates a random ID using digits and uppercase and lowercase letters.
 * @param options The options for generating the ID.
 * @returns The generated ID. Uniqueness is not guaranteed.
 * @example
 * generateId({ length: 5 }); // e.g. "abc12"
 */
export function generateId({ length = 5 }: GenerateIdOptions = {}): string {
  const id = customAlphabet(
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    length
  )();
  return id;
}
