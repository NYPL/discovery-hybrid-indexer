const NYPLDataApiClient = require('@nypl/nypl-data-api-client')

const logger = require('./logger')
const kmsHelper = require('./kms-helper')
const utils = require('./utils')
const discoveryApiIndexer = require('./discovery-api-indexer')

let clientPromise = null

/**
 * Initialize a Platform API client from encrypted creds found in process.env
 *
 */
const init = () => {
  // Create a Promise to decrypt creds and resolve a client:
  if (!clientPromise) {
    clientPromise = Promise.all([
      kmsHelper.decrypt(process.env.NYPL_OAUTH_KEY),
      kmsHelper.decrypt(process.env.NYPL_OAUTH_SECRET)
    ]).then((decrypted) => {
      const [key, secret] = decrypted

      return new NYPLDataApiClient({
        base_url: process.env.NYPL_API_BASE_URL,
        oauth_key: key,
        oauth_secret: secret,
        oauth_url: process.env.NYPL_OAUTH_URL,
        log_level: 'error'
      })
    })
  }

  return clientPromise
}

const arrayFlatten = (a) => [].concat.apply([], a)

const bibIdentifiersForItems = async (items) => {
  let identifiers = await Promise.all(
    items.map((item) => {
      if (item.bibIds && Array.isArray(item.bibIds) && item.bibIds.length > 0) {
        return item.bibIds
          .map((id) => ({ nyplSource: item.nyplSource, id }))
      } else {
        // No bibIds? Probably a deleted item. Look up bibIds via DiscoveryAPI
        return discoveryApiIndexer.getBibIdentifiersForItemId(item.nyplSource, item.id)
      }
    })
  )
  // Turn this array of arrays of identifiers into an array of identifiers
  identifiers = arrayFlatten(identifiers)
    // And remove any for which we couldn't resolve a bibId
    .filter((identifier) => identifier)

  // De-dupe:
  return Object.values(
    identifiers.reduce((h, identifier) => {
      h[JSON.stringify(identifier)] = identifier
      return h
    }, {})
  )
}

// TODO: optimize by fetching all bibs at once via ?nyplSource=_&id=123,456,789
const bibsForItems = async (items) => {
  const bibIdentifiers = await bibIdentifiersForItems(items)
  let bibs = await Promise.all(
    bibIdentifiers.map((identifier) => {
      return bibById(identifier.nyplSource, identifier.id)
    })
  )
  bibs = bibs.filter((b) => b)

  return bibs
}

const bibIdentifiersForHoldings = (holdings) => {
  return arrayFlatten(
    holdings.map((item) => {
      return item.bibIds
        .map((id) => ({ nyplSource: 'sierra-nypl', id }))
    })
  )
}

// TODO: optimize by fetching all bibs at once via ?nyplSource=_&id=123,456,789
const bibsForHoldings = (holdings) => {
  return Promise.all(
    bibIdentifiersForHoldings(holdings)
      .map((ids) => bibById(ids.nyplSource, ids.id))
  )
}

let HOLDINGS_CACHE = {}

/**
 *  Given an array of bibs, turns HOLDINGS_CACHE into a hash with bibIds as
 *  keys, where each bibId points to a Promise that resolves an array of
 *  holdings for that bibId. HOLDINGS_CACHE is reset on each call.
 */
const prefetchHoldingsForBibs = (bibs) => {
  const fetchAllHoldings = holdingsForBibs(bibs)
    .then((holdings) => {
      return utils.groupObjectsByMultivalueProperty(holdings, 'bibIds')
    })

  HOLDINGS_CACHE = bibs.reduce((h, bib) => {
    const bibIdentifier = `${bib.nyplSource}/${bib.id}`
    // If it's a partner bib, resolve empty array immediately:
    if (bib.nyplSource !== 'sierra-nypl') {
      h[bibIdentifier] = Promise.resolve([])
    } else {
      // Await the greater fetch operation before selecting the holdings
      // relevant to the given bib:
      h[bibIdentifier] = fetchAllHoldings
        .then((holdingsGrouped) => holdingsGrouped[bib.id] || [])
    }
    return h
  }, {})
}

/**
 *  Given a bib, resolves an array of holdings relevant for the bib
 */
const holdingsForBib = (bib) => {
  const bibIdentifier = `${bib.nyplSource}/${bib.id}`
  if (HOLDINGS_CACHE[bibIdentifier]) {
    logger.debug(`holdingsForBib: Using holdings_cache for ${bibIdentifier}`)
    return HOLDINGS_CACHE[bibIdentifier]
  } else {
    logger.debug(`holdingsForBib: Fetching holdings for bib ${bibIdentifier} via API`)
    return holdingsForBibs([bib])
  }
}

/**
 * Given an array of bibs, resolves an array of holdings relevant to the bibs
 */
const holdingsForBibs = (bibs) => {
  // Only fetch NYPL bibs
  const nyplBibs = bibs.filter((bib) => bib.nyplSource === 'sierra-nypl')
  const bibGroups = utils.arrayChunks(nyplBibs, 25)
  logger.debug('holdingsForBibs: Fetching holdings for bibs in groups: ', bibGroups)
  return init().then((client) => {
    return Promise.all(
      bibGroups.map((bibs) => {
        return client.get(`holdings?bib_ids=${bibs.map((bib) => bib.id).join(',')}`)
          .then((resp) => {
            const holdings = resp
            logger.debug(`Got ${(resp.data ? resp.data.length : 'no')} holdings for bibs: ${bibs.map((b) => b.id).join(',')}`)
            return holdings || []
          })
      })
    ).then(arrayFlatten)
  })
}

const itemsForBib = (bib, offset = 0) => {
  const limit = 500
  logger.debug('PlatformApi#itemsForBib: Fetch: ' + `bibs/${bib.nyplSource}/${bib.id}/items?limit=${limit}&offset=${offset}`)

  return init().then((client) => {
    return client.get(`bibs/${bib.nyplSource}/${bib.id}/items?limit=${limit}&offset=${offset}`)
      .then((resp) => {
        logger.debug(`PlatformApi#itemsForBib: Got ${resp.data ? resp.data.length : 'no'} items`)
        const items = resp.data
        if (!items) return []
        if (items.length < limit) {
          return items
        } else {
          logger.debug(`PlatformApi#itemsForBib: paginate because received ${resp.data.length}`)
          return itemsForBib(bib, offset + limit)
            .then((otherItems) => {
              return items.concat(otherItems)
            })
        }
      })
  })
}

const bibById = (nyplSource, id) => {
  return init().then((client) => {
    return client.get(`bibs/${nyplSource}/${id}`)
      .then((resp) => {
        if (!resp || !resp.data) {
          logger.warning(`Warning: bib not found: ${nyplSource}/${id}`)
          return null
        }
        return resp.data
      })
  })
}

const getSchema = (schemaName) => {
  return init().then((client) => {
    return client.get(`current-schemas/${schemaName}`, { authenticate: false })
  })
}

/**
 *
 *  Given an array of barcodes, resolves a map relating barcodes to M2 customer
 *  codes (if found).
 */
const m2CustomerCodesForBarcodes = async (barcodes, offset = 0, map = {}) => {
  if (!barcodes || barcodes.length === 0) return {}

  // Batch calls to the m2-customer-code-store in groups of 200 barcodes:
  const batchSize = 200
  const barcodesBatch = barcodes.slice(offset, offset + batchSize)

  const client = await init()
  const response = await client.get(`m2-customer-codes?barcodes=${barcodesBatch.join(',')}`)

  // Convert response to a map relating barcode to CC:
  const responseAsMap = (response && response.data && Array.isArray(response.data))
    ? response.data.reduce((h, result) => {
        return Object.assign(h, { [result.barcode]: result.m2CustomerCode })
      }, {})
    : {}
  // Merge this map with the map built from previous batched calls:
  map = Object.assign(map, responseAsMap)

  // If there are no more batches to fetch, return map
  if (barcodes.length <= offset + batchSize) {
    return map
  } else {
    // There are more batches to fetch; recurse:
    return m2CustomerCodesForBarcodes(barcodes, offset + batchSize, map)
  }
}

module.exports = {
  bibsForItems,
  bibsForHoldings,
  itemsForBib,
  holdingsForBib,
  getSchema,
  bibById,
  prefetchHoldingsForBibs,
  m2CustomerCodesForBarcodes,
  internal: {
    init,
    bibIdentifiersForItems
  }
}
