const ScsbClient = require('pcdm-store-updater/lib/scsb-client')
const kmsHelper = require('./kms-helper')
const logger = require('./lib/logger')

const _isInRecap = (bib) => bib.items.some((item) => item.location && item.location.code && item.location.code.startsWith('rc'))

const _isNypl = (bib) => bib.nyplSource.includes('nypl')

const _createRecapCodeMap = async (bib) => {
  let recapCodeItemIdMap
  if (_isInRecap(bib) && _isNypl(bib)) {
    const client = await ScsbClient.instance()
    const __start = new Date()
    const updatedRecapBib = await client.search({ deleted: false, fieldValue: '.b' + bib.id, fieldName: 'OwningInstitutionBibId', owningInstitutions: ['NYPL'] })
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
  const recapCodeItemIdMap = _createRecapCodeMap(bib)
  bib.items.forEach((item) => { item.recapCustomerCode = recapCodeItemIdMap[item.id] })
  return bib
}

module.exports = { attachRecapCustomerCodes, private: { _createRecapCodeMap } }
