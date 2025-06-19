const m2mHelper = require('./src/common/m2m-helper');

async function getToken() {
  try {
    const token = await m2mHelper.getM2MToken();
    console.log(token);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

getToken(); 