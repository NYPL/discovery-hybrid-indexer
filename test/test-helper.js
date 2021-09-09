const dotenv = require('dotenv')

const logger = require('../lib/logger')

dotenv.config({ path: './config/test.env' })

global.expect = require('chai').expect

before(() => {
  // Ensure logger respects configured loglevel before running any tests:
  logger.setLevel(process.env.LOGLEVEL || 'error')
})
