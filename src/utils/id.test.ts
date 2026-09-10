import { expect, test } from "vitest";
import { generateId } from "./id.ts";

const DEFAULT_ID_PATTERN = /^[0-9A-Za-z]{5}$/;
const ALPHANUMERIC_ID_PATTERN = /^[0-9A-Za-z]+$/;

test("generateId defaults to five alphanumeric characters", () => {
  expect(generateId()).toMatch(DEFAULT_ID_PATTERN);
  expect(generateId({})).toMatch(DEFAULT_ID_PATTERN);
});

test.each([1, 12, 64])(
  "generateId produces %i alphanumeric characters",
  (length) => {
    const id = generateId({ length });
    expect(id).toHaveLength(length);
    expect(id).toMatch(ALPHANUMERIC_ID_PATTERN);
  }
);
