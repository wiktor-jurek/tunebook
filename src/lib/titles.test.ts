import { describe, expect, it } from "vitest";
import { displaySetTitle, displayTitle, matchesTuneQuery, searchWords, tuneSearchRank } from "./titles";

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

describe("tune search matching and ranking", () => {
  const homers = { tuneId: 5901, settingId: 5901, title: "Homer's", kind: "reel", mode: "Bminor", meter: "4/4" };
  const kesh = { tuneId: 55, settingId: 55, title: "Kesh, The", kind: "jig", mode: "Gmajor", meter: "6/8" };
  const ril = { tuneId: 5529, settingId: 41455, title: "Ríl An Spidéil", kind: "reel", mode: "Dmajor", meter: "4/4" };

  it("normalizes possessives, plurals, articles and fadas into canonical words", () => {
    expect(searchWords("Homer's Reel")).toEqual(["homer", "reel"]);
    expect(searchWords("homer reel")).toEqual(["homer", "reel"]);
    expect(searchWords("homers reels")).toEqual(["homer", "reel"]);
    expect(searchWords("The Kesh Jig")).toEqual(["kesh", "jig"]);
  });

  it("matches The Session titles when the query includes the tune type or drops apostrophes", () => {
    expect(matchesTuneQuery(homers, "homer")).toBe(true);
    expect(matchesTuneQuery(homers, "homer's")).toBe(true);
    expect(matchesTuneQuery(homers, "homer reel")).toBe(true);
    expect(matchesTuneQuery(homers, "homer's reel")).toBe(true);
    expect(matchesTuneQuery(homers, "homers reel")).toBe(true);
    expect(matchesTuneQuery(homers, "https://thesession.org/tunes/5901")).toBe(true);
    expect(matchesTuneQuery(kesh, "the kesh jig")).toBe(true);
    expect(matchesTuneQuery(kesh, "kesh g major")).toBe(true);
    expect(matchesTuneQuery(ril, "ril spideil")).toBe(true);
  });

  it("ranks exact title + type matches ahead of partial matches", () => {
    expect(tuneSearchRank(homers, "homer reel")).toBe(0);
    expect(tuneSearchRank(homers, "homer's reel")).toBe(0);
    expect(tuneSearchRank(kesh, "the kesh jig")).toBe(0);
    expect(tuneSearchRank({ title: "Sean Coughlan's Kesh", kind: "jig" }, "the kesh jig")).toBe(2);
  });
});
