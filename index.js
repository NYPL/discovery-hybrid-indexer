const discoveryStoreModel = require('./lib/discovery-store-model')
const discoveryApiIndexer = require('./lib/discovery-api-indexer')
const platformApi = require('./lib/platform-api')
const logger = require('./lib/logger')
const { decodeRecordsFromEvent } = require('./lib/event-decoder')

/**
 * Given an array of bibs, fetches necessary items and holdings to fully
 * rebuild and save the ES document for each
 */
const fullRebuildForBibs = (bibs) => {
  logger.debug(`Full rebuild for bibs: ${bibs.map((b) => `${b.nyplSource}/${b.id}`).join(', ')}`)
  return discoveryStoreModel.buildDiscoveryStoreBibs(bibs)
    .then(discoveryApiIndexer.reindexBibs)
}

/**
 * Main lambda handler receiving Bib, Item, and Holding events
 */
const handler = (event, context, callback) => {
  logger.setLevel(process.env.LOGLEVEL || 'info')

  return decodeRecordsFromEvent(event).then((result) => {
    let updateTask = null

    logger.info(`Handling ${result.type} event: ${result.records.map((r) => `${r.nyplSource || ''}/${r.id}`).join(', ')}`)
    // Dispatch based on what kind of event (Bib, Item, or Holding)
    switch (result.type) {
      case 'Bib':
        updateTask = fullRebuildForBibs(result.records)
        break
      case 'Item':
        updateTask = platformApi.bibsForItems(result.records)
          .then((bibs) => fullRebuildForBibs(bibs))
        break
      case 'Holding':
        updateTask = platformApi.bibsForHoldings(result.records)
          .then((bibs) => fullRebuildForBibs(bibs))
        break
    }

    if (updateTask) {
      // Ensure lambda `callback` is fired after update:
      return updateTask.then((counts) => {
        const message = `Wrote ${counts.totalProcessed} doc(s)`
        logger.debug(`Firing callback with ${message}`)
        callback(null, message)
      })
    } else {
      logger.warn('Nothing to do for event', event)
      callback(null, 'Nothing to do.')
    }
  })
}

module.exports = {
  fullRebuildForBibs,
  handler
}
