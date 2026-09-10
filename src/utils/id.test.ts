import { expect, test } from "vitest";
import { generateId, idPattern } from "./id.ts";

const DEFAULT_ID_PATTERN = /^[0-9a-z]{5}$/;
const LOWERCASE_ID_PATTERN = /^[0-9a-z]+$/;

test("generateId defaults to five lowercase alphanumeric characters", () => {
  expect(generateId()).toMatch(DEFAULT_ID_PATTERN);
  expect(generateId({})).toMatch(DEFAULT_ID_PATTERN);
});

test.each([1, 12, 64])(
  "generateId produces %i lowercase alphanumeric characters",
  (length) => {
    const id = generateId({ length });
    expect(id).toHaveLength(length);
    expect(id).toMatch(LOWERCASE_ID_PATTERN);
  }
);

test("idPattern still accepts legacy mixed-case application IDs", () => {
  expect("YooPy").toMatch(idPattern);
});
