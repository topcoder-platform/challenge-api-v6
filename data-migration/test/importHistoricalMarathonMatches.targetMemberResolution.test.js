const {
  createMemberPresenceResolver,
} = require("../src/scripts/importHistoricalMarathonMatches/targetMemberResolution");

describe("importHistoricalMarathonMatches target member resolution", () => {
  test("casts lookup placeholders to bigint and returns normalized member ids", async () => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ userId: 1 }, { userId: "2" }]),
    };
    const resolveMemberPresence = createMemberPresenceResolver({
      prisma,
      memberSchema: "members",
    });

    const resolved = await resolveMemberPresence({
      memberIds: ["1", "2", "2", "invalid"],
    });

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      'SELECT "userId" FROM "members"."member" WHERE "userId" IN ($1::bigint, $2::bigint)',
      "1",
      "2"
    );
    expect(resolved).toEqual(new Set(["1", "2"]));
  });
});
