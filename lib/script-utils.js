const aws = require('aws-sdk')
const discoveryApiIndex = require('discovery-api-indexer/lib/index')
const NyplStreamsClient = require('@nypl/nypl-streams-client')

const awsInit = (profile) => {
  // Set aws creds:
  aws.config.credentials = new aws.SharedIniFileCredentials({
    profile: profile || 'nypl-digital-dev'
  })

  // Set aws region:
  const awsSecurity = { region: 'us-east-1' }
  aws.config.update(awsSecurity)
}

const die = (message) => {
  console.log('Error: ' + message)
  process.exit()
}

const suppressIndexAndStreamWrites = (options = {}) => {
  // Overwrite several functions to prevent writing to index or streams:

  // Suppress writing to index. Instead, generate a report
  // analyzing differences between current and new ES document
  discoveryApiIndex.resources.save = (indexName, records, update) => {
    console.log('PROXY: index save: ', JSON.stringify(records, null, 2))

    if (options.onIndexWrite) options.onIndexWrite(records)
    return Promise.resolve()
  }
  discoveryApiIndex.resources.delete = (indexName, id) => {
    console.log('PROXY: index delete: ', indexName, id)
    return Promise.resolve()
  }
  NyplStreamsClient.prototype.write = (streamName, records, opts) => {
    console.log(`PROXY: write ${records.length} resources to ${streamName} stream`)
    return Promise.resolve({ Records: records })
  }
}

module.exports = {
  die,
  awsInit,
  suppressIndexAndStreamWrites
}
