/*
 * Unit tests of attachment service
 */

require('../../app-bootstrap')
const fs = require('fs')
const path = require('path')
const { v4: uuid } = require('uuid');
const chai = require('chai')
const { mockClient } = require('aws-sdk-client-mock')
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3')
const { Readable } = require('stream')
const service = require('../../src/services/AttachmentService')
const testHelper = require('../testHelper')
const prisma = require('../../src/common/prisma').getClient()

const should = chai.should()

const attachmentContent = fs.readFileSync(path.join(__dirname, '../attachment.txt'))

// Create S3 mock client
const s3Mock = mockClient(S3Client)

describe('attachment service unit tests', () => {
  // created attachment id
  let id
  // generated data
  let data
  // attachment for task challenge
  let id2
  const notFoundId = uuid()

  before(async () => {
    // mock S3 GetObject command
    s3Mock.on(GetObjectCommand).resolves({
      Body: Readable.from([attachmentContent]),
      ContentType: 'text/plain'
    });
    
    await testHelper.createData()
    data = testHelper.getData()
    // create attachment
    const createdAttachment = await prisma.attachment.create({
      data: {
        name: 'attachment.txt',
        url: 'http://s3.amazonaws.com/topcoder_01/attachment.txt',
        fileSize: 1024,
        createdBy: 'testdata',
        updatedBy: 'testdata',
        challenge: { connect: { id: data.challenge.id } }
      }
    })
    id = createdAttachment.id
    const taskAttachment = await prisma.attachment.create({ 
      data: {
        name: 'attachment.txt',
        url: 'http://s3.amazonaws.com/topcoder_01/attachment.txt',
        fileSize: 1024,
        createdBy: 'testdata',
        updatedBy: 'testdata',
        challenge: { connect: { id: data.taskChallenge.id } }
      }
    })
    id2 = taskAttachment.id
  })

  after(async () => {
    await testHelper.clearData()
    await prisma.attachment.deleteMany({ where: { id }})
    // reset S3 mock
    s3Mock.reset()
  })

  describe('download attachment tests', () => {
    it('download attachment successfully', async () => {
      const result = await service.downloadAttachment({ isMachine: true }, data.challenge.id, id)
      should.equal(result.fileName, 'attachment.txt')
      should.equal(attachmentContent.compare(result.data), 0)
    })

    it('download attachment - forbidden', async () => {
      try {
        await service.downloadAttachment({ roles: ['user'], userId: 678678 }, data.taskChallenge.id, id2)
      } catch (e) {
        should.equal(e.message, 'You don\'t have access to view this challenge')
        return
      }
      throw new Error('should not reach here')
    })

    it('download attachment - attachment not found', async () => {
      try {
        await service.downloadAttachment({ isMachine: true }, data.challenge.id, notFoundId)
      } catch (e) {
        should.equal(e.message, `Attachment ${notFoundId} not found in challenge ${data.challenge.id}`)
        return
      }
      throw new Error('should not reach here')
    })

    it('download attachment - challenge id mismatched', async () => {
      try {
        await service.downloadAttachment({ isMachine: true }, notFoundId, id)
      } catch (e) {
        should.equal(e.message, `Attachment ${id} not found in challenge ${notFoundId}`)
        return
      }
      throw new Error('should not reach here')
    })

    it('download attachment - invalid id', async () => {
      try {
        await service.downloadAttachment({ isMachine: true }, data.challenge.id, 'invalid')
      } catch (e) {
        should.equal(e.message.indexOf('"attachmentId" must be a valid GUID') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })

    it('download attachment - invalid challenge id', async () => {
      try {
        await service.downloadAttachment({ isMachine: true }, 'invalid', id)
      } catch (e) {
        should.equal(e.message.indexOf('"challengeId" must be a valid GUID') >= 0, true)
        return
      }
      throw new Error('should not reach here')
    })
  })
})
