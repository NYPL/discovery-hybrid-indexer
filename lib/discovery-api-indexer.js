const highland = require('highland')

const ResourceIndexer = require('discovery-api-indexer/lib/resource-indexer')
const index = require('discovery-api-indexer/lib/index')

const logger = require('./logger')
const kmsHelper = require('./kms-helper')

const reindexBibs = (bibs) => {
  let totalProcessed = null
  let totalSuppressed = null

  return elasticConnect().then(() => {
    return new Promise((resolve, reject) => {
      logger.debug(`Now indexing ${bibs.length} bibs: ${bibs.map((b) => b.uri).join(', ')}`)

      ResourceIndexer.processStreamOfBibs(highland(bibs))
        .map((counts) => {
          totalProcessed = counts.savedCount
          totalSuppressed = counts.suppressedCount
          return null
        })
        .stopOnError((e) => {
          console.log('Error: ', e)
          return reject(e)
        })
        .done(() => {
          logger.info('Completed processing ' + totalProcessed + ' doc(s)')
          if (totalSuppressed) logger.info('  Suppressed ' + totalSuppressed + ' doc(s)')
          return resolve({
            totalProcessed,
            totalSuppressed
          })
        })
    })
  })
}

let elasticConnection = null
/**
 *  Returns a promise that resolves when ES creds have been decrypting,
 *  allowing connections with ES
 */
const elasticConnect = () => {
  if (!elasticConnection) {
    elasticConnection = kmsHelper.decrypt(process.env.ELASTICSEARCH_CONNECTION_URI)
      .then((elasticUri) => {
        index.setConnection(elasticUri)
      })
  }
  return elasticConnection
}

/**
 * Get current ES document for bibId
 */
const currentDocument = (bibId) => {
  return elasticConnect().then(() => {
    return index.search({
      index: process.env.ELASTIC_RESOURCES_INDEX_NAME,
      body: {
        query: { term: { uris: bibId } }
      }
    })
      .then((record) => {
        if (!record.hits.hits[0]) throw new Error(`Could not find ${bibId}`)

        return record.hits.hits[0]._source
      })
  })
}

module.exports = {
  reindexBibs,
  currentDocument
}
