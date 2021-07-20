const { diff, detailedDiff } = require('deep-object-diff')

function logObject (obj, indent = 2) {
  let s = JSON.stringify(
    obj,
    (k, v) => v === undefined ? null : v,
    2
  )
  s = s.split('\n')
    .map((line) => `${' '.repeat(indent)}${line}`)
    .join('\n')
  console.log(s)
}

function printDiff (orig, updated) {
  console.log(`Bib metadata diff for ${orig.uri}:`)
  const noChildren = (bib) => Object.assign({}, bib, { items: null, holdings: null, uris: null, updatedAt: null })
  if (Object.keys(diff(noChildren(orig), noChildren(updated))).length > 0) {
    const metaDiff = detailedDiff(noChildren(orig), noChildren(updated))
    logObject(metaDiff)
  } else {
    console.log('  No diff')
  }

  ; ['items', 'holdings'].forEach((prop) => {
    console.log(`${prop[0].toUpperCase() + prop.substring(1)} diff:`)

    if (orig[prop] || updated[prop]) {
      if (!orig[prop]) console.log(`  No ${prop} in orig (${updated[prop].length} ${prop} in updated doc)`)
      else if (!updated[prop]) console.log(`  No ${prop} in updated doc (${orig[prop].length} ${prop} in orig doc)`)
      else if (orig[prop].length !== updated[prop].length) {
        console.log(`  Orig ${prop}: ${orig[prop].length}, new ${prop} length: ${updated[prop].length}`)
      } else {
        console.log(`  Both documents have ${orig[prop].length} ${prop}`)
      }

      if (orig[prop] && updated[prop]) {
        orig[prop].forEach((origItem) => {
          if (!updated[prop]) {
            console.log(`  Can not find ${prop} in updated doc`)
            return
          }
          const updatedItem = updated[prop].find((i) => i.uri === origItem.uri)
          if (!updatedItem) console.log(`  Can not find ${origItem.uri} in ${prop} in updated doc`)
          else {
            if (Object.keys(diff(origItem, updatedItem)).length > 0) {
              const itemDiff = detailedDiff(origItem, updatedItem)
              console.log(`  Diff in ${prop} ${origItem.uri}:`)
              logObject(itemDiff, 4)
            }
          }
        })
      }
    }
  })

  // console.log("Difference between live and new record:")
  // console.log(JSON.stringify(diff(liveRecord, newRecord), null, 2))
  // console.log("Deletions:")
  // console.log(JSON.stringify(deletedDiff(liveRecord, newRecord), null, 2))

  // console.log(JSON.stringify(addedDiff(liveRecord, records[0]), null, 2))
  // console.log(JSON.stringify(detailedDiff(liveRecord, records[0]), null, 2))
}

module.exports = {
  printDiff
}
