const sinon = require('sinon')
const fs = require('fs')
const qs = require('qs')
const md5 = require('md5')

const NYPLDataApiClient = require('@nypl/nypl-data-api-client')

const usedFixturePaths = {}

/**
 * Use in `before/beforeEach` to associate platform api request paths with local fixtures
 */
function enableDataApiFixtures (pathToFixtureMap) {
  const originalCall = NYPLDataApiClient.prototype._doAuthenticatedRequest

  if (process.env.UPDATE_FIXTURES === 'all' || process.env.UPDATE_FIXTURES === 'if-missing') {
    console.log(`Rebuilding fixtures using '${process.env.NYPL_OAUTH_KEY}' platform user`)
  }
  // Override app's _doAuthenticatedRequest call to return fixtures for specific paths, otherwise fail:
  sinon.stub(NYPLDataApiClient.prototype, '_doAuthenticatedRequest').callsFake(function (requestOptions) {
    const originalRequestOptions = JSON.parse(JSON.stringify(requestOptions))
    return fixtureExists(requestOptions).then((exists) => {
      if (process.env.UPDATE_FIXTURES === 'all' || (process.env.UPDATE_FIXTURES === 'if-missing' && !exists)) {
        const client = new NYPLDataApiClient({ base_url: process.env.NYPL_API_BASE_URL, log_level: 'info' })
        return originalCall.bind(client)(requestOptions)
          // Now write the response to local fixture:
          .then((resp) => writeFixture(originalRequestOptions, resp))
          // And for good measure, let's immediately rely on the local fixture:
          .then(() => requestViaFixture(originalRequestOptions))
      } else {
        return requestViaFixture(requestOptions)
      }
    })
  })
}

function writeFixture (requestOptions, data) {
  fs.writeFileSync(fixturePath(requestOptions), JSON.stringify(data, null, 2))

  return Promise.resolve()
}

function fixtureExists (requestOptions) {
  const path = fixturePath(requestOptions)
  return new Promise((resolve, reject) => {
    fs.access(path, (err, fd) => {
      const exists = !err
      return resolve(exists)
    })
  })
}

function fixturePath (requestOptions) {
  return `./test/fixtures/platform-api-${md5(qs.stringify(requestOptions))}.json`
}

function requestViaFixture (requestOptions) {
  const path = fixturePath(requestOptions)
  usedFixturePaths[path] = true

  return new Promise((resolve, reject) => {
    fs.readFile(path, 'utf8', (err, content) => {
      if (err) {
        console.error(`Missing fixture (${path}) for `, JSON.stringify(requestOptions))
        return reject(err)
      }

      return resolve(JSON.parse(content))
    })
  })
}

/**
 * Use in `after/afterEach` to reverse the effect of `enableDataApiFixtures`
 */
function disableDataApiFixtures () {
  NYPLDataApiClient.prototype._doAuthenticatedRequest.restore()
}

after(function () {
  const used = Object.keys(usedFixturePaths).map((path) => path.split('/').pop())

  const existingPaths = fs.readdirSync('./test/fixtures/').filter((path) => {
    return /^(scsb-by-barcode-|query-)/.test(path)
  })
  const unused = existingPaths.filter((path) => !used.includes(path))
  if (unused.length > 0) {
    // If there are unused fixtures..
    // If REMOVE_UNUSED_FIXTURES=true is set, delete them:
    if (process.env.REMOVE_UNUSED_FIXTURES === 'true') {
      console.log(`The following fixtures were not used and will be removed:\n${unused.map((path) => `\n  ${path}`)}`)
      unused.forEach((p) => {
        fs.unlinkSync(`./test/fixtures/${p}`)
      })
    // Otherwise, just report on them:
    } else {
      console.log(`The following fixtures were not used:\n${unused.map((path) => `\n  ${path}`)}`)
    }
  }
})

module.exports = { enableDataApiFixtures, disableDataApiFixtures }
