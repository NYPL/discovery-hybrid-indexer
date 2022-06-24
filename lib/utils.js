const NyplSourceMapper = require('discovery-store-models/lib/nypl-source-mapper')

/**
 * Given an array, returns an array of arrays consisting of original elements
 * of array in groups of chunkSize or fewer
 */
const arrayChunks = (arr, chunkSize) => {
  if (!Number.isInteger(chunkSize)) throw new Error('Chunk size must be an integer.')
  if (chunkSize < 1) throw new Error('Chunk size must be greater than 0.')

  const groups = []
  let i = 0
  while (i < arr.length) {
    groups.push(arr.slice(i, i += chunkSize))
  }
  return groups
}

/**
 *  Given an array of objects, returns a hash where keys are defined by the
 *  distinct set of values for named property in array of objects and values
 *  are arrays of objects having that value
 */
const groupObjectsByMultivalueProperty = (objects, prop) => {
  if (!prop) throw new Error('groupObjectsByMultivalueProperty: Must specify prop to group by')

  return objects.reduce((h, obj) => {
    const keys = Array.isArray(obj[prop]) ? obj[prop] : [obj[prop]]
    keys.forEach((key) => {
      if (!h[key]) h[key] = []
      h[key].push(obj)
    })
    return h
  }, {})
}

const bNumberWithCheckDigit = (bnumber) => {
  const ogBnumber = bnumber
  const results = []
  let multiplier = 2
  for (const digit of bnumber.split('').reverse().join('')) {
    results.push(parseInt(digit) * multiplier++)
  }

  const remainder = results.reduce(function (a, b) { return a + b }, 0) % 11

  // OMG THIS IS WRONG! Sierra doesn't do mod11 riggghhttttt
  // remainder = 11 - remainder

  if (remainder === 11) return `${ogBnumber}0`
  if (remainder === 10) return `${ogBnumber}x`

  return `${ogBnumber}${remainder}`
}

/**
 * Get "uri" form of bib/item identifier
 *
 * e.g.
 *  - uriForRecordIdentifier('sierra-nypl', '1234')
 *    => 'i1234'
 *  - uriForRecordIdentifier('recap-cul', '9876')
 *    => 'ci9876'
 *  - uriForRecordIdentifier('sierra-nypl', '1234', 'bib')
 *    => 'b1234'
 *  - uriForRecordIdentifier('recap-cul', '9876', 'bib')
 *    => 'cb9876'
 */
const uriForRecordIdentifier = (nyplSource, id, type = 'item') => {
  if (!NyplSourceMapper.instance().nyplSourceMapping[nyplSource]) return null

  return NyplSourceMapper.instance().nyplSourceMapping[nyplSource][`${type}Prefix`] + id
}

module.exports = {
  groupObjectsByMultivalueProperty,
  arrayChunks,
  bNumberWithCheckDigit,
  uriForRecordIdentifier
}
