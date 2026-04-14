const {
  buildPlacementEntries,
} = require("../src/scripts/importMarathonMatchWinners");

describe("importMarathonMatchWinners placement normalization", () => {
  test("skips lower-scoring duplicate placements within a round", () => {
    const { resultsByRound, userIds, skipped } = buildPlacementEntries(
      [
        {
          round_id: "10929",
          coder_id: "22657314",
          placed: "18",
          system_point_total: "19837.23",
          point_total: "2486.27",
        },
        {
          round_id: "10929",
          coder_id: "22695240",
          placed: "18",
          system_point_total: "0.00",
          point_total: null,
        },
        {
          round_id: "10929",
          coder_id: "30000000",
          placed: "18",
          system_point_total: null,
          point_total: null,
        },
        {
          round_id: "10929",
          coder_id: "30000001",
          placed: "19",
          system_point_total: "123.45",
          point_total: null,
        },
        {
          round_id: "20000",
          coder_id: "40000001",
          placed: "1",
          system_point_total: "999.99",
          point_total: null,
        },
      ],
      { roundIds: ["10929"] }
    );

    expect(Array.from(userIds)).toEqual([
      22657314,
      22695240,
      30000000,
      30000001,
    ]);
    expect(skipped).toEqual({
      missingRoundId: 0,
      invalidUserId: 0,
      missingPlacement: 0,
      invalidPlacement: 0,
      conflictingDuplicatePlacement: 2,
    });
    expect(resultsByRound.get("10929")).toEqual([
      expect.objectContaining({
        roundId: "10929",
        userId: 22657314,
        placement: 18,
        rawPlacement: 18,
        score: 19837.23,
      }),
      expect.objectContaining({
        roundId: "10929",
        userId: 30000001,
        placement: 19,
        rawPlacement: 19,
        score: 123.45,
      }),
    ]);
    expect(resultsByRound.has("20000")).toBe(false);
  });
});
