const avro = require('avsc')

const logger = require('./logger')
const platformApi = require('./platform-api')

const CACHE = {}

function getSchema (schemaName) {
  // schema in cache; just return it as a instant promise
  if (CACHE[schemaName]) {
    logger.debug(`Already have ${schemaName} schema`)
    return Promise.resolve(CACHE[schemaName])
  }

  // Fetch schema and parse it as an AVSC decoder
  return platformApi.getSchema(schemaName).then((resp) => {
    CACHE[schemaName] = avro.parse(resp.data.schemaObject)
    return CACHE[schemaName]
  })
}

function decodeRecordsFromEvent (event) {
  let bibItemOrHolding = null

  // Determine whether event has Bibs or Items by checking end of eventSourceARN string:
  if (/\/Bib/.test(event.Records[0].eventSourceARN)) bibItemOrHolding = 'Bib'
  if (/\/Item/.test(event.Records[0].eventSourceARN)) bibItemOrHolding = 'Item'
  if (/\/Holding/.test(event.Records[0].eventSourceARN)) bibItemOrHolding = 'Holding'

  // Fail if the eventSourceARN didn't tell us what we're handling
  if (!bibItemOrHolding) throw new Error('Unrecognized eventSourceARN. Aborting. ' + event.Records[0].eventSourceARN)

  logger.debug('Using schema: ', bibItemOrHolding)
  // db.connect().then(() => getSchema(bibOrItem)).then((schemaType) => {
  return getSchema(bibItemOrHolding).then((schemaType) => {
    // Get array of decoded records:
    const decoded = event.Records.map((record) => {
      const kinesisData = Buffer.from(record.kinesis.data, 'base64')
      return schemaType.fromBuffer(kinesisData)
    })
    logger.debug('Processing ' + bibItemOrHolding + ' records: ', decoded)

    return { type: bibItemOrHolding, records: decoded }
  })
}

module.exports = { decodeRecordsFromEvent }
