const NYPLDataApiClient = require('@nypl/nypl-data-api-client')

const logger = require('./logger')
const kmsHelper = require('./kms-helper')

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

const bibIdentifiersForItems = (items) => {
  return arrayFlatten(
    items.map((item) => {
      return item.bibIds
        .map((id) => ({ nyplSource: item.nyplSource, id }))
    })
  )
}

// TODO: optimize by fetching all bibs at once via ?nyplSource=_&id=123,456,789
const bibsForItems = (items) => {
  return Promise.all(
    bibIdentifiersForItems(items)
      .map((ids) => bibById(ids.nyplSource, ids.id))
  )
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

const holdingsForBib = (bib, offset = 0) => {
  return init().then((client) => {
    return client.get(`holdings?bib_id=${bib.id}`)
      .then((resp) => {
        const holdings = resp
        logger.debug('Got ' + (resp.data ? resp.data.length : 'no') + ' holdings')
        return holdings || []
      })
  }).then((holdings) => {
    return holdings
  })
}

const itemsForBib = (bib, offset = 0) => {
  const limit = 500
  logger.debug('PlatformApi#itemsForBib: Fetch: ' + `bibs/${bib.nyplSource}/${bib.id}/items?limit=${limit}&offset=${offset}`)

  return init().then((client) => {
    return client.get(`bibs/${bib.nyplSource}/${bib.id}/items?limit=${limit}&offset=${offset}`)
      .then((resp) => {
        logger.debug('PlatformApi#itemsForBib: Got ' + resp.data.length + ' items')
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
        return resp.data
      })
  })
}

const getSchema = (schemaName) => {
  return init().then((client) => {
    return client.get(`current-schemas/${schemaName}`, { authenticate: false })
  })
}

module.exports = {
  bibsForItems,
  bibsForHoldings,
  itemsForBib,
  holdingsForBib,
  getSchema,
  bibById,
  internal: {
    init
  }
}
