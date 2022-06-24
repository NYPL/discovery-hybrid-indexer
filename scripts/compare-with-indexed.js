/**
 *
 * Given an event file with a single record, generates the ES doc and then
 * fetches the same record from the remote index to perform a comparison.
 *
 * Usage:
 *   node scripts/compare-with-indexed --envfile [path to .env] ./test/sample-events/[eventfile]')
 * Or, to fetch by id:
 *   node scripts/compare-with-indexed --envfile [path to .env] --uri [bnum]
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

const NyplSourceMapper = require('discovery-store-models/lib/nypl-source-mapper')
const index = require('../index')
const { awsInit, die, suppressIndexAndStreamWrites } = require('../lib/script-utils')
const { printDiff } = require('../test/diff-report')
const platformApi = require('../lib/platform-api')
const discoveryApiIndexer = require('../lib/discovery-api-indexer')
const discoveryStoreModel = require('../lib/discovery-store-model')

const usage = () => {
  console.log('Usage: node scripts/compare-with-indexed --envfile [path to .env] [--uri bnum] ./test/sample-events/[eventfile]')
  return true
}

// Make simple lambda callback
const cb = (e, result) => {
  if (e) console.error('Error: ' + e)
  console.log('Success: ' + result)
}

// Ensure we're looking at the right profile and region
awsInit()

// Suppress writing to ES index and Kinesis streams
suppressIndexAndStreamWrites({
  // Capture attempt to write document to index so we can compare it with the
  // version actually in the index:
  onIndexWrite: (records) => {
    const newRecord = records[0]

    discoveryApiIndexer.currentDocument(records[0].uri).then((liveRecord) => {
      printDiff(liveRecord, newRecord)
    }).catch((e) => {
      console.log('Error: ', e)
    })
  }
})

// Insist on an eventfile or a uri:
if (argv._.length < 1 && !argv.uri) usage() && die('Must specify event file or uri')

const ev = argv._[0] ? JSON.parse(fs.readFileSync(argv._[0], 'utf8')) : null

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
          return discoveryStoreModel.filterOutAndDeleteNonResearchBibs([bib])
            .then(index.fullRebuildForBibs)
        })
      break
  }
}
