/*
 * Prepare for tests.
 */

// During the test the env variable is set to test
process.env.NODE_ENV = 'test'

const prepare = require('mocha-prepare')
const config = require('config')
const { S3Client, HeadBucketCommand, CreateBucketCommand } = require('@aws-sdk/client-s3')

/*
 * Initialize an S3 bucket.
 */
async function initBucket () {
  const s3 = new S3Client({
    region: config.AMAZON.AWS_REGION,
    endpoint: config.S3_ENDPOINT,
    credentials: {
      accessKeyId: config.AMAZON.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AMAZON.AWS_SECRET_ACCESS_KEY
    },
    forcePathStyle: true,
    tls: false
  })
  
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.AMAZON.ATTACHMENT_S3_BUCKET }))
  } catch (err) {
    await s3.send(new CreateBucketCommand({ Bucket: config.AMAZON.ATTACHMENT_S3_BUCKET }))
  }
}

prepare(function (done) {
  initBucket()
    .then(result => {
      done()
    })
}, function (done) {
  done()
})
