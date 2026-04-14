const { MigrationManager } = require('./migrationManager');
const { ChallengeMigrator } = require('./migrators/challengeMigrator')
const { ChallengeTypeMigrator } = require('./migrators/challengeTypeMigrator');
const { ChallengeTrackMigrator } = require('./migrators/challengeTrackMigrator');
const { TimelineTemplateMigrator } = require('./migrators/timelineTemplateMigrator');
const { ChallengeTimelineTemplateMigrator } = require('./migrators/challengeTimelineTemplateMigrator');
const { PhaseMigrator } = require('./migrators/phaseMigrator');
const { ChallengeBillingMigrator } = require('./migrators/challengeBillingMigrator');
const { ChallengeLegacyMigrator } = require('./migrators/challengeLegacyMigrator');
const { ChallengeDiscussionMigrator } = require('./migrators/challengeDiscussionMigrator');
const { ChallengeMetadataMigrator } = require('./migrators/challengeMetadataMigrator');
const { ChallengePhaseMigrator } = require('./migrators/challengePhaseMigrator');
const { ChallengePhaseConstraintMigrator } = require('./migrators/challengePhaseConstraintMigrator');
const { TimelineTemplatePhaseMigrator } = require('./migrators/timelineTemplatePhaseMigrator');
const { ChallengePrizeSetMigrator } = require('./migrators/challengePrizeSetMigrator');
const { PrizeMigrator } = require('./migrators/prizeMigrator');
const { ChallengeWinnerMigrator } = require('./migrators/challengeWinnerMigrator');
const { ChallengeTermMigrator } = require('./migrators/challengeTermMigrator');
const { ChallengeSkillMigrator } = require('./migrators/challengeSkillMigrator');
const { ChallengeEventMigrator } = require('./migrators/challengeEventMigrator');
const { ChallengeDiscussionOptionMigrator } = require('./migrators/challengeDiscussionOptionMigrator');
const { ChallengeConstraintMigrator } = require('./migrators/challengeConstraintMigrator');
async function main() {
  try {
    // Create migration manager
    const manager = new MigrationManager();
    
    // Register migrators in any order (they'll be sorted by priority)
    const migrators = [
//      new AuditLogMigrator(),
      new ChallengeConstraintMigrator(),
      new ChallengeDiscussionOptionMigrator(),
      new ChallengeEventMigrator(),
      new ChallengeSkillMigrator(),
      new ChallengeTermMigrator(),
      new ChallengeWinnerMigrator(),
      new PrizeMigrator(),
      new ChallengePrizeSetMigrator(),
      new TimelineTemplatePhaseMigrator(),
      new ChallengePhaseConstraintMigrator(),
      new ChallengePhaseMigrator(),
      new ChallengeMetadataMigrator(),
      new ChallengeDiscussionMigrator(),
      new ChallengeLegacyMigrator(),
      new ChallengeBillingMigrator(),
      new PhaseMigrator(),
      new ChallengeTimelineTemplateMigrator(),
      new TimelineTemplateMigrator(),
      new ChallengeMigrator(),
      new ChallengeTypeMigrator(),
      new ChallengeTrackMigrator()
    ];

    const requestedOnly = manager.config.MIGRATORS_ONLY;
    const requestedSet = requestedOnly ? new Set(requestedOnly.map(name => name.toLowerCase())) : null;

    if (requestedSet) {
      manager.logger.info(`MIGRATORS_ONLY set; limiting migration to: ${requestedOnly.join(', ')}`);
    }

    for (const migrator of migrators) {
      const identifiers = [
        migrator.modelName,
        migrator.constructor?.name,
        migrator.constructor?.name?.replace(/Migrator$/i, '')
      ].filter(Boolean).map(name => name.toLowerCase());

      const shouldInclude = !requestedSet || identifiers.some(name => requestedSet.has(name));

      if (!shouldInclude) {
        manager.logger.debug(`Skipping ${migrator.modelName} migrator due to MIGRATORS_ONLY filter`);
        continue;
      }

      manager.registerMigrator(migrator);
    }

    if (!manager.migrators.length) {
      manager.logger.warn('No migrators registered. Check MIGRATORS_ONLY configuration.');
      return;
    }

    // Run migration
    await manager.migrate();
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

main();
