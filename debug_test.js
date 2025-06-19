const axios = require('axios');
const config = require('config');

async function testSkillsAPI() {
  console.log('Testing Skills API...');
  try {
    const skillIds = ['ce5987e8-da5d-4069-af38-ad9d1bb7b7cf'];
    const queryString = `disablePagination=true&skillId=${encodeURIComponent(skillIds[0])}`;
    const url = `${config.API_BASE_URL}/v5/standardized-skills/skills?${queryString}`;
    console.log('Skills API URL:', url);
    
    const res = await axios.get(url);
    console.log('Skills API Response:', JSON.stringify(res.data, null, 2));
  } catch (error) {
    console.error('Skills API Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

async function testChallengeAPI() {
  console.log('\nTesting Challenge API...');
  try {
    const url = 'http://localhost:3000/v6/challenges/59a4dd3a-3bc2-49fa-bd5c-63d4d1ca9d9e';
    console.log('Challenge API URL:', url);
    
    const res = await axios.get(url);
    console.log('Challenge Skills:', JSON.stringify(res.data.skills, null, 2));
  } catch (error) {
    console.error('Challenge API Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
    }
  }
}

async function testChallengeCreation() {
  console.log('\nTesting Challenge Creation...');
  try {
    const challengeData = {
      "status": "New",
      "projectId": "100339",
      "name": "test",
      "typeId": "927abff4-7af9-4145-8ba1-577c16e64e2e",
      "trackId": "9b6fc876-f4d9-4ccb-9dfd-419247628825",
      "startDate": "2025-06-18T22:23:08+08:00",
      "legacy": {
        "reviewType": "COMMUNITY"
      },
      "descriptionFormat": "markdown",
      "timelineTemplateId": "7ebf1c69-f62f-4d3a-8774-63c612d99cd4",
      "terms": [
        {
          "id": "317cd8f9-d66c-4f2a-8774-63c612d99cd4",
          "roleId": "732339e7-8e30-49d7-9198-cccf9451e221"
        }
      ],
      "groups": [],
      "tags": [],
      "discussions": [
        {
          "name": "test Discussion",
          "type": "challenge",
          "provider": "vanilla"
        }
      ],
      "metadata": [
        {
          "name": "show_data_dashboard",
          "value": "false"
        }
      ]
    };

    const url = 'http://localhost:3000/v6/challenges';
    console.log('Challenge Creation URL:', url);
    
    const res = await axios.post(url, challengeData, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer TEST_TOKEN' // This will likely fail due to auth
      }
    });
    console.log('Challenge Creation Success:', res.data.id);
  } catch (error) {
    console.error('Challenge Creation Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

async function main() {
  await testSkillsAPI();
  await testChallengeAPI();
  await testChallengeCreation();
}

main().catch(console.error); 