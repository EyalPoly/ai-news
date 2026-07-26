import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCES } from "./sources.js";

test("every source has a name, url, valid tier, and numeric weight", () => {
  const tiers = new Set(["tools", "learning", "awareness"]);
  assert.ok(SOURCES.length > 0);
  for (const s of SOURCES) {
    assert.ok(s.name.length > 0, `name missing on ${s.url}`);
    assert.match(s.url, /^https?:\/\//, `bad url on ${s.name}`);
    assert.ok(tiers.has(s.tier), `bad tier on ${s.name}`);
    assert.equal(typeof s.weight, "number", `bad weight on ${s.name}`);
  }
});

test("source names are unique", () => {
  const names = SOURCES.map((s) => s.name);
  assert.equal(new Set(names).size, names.length);
});
