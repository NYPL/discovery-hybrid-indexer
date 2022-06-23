const dotenv = require('dotenv')
const sinon = require('sinon')

const discoveryApiIndex = require('discovery-api-indexer/lib/index')
const logger = require('../lib/logger')
const kmsHelper = require('../lib/kms-helper')

dotenv.config({ path: './config/test.env' })

global.expect = require('chai').expect

before(() => {
  // Ensure logger respects configured loglevel before running any tests:
  logger.setLevel(process.env.LOGLEVEL || 'error')

  // Let's generally stub index writes and deletes across all tests
  sinon.stub(discoveryApiIndex.resources, 'save')
    .callsFake((indexName, records, update) => {
      global.indexedDocuments = global.indexedDocuments.concat(records)
      return Promise.resolve()
    })

  sinon.stub(discoveryApiIndex.resources, 'delete')
    .callsFake((indexName, uri) => {
      global.deletedUris = global.deletedUris.concat(uri)
      return Promise.resolve()
    })

  sinon.stub(kmsHelper, 'decrypt').callsFake((val) => {
    // If updating fixtures, pass the origianl value through because local
    // config is decrypted
    return Promise.resolve(process.UPDATE_FIXTURES ? val : 'decrypted!')
  })

  global.indexedDocuments = []
  global.deletedUris = []
})

after(() => {
  kmsHelper.decrypt.restore()
  discoveryApiIndex.resources.save.restore()
  discoveryApiIndex.resources.delete.restore()
})

afterEach(() => {
  global.indexedDocuments = []
  global.deletedUris = []
})
