const kmsHelper = require('./kms-helper')
const logger = require('./logger')
const scsbClient = require('@nypl/scsb-rest-client')

let _clientPromise = null

/**
 *  Get an SCSB client instance
 *
 *  @return {Promies<scsbclient>} - Returns a promise that resolves an authenticated client
 */
const instance = async () => {
  if (!_clientPromise) {
    // Preflight check:
    if ([
      'SCSB_URL',
      'SCSB_API_KEY'
    ].some((env) => !process.env[env])) {
      throw new Error('Config error: Missing SCSB API creds')
    }

    _clientPromise = Promise.all([
      kmsHelper.decrypt(process.env.SCSB_URL),
      kmsHelper.decrypt(process.env.SCSB_API_KEY)
    ])
      .then((creds) => {
        const [decryptedUrl, decryptedKey] = creds

        const concurrency = parseInt(process.env.MAX_PARALLEL_SCSB_QUERIES || '10')
        logger.info(`Setting SCSB API concurrency to ${concurrency}`)

        scsbClient.config({
          url: decryptedUrl,
          apiKey: decryptedKey,
          concurrency
        })

        return scsbClient
      })
  }

  return _clientPromise
}

module.exports = {
  instance
}
