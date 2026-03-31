"use strict";

const emitPlanReport = ({ records, summary }) => {
  records.forEach((record) => {
    process.stdout.write(`PLAN_RECORD ${JSON.stringify(record)}\n`);
  });
  process.stdout.write(`PLAN_SUMMARY ${JSON.stringify(summary)}\n`);
};

module.exports = {
  emitPlanReport,
};
