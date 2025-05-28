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
const { PrismaClient } = require('@prisma/client');

async function checkDatabaseConnection() {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    console.log('Database connection successful');
    return true;
  } catch (error) {
    console.error('Database connection failed:', error.message);
    console.error('Make sure your Docker database is running with: npm run db:up');
    return false;
  } finally {
    await prisma.$disconnect();
  }
}


async function main() {
  // Check database connection first
  const isConnected = await checkDatabaseConnection();
  if (!isConnected) {
    process.exit(1);
  }

  try {
    // Create migration manager
    const manager = new MigrationManager();
    
    // Register migrators in any order (they'll be sorted by priority)
    manager
      .registerMigrator(new ChallengeConstraintMigrator())
      .registerMigrator(new ChallengeDiscussionOptionMigrator())
      .registerMigrator(new ChallengeEventMigrator())
      .registerMigrator(new ChallengeSkillMigrator())
      .registerMigrator(new ChallengeTermMigrator())
      .registerMigrator(new ChallengeWinnerMigrator())
      .registerMigrator(new PrizeMigrator())
      .registerMigrator(new ChallengePrizeSetMigrator())
      .registerMigrator(new TimelineTemplatePhaseMigrator())
      .registerMigrator(new ChallengePhaseConstraintMigrator())
      .registerMigrator(new ChallengePhaseMigrator())
      .registerMigrator(new ChallengeMetadataMigrator())
      .registerMigrator(new ChallengeDiscussionMigrator())
      .registerMigrator(new ChallengeLegacyMigrator())
      .registerMigrator(new ChallengeBillingMigrator())
      .registerMigrator(new PhaseMigrator())
      .registerMigrator(new ChallengeTimelineTemplateMigrator())
      .registerMigrator(new TimelineTemplateMigrator())
      .registerMigrator(new ChallengeMigrator())
      .registerMigrator(new ChallengeTypeMigrator())
      .registerMigrator(new ChallengeTrackMigrator());
    
    // Run migration
    await manager.migrate();
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

main();