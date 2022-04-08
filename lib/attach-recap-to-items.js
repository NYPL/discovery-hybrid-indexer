const ScsbClient = require('pcdm-store-updater/lib/scsb-client')
const logger = require('./logger')
const { bNumberWithCheckDigit } = require('./utils')

const _isInRecap = (bib) => {
  return bib.items.some((item) => item.location && item.location.code && item.location.code.startsWith('rc'))
}

const _isNypl = (bib) => bib.nyplSource.includes('nypl')

const _createRecapCodeMap = async (bib) => {
  let recapCodeItemIdMap
  if (_isInRecap(bib) && _isNypl(bib)) {
    const client = await ScsbClient.instance()
    const __start = new Date()
    // Bib service returns bibId without check digit, but SCSB requires it, as well as .b prefix
    const scsbFriendlyBibId = '.b' + bNumberWithCheckDigit(bib.id)
    const updatedRecapBib = await client.search({ deleted: false, fieldValue: scsbFriendlyBibId, fieldName: 'OwningInstitutionBibId', owningInstitutions: ['NYPL'] })
    const elapsed = ((new Date()) - __start)
    logger.debug({ message: `HTC searchByParam API took ${elapsed}ms`, metric: 'searchByParam-owningInstitutionBibId', timeMs: elapsed })
    if (updatedRecapBib && updatedRecapBib.searchResultRows && updatedRecapBib.searchResultRows.length) {
      const results = updatedRecapBib.searchResultRows
      if (results && (results.length > 0) && results[0].searchItemResultRows && results[0].searchItemResultRows.length > 0) {
        recapCodeItemIdMap = results[0].searchItemResultRows.reduce((map, item) => {
          // SCSB items also have check digit and .i prefix, but in this case we can just remove them
          const nyplItemId = item.owningInstitutionItemId.slice(2, -1)
          return { ...map, [nyplItemId]: item.customerCode }
        }, {})
      } else {
        const nyplItemId = results[0].owningInstitutionItemId.slice(2, -1)
        recapCodeItemIdMap = { [nyplItemId]: results[0].customerCode }
      }
    }
  }
  return recapCodeItemIdMap
}

const attachRecapCustomerCodes = async (bib) => {
  const recapCodeItemIdMap = await _createRecapCodeMap(bib)
  if (recapCodeItemIdMap) {
    bib.items.forEach((item) => { item.recapCustomerCode = recapCodeItemIdMap[item.id] })
  }
  return bib
}

module.exports = { attachRecapCustomerCodes, private: { _createRecapCodeMap } }
