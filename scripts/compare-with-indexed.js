const argv = require('minimist')(process.argv.slice(2))
const dotenv = require('dotenv')
dotenv.config({ path: argv.envfile || './config/qa.env' })

const fs = require('fs')
const discoveryApiIndex = require('discovery-api-indexer/lib/index')

const index = require('../index')
const discoveryApiIndexer = require('../lib/discovery-api-indexer')
const { awsInit, die } = require('../lib/script-utils')
const { printDiff } = require('../test/diff-report')

// Suppress writing to index. Instead, generate a report
// analyzing differences between current and new ES document
discoveryApiIndex.resources.save = (indexName, records, update) => {
  console.log('PROXY: index save: ', JSON.stringify(records, null, 2))

  return discoveryApiIndexer.currentDocument(records[0].uri).then((liveRecord) => {
    const newRecord = records[0]
    printDiff(liveRecord, newRecord)
  })
}

const usage = () => {
  console.log('Usage: node scripts/compare-with-indexed --envfile [path to .env] ./test/sample-events/[eventfile]')
  return true
}

// Insist on an eventfile:
if (argv._.length < 1) usage() && die('Must specify event file')

const ev = JSON.parse(fs.readFileSync(argv._[0], 'utf8'))

// Make simple lambda callback
const cb = (e, result) => {
  if (e) console.error('Error: ' + e)
  console.log('Success: ' + result)
}

// Ensure we're looking at the right profile and region
awsInit()

// Invoke the lambda handler on the event
index.handler(ev, {}, cb)
  .then((result) => {
    console.log('All done')
  })
  .catch((e) => {
    console.log(e)
    console.error('Error: ', JSON.stringify(e, null, 2))
  })
