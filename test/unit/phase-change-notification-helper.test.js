require("../../app-bootstrap");

const { expect } = require("chai");
const constants = require("../../app-constants");

const helperPath = require.resolve("../../src/common/helper");
const busApiPath = require.resolve("topcoder-bus-api-wrapper");

describe("phase change notification helper", () => {
  const settings = constants.PhaseChangeNotificationSettings.PHASE_CHANGE;
  const originalTemplateId = settings.sendgridTemplateId;
  const originalHelperModule = require.cache[helperPath];
  const originalBusApiModule = require.cache[busApiPath];
  let postedEvents;
  let failingRecipients;
  let helper;

  beforeEach(() => {
    postedEvents = [];
    failingRecipients = new Set();
    settings.sendgridTemplateId = "phase-change-template";

    // Load a fresh helper bound to a stub bus client so published events can be inspected.
    require.cache[busApiPath] = {
      id: busApiPath,
      filename: busApiPath,
      loaded: true,
      exports: () => ({
        postEvent: async (message) => {
          if (failingRecipients.has(message.payload.recipients[0])) {
            throw new Error("bus unavailable");
          }
          postedEvents.push(message);
        },
      }),
    };
    delete require.cache[helperPath];
    helper = require(helperPath);
  });

  afterEach(() => {
    settings.sendgridTemplateId = originalTemplateId;
    require.cache[helperPath] = originalHelperModule;
    if (originalBusApiModule) {
      require.cache[busApiPath] = originalBusApiModule;
    } else {
      delete require.cache[busApiPath];
    }
  });

  it("publishes a separate email event for each recipient", async () => {
    const data = { challengeName: "Design challenge", phase_change: "Registration Closed" };

    await helper.sendPhaseChangeNotification(
      "PHASE_CHANGE",
      ["alice@example.com", "", "bob@example.com"],
      data,
    );

    expect(postedEvents).to.have.length(2);
    expect(postedEvents.map((event) => event.topic)).to.deep.equal([
      "external.action.email",
      "external.action.email",
    ]);
    expect(postedEvents.map((event) => event.payload.recipients)).to.deep.equal([
      ["alice@example.com"],
      ["bob@example.com"],
    ]);
    postedEvents.forEach((event) => {
      expect(event.payload.data).to.deep.equal(data);
      expect(event.payload.sendgrid_template_id).to.equal("phase-change-template");
    });
  });

  it("continues notifying remaining recipients when one publish fails", async () => {
    failingRecipients.add("alice@example.com");

    await helper.sendPhaseChangeNotification(
      "PHASE_CHANGE",
      ["alice@example.com", "bob@example.com"],
      {},
    );

    expect(postedEvents.map((event) => event.payload.recipients)).to.deep.equal([
      ["bob@example.com"],
    ]);
  });
});
