import { describe, expect, it } from "vitest";
import { displaySetTitle, displayTitle } from "./titles";

describe("displayTitle", () => {
  it("moves a trailing article to the front", () => {
    expect(displayTitle("Lilting Banshee, The")).toBe("The Lilting Banshee");
    expect(displayTitle("Kid On The Mountain, The")).toBe("The Kid On The Mountain");
    expect(displayTitle("Fig For A Kiss, A")).toBe("A Fig For A Kiss");
  });
  it("leaves other titles alone", () => {
    expect(displayTitle("Garrett Barry's")).toBe("Garrett Barry's");
    expect(displayTitle("An Phis Fhliuch")).toBe("An Phis Fhliuch");
    expect(displayTitle("Old Hag, You Have Killed Me")).toBe("Old Hag, You Have Killed Me");
  });
  it("fixes each tune in a set name", () => {
    expect(displaySetTitle("Rambling Pitchfork, The / Garrett Barry's / Hag At The Churn, The")).toBe("The Rambling Pitchfork / Garrett Barry's / The Hag At The Churn");
  });
});
