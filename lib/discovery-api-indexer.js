const highland = require('highland')

const ResourceIndexer = require('discovery-api-indexer/lib/resource-indexer')
const index = require('discovery-api-indexer/lib/index')
const NyplSourceMapper = require('discovery-store-models/lib/nypl-source-mapper')

const logger = require('./logger')
const kmsHelper = require('./kms-helper')
const { uriForRecordIdentifier } = require('./utils')

/**
 *  Given a Sierra bib record, deletes the corresponding record in ES if it exists.
 */
const suppressBib = async (bib) => {
  const bibUri = uriForRecordIdentifier(bib.nyplSource, bib.id, 'bib')

  await elasticConnect()

  // Support a killswitch if something goes awry:
  if (process.env.DISABLE_CIRC_DELETE === 'true') return Promise.resolve()

  return index.resources.delete(process.env.ELASTIC_RESOURCES_INDEX_NAME, bibUri)
    .catch((e) => {
      // Ignore 404 errors. Log other errors:
      if (e.message !== 'Not Found') {
        logger.warn(`Non-404 error encountered deleting a bib by id: ${bibUri}: `, e)
      }
      return Promise.resolve()
    })
}

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

/**
 * Issue an arbitrary query on the index:
 */
const queryIndex = (body, extra = {}) => {
  return elasticConnect().then(() => {
    const params = Object.assign({}, { body }, extra)
    return index.search(params)
  })
}

/**
 * Issue a scroll on the index:
 */
const queryIndexScroll = (params) => {
  return elasticConnect().then(() => {
    return index.scroll(params)
  })
}

/**
 * Get bib identifiers for item identifier
 *
 * e.g. getBibIdentifiersForItemId ('sierra-nypl', '1234')
 *      => [{ nyplSource: 'sierra-nypl', id: '9876', type: 'bib' }]
 */
const getBibIdentifiersForItemId = (nyplSource, itemId) => {
  const itemUri = uriForRecordIdentifier(nyplSource, itemId, 'item')

  logger.debug(`Getting bibIds for item ${itemUri}`)

  const query = {
    nested: {
      path: 'items',
      query: {
        term: {
          'items.uri': itemUri
        }
      }
    }
  }

  return elasticConnect().then(() => {
    return index.search({
      index: process.env.ELASTIC_RESOURCES_INDEX_NAME,
      body: {
        query,
        _source: ['uri']
      }
    })
      .then((record) => {
        return record.hits.hits.map((hit) => hit._source.uri)
          .map((uri) => NyplSourceMapper.instance().splitIdentifier(uri))
      })
  })
}

module.exports = {
  reindexBibs,
  currentDocument,
  queryIndex,
  queryIndexScroll,
  getBibIdentifiersForItemId,
  suppressBib
}
