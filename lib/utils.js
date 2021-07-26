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
    console.log('Grouping by: ', keys)
    keys.forEach((key) => {
      if (!h[key]) h[key] = []
      h[key].push(obj)
    })
    return h
  }, {})
}

module.exports = {
  groupObjectsByMultivalueProperty,
  arrayChunks
}
