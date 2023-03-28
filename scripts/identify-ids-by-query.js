/**
 *
 * Given a ES query, identfies matching records and writes them to a local csv
 *
 * Options:
 *  --query QUERY - Provide ES query as a quoted JSON blob
 *  --queryfile FILE - Provide a file path to a json file with the query.
 *  --outfile FILE - Specify where to write the CSV (default ./out.csv)
 *  --from N - Specify index to start collecting from. Default 0
 *  --size M - Specify records per page. Default 100
 *  --stripprefix (true|false) - Specify whether or not to strip prefix from
 *                identifier before writing to CSV (e.g. hb12345 > 12345).
 *                Default false
 *  --envfile - Specify config file to use. Default ./config/qa.env
 *
 * Note that only one of --query and --queryfile should be used.
 *
 * Note that when using with `--stripprefix true`, because the output will not
 * include nyplSource, queries should ideally restrict their scope to one
 * nyplSource value (see example usage below):
 *
 * Usage:
 *   node scripts/identify-ids-by-query --envfile [path to .env] [--outfile out.csv] --query '{"query": {
 *      "bool": {
 *          "must": [
 *              {
 *                  "regexp": {
 *                      "idIsbn": ".*[^0-9x].*"
 *                  }
 *              },
 *              {
 *                  "term": {
 *                      "nyplSource": "sierra-nypl"
 *                  }
 *              }
 *          ]
 *      }
 *  }}'
 *
 */

const argv = require('minimist')(process.argv.slice(2), {
  default: {
    outfile: './out.csv',
    stripprefix: false,
    from: 0,
    size: 100
  },
  boolean: ['stripprefix']
})

const dotenv = require('dotenv')
dotenv.config({ path: argv.envfile || './config/qa.env' })

const fs = require('fs')

const { awsInit, die } = require('../lib/script-utils')
const discoveryApiIndexer = require('../lib/discovery-api-indexer')

const usage = () => {
  console.log('Usage: node scripts/reindex-by-query --envfile [path to .env] --query QUERY')
  return true
}

// Ensure we're looking at the right profile and region
awsInit()

// Require a --query
if (!argv.query && !argv.queryfile) usage() && die('Must specify --query')

/**
 * Recursive step. Given a raw search result, calls `scroll` until all records
 * consumed.
 *
 * @returns {Promise<String[]>} Promise that resolves an array of matching ids.
 */
function parseResultAndScroll (result, records = []) {
  let ids = result.hits.hits.map((h) => h._id)
  if (argv.stripprefix) ids = ids.map((id) => id.replace(/^[a-z]+/, ''))
  records = records.concat(ids)

  if (argv.limit && records.length >= argv.limit) {
    console.log(`Reached ${argv.limit} limit; Stopping`)
    records = records.slice(0, argv.limit)
    return records
  }

  if (records.length < result.hits.total) {
    const page = Math.ceil(records.length / argv.size)
    const pages = Math.ceil(result.hits.total / argv.size)

    // Periodically report on progress and save records:
    if (records.length % 1000 === 0) {
      // Report on progress:
      const ellapsedMs = (new Date()) - startTime
      const recordsPerSecond = (records.length / ellapsedMs) * 1000
      const eta = (totalHits - records.length) / recordsPerSecond
      const etaDisplay = eta > 60 ? `${Math.round(eta / 60)}mins` : `${Math.round(eta)}s`
      const completePercent = Math.floor((records.length / totalHits) * 100)
      console.log(`[${completePercent}% complete. ETA: ${etaDisplay}]`)

      // Every so often, write to file:
      writeFile(records)
    }

    return discoveryApiIndexer.queryIndexScroll({ scrollId: result._scroll_id, scroll: '30s' })
      .then((result) => parseResultAndScroll(result, records))
  } else {
    return records
  }
}

const writeFile = (records) => {
  const outpath = argv.outfile
  console.log(`Got ${records.length} results. Writing to ${outpath}`)

  fs.writeFileSync(outpath, records.join('\n'))
}

let startTime = null
let totalHits = null

/**
 * Given an ES query, performs query, returning ids
 *
 * @returns {Promise<String[]>} Promise that resolves an array of matching ids.
 */
function fetch (body, records = []) {
  console.log('Query Index: ', JSON.stringify(body, null, 2))
  if (argv.limit) console.log(`Applying limit of ${argv.limit}`)

  return discoveryApiIndexer.queryIndex(body, { scroll: '30s' })
    .then((resp) => {
      if (resp.hits) {
        totalHits = resp.hits.total
        console.log(`Identified ${totalHits} hits. `)
        startTime = new Date()
      }
      return resp
    })
    .then(parseResultAndScroll)
}

if (argv.query || argv.queryfile) {
  let query
  try {
    query = argv.query ? JSON.parse(argv.query) : JSON.parse(fs.readFileSync(argv.queryfile, 'utf8'))
  } catch (e) {
    if (argv.queryfile) {
      try {
        fs.statSync(argv.queryfile)
      } catch(e) {
        die(`Could not find ${argv.queryfile}`)
      }
    }
    die('Error parsing query: ', e)
  }
  // If "query" property used in root, remove it
  if (query.query) query = query.query

  const body = {
    _source: ['uri'],
    from: argv.from,
    size: argv.size,
    query
  }

  fetch(body)
    .then(writeFile)
}
