const ScsbClient = require('@nypl/scsb-rest-client')
const kmsHelper = require('./kms-helper')
const logger = require('./lib/logger')

const isInRecap = (bib) => bib.items.some((item) => item.location && item.location.code && item.location.code.startsWith('rc'))

const isNypl = (bib) => bib.nyplSource.includes('nypl')

const createRecapCodeMap = async (bib) => {
  const url = await kmsHelper.decrypt(process.env.SCSB_URL)
  const apiKey = await kmsHelper.decrypt(process.env.SCSB_API_KEY)
  const client = new ScsbClient({ url, apiKey })
  let recapCodeItemIdMap
  if (isInRecap(bib) && isNypl(bib)) {
    const __start = new Date()
    const updatedRecapBib = await client.search({ deleted: false, fieldValue: '.' + bib.id, fieldName: 'OwningInstitutionBibId', owningInstitutions: ['NYPL'] })
    const elapsed = ((new Date()) - __start)
    logger.debug({ message: `HTC searchByParam API took ${elapsed}ms`, metric: 'searchByParam-owningInstitutionBibId', timeMs: elapsed })
    if (updatedRecapBib && updatedRecapBib.searchResultRows && updatedRecapBib.searchResultRows.length) {
      const results = updatedRecapBib.searchResultRows
      if (results && (results.length > 0) && results[0].searchItemResultRows && results[0].searchItemResultRows.length > 0) {
        logger.debug(`${bib.id.value} is a serial item`)
        recapCodeItemIdMap = results[0].searchItemResultRows.reduce((map, item) => {
          return { ...map, [item.itemId]: item.customerCode }
        }, {})
      } else {
        logger.debug(`${bib.id.value} is a not a serial item`)
        const item = results[0]
        recapCodeItemIdMap = { [item.itemId]: item.customerCode }
      }
    }
  }
  return recapCodeItemIdMap
}

const attachRecapCustomerCodes = (bib) => {
  const recapCodeItemIdMap = createRecapCodeMap(bib)
  bib.items.forEach((item) => { item.recapCustomerCode = recapCodeItemIdMap[item.id] })
  return bib
}

module.exports = attachRecapCustomerCodes
