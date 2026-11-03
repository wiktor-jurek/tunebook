import { describe, expect, it } from "vitest";
import { folderDescendants, folderPath } from "./folder-tree";

const folders = [
  { id: "grandchild", name: "Jigs", parentId: "child" },
  { id: "other", name: "Practice", parentId: null },
  { id: "child", name: "Practice", parentId: "parent" },
  { id: "parent", name: "Sessions", parentId: null },
];

describe("folder destinations", () => {
  it("excludes a moved folder and every descendant regardless of list order", () => {
    expect([...folderDescendants(folders, "parent")].sort()).toEqual(["child", "grandchild", "parent"]);
    expect(folderDescendants(folders, null).size).toBe(0);
  });
  it("distinguishes identically named destinations with their full paths", () => {
    expect(folderPath(folders, "child")).toBe("Sessions / Practice");
    expect(folderPath(folders, "other")).toBe("Practice");
    expect(folderPath(folders, "grandchild")).toBe("Sessions / Practice / Jigs");
    expect(folderPath(folders, null)).toBe("Top level");
  });
});
