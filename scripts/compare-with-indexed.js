/**
 *
 * Given an event file with a single record, generates the ES doc and then
 * fetches the same record from the remote index to perform a comparison.
 *
 * Usage:
 *   node scripts/compare-with-indexed --envfile [path to .env] ./test/sample-events/[eventfile]')
 *
 * e.g. To compare how this app generates an ES doc for b10578183 with the QA ES index:
 *   node scripts/compare-with-indexed.js --envfile config/qa.env test/sample-events/b10578183.json
 *
 * If event file contains multiple records, only the first is compared by default. Indicate which via:
 *   --record N (default 0)
 */

const argv = require('minimist')(process.argv.slice(2))
const dotenv = require('dotenv')
dotenv.config({ path: argv.envfile || './config/qa.env' })

const fs = require('fs')
const discoveryApiIndex = require('discovery-api-indexer/lib/index')
const NyplStreamsClient = require('@nypl/nypl-streams-client')

const NyplSourceMapper = require('discovery-store-models/lib/nypl-source-mapper')
const index = require('../index')
const discoveryApiIndexer = require('../lib/discovery-api-indexer')
const { awsInit, die } = require('../lib/script-utils')
const { printDiff } = require('../test/diff-report')
const platformApi = require('../lib/platform-api')

// Overwrite several functions to prevent writing to index or streams:

// Suppress writing to index. Instead, generate a report
// analyzing differences between current and new ES document
discoveryApiIndex.resources.save = (indexName, records, update) => {
  console.log('PROXY: index save: ', JSON.stringify(records, null, 2))

  const ind = Math.min(records.length - 1, argv.record || 0)
  return discoveryApiIndexer.currentDocument(records[ind].uri).then((liveRecord) => {
    const newRecord = records[ind]
    printDiff(liveRecord, newRecord)
  })
}
discoveryApiIndex.resources.delete = (indexName, id) => {
  console.log('PROXY: index delete: ', indexName, id)
  return Promise.resolve()
}
NyplStreamsClient.prototype.write = (streamName, records, opts) => {
  console.log(`PROXY: write ${records.length} resources to ${streamName} stream`)
  return Promise.resolve({ Records: records })
}

const usage = () => {
  console.log('Usage: node scripts/compare-with-indexed --envfile [path to .env] [--uri bnum] ./test/sample-events/[eventfile]')
  return true
}

// Insist on an eventfile:
if (argv._.length < 1 && !argv.uri) usage() && die('Must specify event file or uri')

const ev = argv._[0] ? JSON.parse(fs.readFileSync(argv._[0], 'utf8')) : null

// Make simple lambda callback
const cb = (e, result) => {
  if (e) console.error('Error: ' + e)
  console.log('Success: ' + result)
}

// Ensure we're looking at the right profile and region
awsInit()

if (ev) {
  // Invoke the lambda handler on the event
  index.handler(ev, {}, cb)
    .then((result) => {
      console.log('All done')
    })
    .catch((e) => {
      console.log(e)
      console.error('Error: ', JSON.stringify(e, null, 2))
    })
} else if (argv.uri) {
  const { id, type, nyplSource } = NyplSourceMapper.instance().splitIdentifier(argv.uri)
  switch (type) {
    case 'bib':
      platformApi.bibById(nyplSource, id)
        .then((bib) => {
          index.fullRebuildForBibs([bib])
        })
      break
  }
}
