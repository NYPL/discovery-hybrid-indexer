/**
 *
 * Given a ES query, identfies matching records and writes them to a local csv
 *
 * Options:
 *  --query QUERY - Provide ES query as a quoted JSON blob
 *  --outfile FILE - Specify where to write the CSV (default ./out.csv)
 *  --from N - Specify index to start collecting from. Default 0
 *  --size M - Specify records per page. Default 100
 *  --stripprefix (true|false) - Specify whether or not to strip prefix from
 *                identifier before writing to CSV (e.g. hb12345 > 12345).
 *                Default false
 *  --envfile - Specify config file to use. Default ./config/qa.env
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
if (!argv.query) usage() && die('Must specify --query')

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
    console.log(`Scrolling: ${page} of ${pages}`)

    if (records.length % 1000 === 0) {
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

/**
 * Given an ES query, performs query, returning ids
 *
 * @returns {Promise<String[]>} Promise that resolves an array of matching ids.
 */
function fetch (body, records = []) {
  console.log('Query Index: ', JSON.stringify(body, null, 2))
  if (argv.limit) console.log(`Applying limit of ${argv.limit}`)

  return discoveryApiIndexer.queryIndex(body, { scroll: '30s' })
    .then(parseResultAndScroll)
}

if (argv.query) {
  let query
  try {
    query = JSON.parse(argv.query)
  } catch (e) {
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
