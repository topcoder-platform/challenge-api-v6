const {
  convertComponentXmlToMarkdown,
  resolveDescriptionCandidateFromCounters,
} = require("../src/scripts/importHistoricalMarathonMatches/descriptionSourcing");

describe("importHistoricalMarathonMatches description sourcing", () => {
  test("converts structured Topcoder component XML into readable markdown", () => {
    const markdown = convertComponentXmlToMarkdown(
      "<?xml version=\"1.0\"?><problem xmlns=\"http://topcoder.com\" name=\"\"><signature><class>RandomWalking</class><method><name>displayTestCase</name><return><type>String</type></return><params><param><type>String</type><name>s</name></param></params></method><method><name>init</name><return><type>int</type></return><params><param><type>int</type><name>nodes</name></param></params></method><method><name>walk</name><return><type>int</type></return><params><param><type>int[]</type><name>seq</name></param></params></method></signature><intro>A random walk in a directed graph starts at some node in the graph.<br></br><br></br>You should write two methods: init and walk.</intro><notes><note>The memory limit is 64 MB.</note><note>The thread limit is 32.</note></notes><test-cases><test-case example=\"1\"><input>/ASCII34/1/ASCII34/</input><output>/ASCII34/0/ASCII58/ 1 2 9 \\n1/ASCII58/ 0 4 5 6 7 \\n/ASCII34/</output><annotation>Public sample.</annotation></test-case><test-case><input>/ASCII34/private/ASCII34/</input><output>/ASCII34/ignored/ASCII34/</output></test-case></test-cases></problem>"
    );

    expect(markdown).toContain("## Class");
    expect(markdown).toContain("`RandomWalking`");
    expect(markdown).toContain("## Methods");
    expect(markdown).toContain("`String displayTestCase(String s)`");
    expect(markdown).toContain("`int init(int nodes)`");
    expect(markdown).toContain("`int walk(int[] seq)`");
    expect(markdown).toContain("## Statement");
    expect(markdown).toContain("You should write two methods: init and walk.");
    expect(markdown).toContain("## Notes");
    expect(markdown).toContain("- The memory limit is 64 MB.");
    expect(markdown).toContain("## Examples");
    expect(markdown).toContain("### Example 1");
    expect(markdown).toContain("\"1\"");
    expect(markdown).toContain("0: 1 2 9");
    expect(markdown).toContain("Public sample.");
    expect(markdown).not.toContain("private");
    expect(markdown).not.toContain("/ASCII34/");
  });

  test("resolves html problem text with html description format", () => {
    expect(
      resolveDescriptionCandidateFromCounters({
        descriptionProblemText: "<p><strong>Legacy</strong> description</p>",
      })
    ).toEqual({
      description: "<p><strong>Legacy</strong> description</p>",
      descriptionFormat: "html",
      source: "legacy-problem-text",
    });
  });

  test("resolves component markdown with markdown description format", () => {
    expect(
      resolveDescriptionCandidateFromCounters({
        descriptionComponentTextMarkdown: "## Robot Routing\n\nPublic example only.",
      })
    ).toEqual({
      description: "## Robot Routing\n\nPublic example only.",
      descriptionFormat: "markdown",
      source: "legacy-component-text-markdown",
    });
  });
});
