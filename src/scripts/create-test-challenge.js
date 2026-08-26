#!/usr/bin/env node

/**
 * Utility script to quickly create test challenges with specific configurations
 * Useful for development and bug testing
 *
 * Usage Examples:
 *   # Challenge in Review phase with 2 submissions and 2 reviewers
 *   node src/scripts/create-test-challenge.js --phase review --submissions 2 --reviewers 2
 *
 *   # Challenge in Submission phase
 *   node src/scripts/create-test-challenge.js --phase submission
 *
 *   # Full custom config
 *   node src/scripts/create-test-challenge.js --phase review --submissions 5 --reviewers 3 --name "Custom Challenge"
 */

const axios = require('axios')
const config = require('config')
const { v4: uuidv4 } = require('uuid')
const m2mHelper = require('../common/m2m-helper')

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    phase: 'submission', // 'submission' or 'review'
    submissions: 1,
    reviewers: 1,
    name: null,
    trackId: null,
    typeId: null,
    timelineTemplateId: null,
    duration: 604800, // 1 week in seconds
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const value = args[i + 1]

    switch (arg) {
      case '--phase':
        options.phase = value.toLowerCase()
        i++
        break
      case '--submissions':
        options.submissions = parseInt(value, 10)
        i++
        break
      case '--reviewers':
        options.reviewers = parseInt(value, 10)
        i++
        break
      case '--name':
        options.name = value
        i++
        break
      case '--track-id':
        options.trackId = value
        i++
        break
      case '--type-id':
        options.typeId = value
        i++
        break
      case '--timeline-id':
        options.timelineTemplateId = value
        i++
        break
      case '--duration':
        options.duration = parseInt(value, 10)
        i++
        break
      case '--help':
        printHelp()
        process.exit(0)
    }
  }

  return options
}

function printHelp() {
  console.log(`
${colors.blue}Challenge Test Fixture Creator${colors.reset}

${colors.yellow}Usage:${colors.reset}
  node src/scripts/create-test-challenge.js [options]

${colors.yellow}Options:${colors.reset}
  --phase PHASE              Challenge phase: 'submission' or 'review' (default: submission)
  --submissions N            Number of submissions to create (default: 1)
  --reviewers N              Number of reviewers needed (only for review phase) (default: 1)
  --name NAME                Custom challenge name (default: auto-generated)
  --track-id UUID            Track ID (default: auto-detect)
  --type-id UUID             Challenge Type ID (default: auto-detect)
  --timeline-id UUID         Timeline Template ID (default: auto-detect)
  --duration SECONDS         Phase duration in seconds (default: 604800 = 1 week)
  --help                     Show this help message

${colors.yellow}Examples:${colors.reset}
  # Challenge in review phase with 2 submissions and 2 reviewers
  node src/scripts/create-test-challenge.js --phase review --submissions 2 --reviewers 2

  # Challenge in submission phase
  node src/scripts/create-test-challenge.js --phase submission

  # Custom challenge
  node src/scripts/create-test-challenge.js --phase review --submissions 5 --reviewers 3 --name "Bug Fix Testing"

${colors.yellow}Environment Variables:${colors.reset}
  CHALLENGE_API_URL          Base URL for Challenge API (default: http://localhost:3000)
  `)
}

async function getRequiredIds() {
  const baseUrl = process.env.CHALLENGE_API_URL || 'http://localhost:3000'

  try {
    console.log(`${colors.blue}Fetching required IDs from API...${colors.reset}`)

    // Fetch challenge types
    const typesRes = await axios.get(`${baseUrl}/v6/challenge-types`)
    const types = typesRes.data
    const challengeType = types.find(t => t.name === 'Challenge')
    if (!challengeType) throw new Error('Challenge type not found')

    // Fetch tracks
    const tracksRes = await axios.get(`${baseUrl}/v6/challenge-tracks`)
    const tracks = tracksRes.data
    const devTrack = tracks.find(t => t.name === 'Development')
    if (!devTrack) throw new Error('Development track not found')

    // Fetch timeline templates
    const templatesRes = await axios.get(`${baseUrl}/v6/timeline-templates`)
    const templates = templatesRes.data
    const standardTemplate = templates.find(t => t.name && t.name.includes('Standard'))
    if (!standardTemplate) throw new Error('Timeline template not found')

    return {
      typeId: challengeType.id,
      trackId: devTrack.id,
      timelineTemplateId: standardTemplate.id,
    }
  } catch (error) {
    console.error(`${colors.red}Error fetching IDs: ${error.message}${colors.reset}`)
    throw error
  }
}

async function createChallenge(options, ids) {
  const baseUrl = process.env.CHALLENGE_API_URL || 'http://localhost:3000'

  try {
    const token = await m2mHelper.getM2MToken()

    const challengeName = options.name || `Test Challenge [${Date.now()}]`
    const now = new Date()
    const registrationEnd = new Date(now.getTime() + options.duration * 1000)
    const submissionEnd = new Date(registrationEnd.getTime() + options.duration * 1000)
    const reviewEnd = new Date(submissionEnd.getTime() + options.duration * 1000)

    const phases = [
      {
        id: uuidv4(),
        name: 'Registration',
        phaseId: '6969125a-a12f-4b89-8de6-e66b0056f36b', // Standard registration phase ID
        duration: options.duration,
        scheduledStartDate: now.toISOString(),
        scheduledEndDate: registrationEnd.toISOString(),
        isOpen: true,
        description: 'Registration Phase',
      },
      {
        id: uuidv4(),
        name: 'Submission',
        phaseId: '6959aa9b-8c60-475c-a9e8-12affc3becc3', // Standard submission phase ID
        duration: options.duration,
        scheduledStartDate: registrationEnd.toISOString(),
        scheduledEndDate: submissionEnd.toISOString(),
        isOpen: options.phase === 'submission',
        description: 'Submission Phase',
        predecessor: undefined,
        constraints: [],
      },
    ]

    // Add Review phase if requested
    if (options.phase === 'review') {
      const submissionPhaseId = phases[1].id
      phases.push({
        id: uuidv4(),
        name: 'Review',
        phaseId: 'aa5a3f78-79e0-4bf7-93ff-b11e8f5b398b', // Standard review phase ID
        duration: options.duration,
        scheduledStartDate: submissionEnd.toISOString(),
        scheduledEndDate: reviewEnd.toISOString(),
        isOpen: false,
        description: 'Review Phase',
        predecessor: submissionPhaseId,
        constraints: [
          {
            name: 'Number of Reviewers',
            value: String(options.reviewers),
          },
        ],
      })
    }

    // Add constraints to submission phase for tracking
    if (options.submissions > 0) {
      if (!phases[1].constraints) phases[1].constraints = []
      phases[1].constraints.push({
        name: 'Expected Submissions',
        value: String(options.submissions),
      })
    }

    const challengePayload = {
      id: uuidv4(),
      name: challengeName,
      description: `Auto-generated test challenge - Phase: ${options.phase}, Submissions: ${options.submissions}, Reviewers: ${options.reviewers}`,
      descriptionFormat: 'markdown',
      typeId: options.typeId || ids.typeId,
      trackId: options.trackId || ids.trackId,
      timelineTemplateId: options.timelineTemplateId || ids.timelineTemplateId,
      phases,
      legacy: {
        track: 'DEVELOPMENT',
        subTrack: 'DEVELOPMENT',
        reviewType: 'COMMUNITY',
        confidentialityType: 'public',
      },
    }

    console.log(`${colors.blue}Creating challenge: ${challengeName}${colors.reset}`)
    console.log(`${colors.yellow}Payload:${colors.reset}`)
    console.log(JSON.stringify(challengePayload, null, 2))

    const response = await axios.post(`${baseUrl}/v6/challenges`, challengePayload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    const createdChallenge = response.data

    console.log(`\n${colors.green}✓ Challenge created successfully!${colors.reset}`)
    console.log(`${colors.blue}Challenge ID: ${createdChallenge.id}${colors.reset}`)
    console.log(`${colors.blue}Challenge Name: ${createdChallenge.name}${colors.reset}`)
    console.log(`${colors.blue}Phase: ${options.phase.toUpperCase()}${colors.reset}`)
    if (options.submissions > 0) {
      console.log(`${colors.blue}Expected Submissions: ${options.submissions}${colors.reset}`)
    }
    if (options.phase === 'review') {
      console.log(`${colors.blue}Expected Reviewers: ${options.reviewers}${colors.reset}`)
    }

    console.log(`\n${colors.yellow}Next Steps:${colors.reset}`)
    console.log(`1. Register users for the challenge`)
    console.log(`2. Have ${options.submissions} user(s) submit solutions`)
    if (options.phase === 'review') {
      console.log(`3. Assign ${options.reviewers} reviewer(s) to the challenge`)
      console.log(`4. Reviews are ready in the Review app`)
    }

    return createdChallenge
  } catch (error) {
    console.error(`${colors.red}Error creating challenge: ${error.message}${colors.reset}`)
    if (error.response?.data) {
      console.error(`${colors.red}Response: ${JSON.stringify(error.response.data, null, 2)}${colors.reset}`)
    }
    throw error
  }
}

async function main() {
  try {
    const options = parseArgs()

    // Validate options
    if (!['submission', 'review'].includes(options.phase)) {
      console.error(`${colors.red}Invalid phase: ${options.phase}. Must be 'submission' or 'review'${colors.reset}`)
      process.exit(1)
    }

    console.log(`${colors.blue}=== Challenge Test Fixture Creator ===${colors.reset}\n`)

    // Get required IDs if not provided
    let ids = {
      typeId: options.typeId,
      trackId: options.trackId,
      timelineTemplateId: options.timelineTemplateId,
    }

    if (!ids.typeId || !ids.trackId || !ids.timelineTemplateId) {
      ids = await getRequiredIds()
    }

    // Create the challenge
    const challenge = await createChallenge(options, ids)

    console.log(`\n${colors.green}Ready to test! 🎉${colors.reset}`)
  } catch (error) {
    console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`)
    process.exit(1)
  }
}

main()
