const discoveryStoreModel = require('./lib/discovery-store-model')
const discoveryApiIndexer = require('./lib/discovery-api-indexer')
const platformApi = require('./lib/platform-api')
const logger = require('./lib/logger')
const { decodeRecordsFromEvent } = require('./lib/event-decoder')
const { validNyplSource } = require('./lib/utils')

const removeBibsWithInvalidNyplSources = async (bibs) => {
  const removed = []
  // Nullify records with invalid nyplSource
  bibs = await Promise.all(
    bibs.map(async (bib) => {
      const valid = await validNyplSource(bib.nyplSource, 'bib')
      if (!valid) {
        removed.push(`${bib.nyplSource}/${bib.id}`)
      }
      return valid ? bib : null
    })
  )
  if (removed.length > 0) {
    logger.info(`Skipping ${removed.length} bib(s) with invalid nyplSource: ${removed.join(',')}`)
  }
  // Remove null (removed) bibs
  return bibs.filter((bib) => bib)
}

/**
 * Given an array of bibs, fetches necessary items and holdings to fully
 * rebuild and save the ES document for each
 */
const fullRebuildForBibs = async (bibs) => {
  logger.debug(`Full rebuild for bibs: ${bibs.map((b) => `${b.nyplSource}/${b.id}`).join(', ')}`)

  bibs = await removeBibsWithInvalidNyplSources(bibs)

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
        updateTask = discoveryStoreModel.filterOutAndDeleteNonResearchBibs(result.records)
          .then(fullRebuildForBibs)
        break
      case 'Item':
        updateTask = discoveryStoreModel.filterOutNonResearchItems(result.records)
          .then(platformApi.bibsForItems)
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
        .catch((e) => {
          logger.error('Calling back with error: ', e)
          callback(e)
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
