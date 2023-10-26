const platformApi = require('./platform-api')

/**
 * Given a location code, returns true if the location is in M2
 *
 * Should match:
 *   mal92, mal98, mal99, mag92, maf92, maf98, maf99, mas92, map92, map98
 *
 * Ideally this would be data-driven rather than hard coded, but at writing,
 * NYPL-Core does not associate M2 customer codes with Sierra holding locations
 * (only delivery locations)
*/
const isM2Location = (location) => /^(mal9|mag9|maf9|mas9|map9)/.test(location)

const attachM2CustomerCodes = async (bib) => {
  // Get barcodes from M2 items:
  const barcodes = bib.items
    .filter((item) => item.barcode)
    .filter((item) => item.location && isM2Location(item.location.code))
    .map((item) => item.barcode)

  // Get map relating barcodes to M2 customer codes:
  const barcodeToM2CustomerCode = await platformApi.m2CustomerCodesForBarcodes(barcodes)

  // Attach .m2CustomerCode to items:
  bib.items = bib.items.map((item) => {
    if (barcodeToM2CustomerCode[item.barcode]) {
      item.m2CustomerCode = barcodeToM2CustomerCode[item.barcode]
    }
    return item
  })

  return bib
}

module.exports = {
  attachM2CustomerCodes
}
