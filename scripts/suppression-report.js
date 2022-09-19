/**
 *  Given a bnum, looks up the bib and items and prints a report explaining
 *  whether or not the bib and items should be suppressed from the DiscoveryApi
 *  index and why.
 *
 *  node scripts/suppression-report --uri [bnum]
 */

const argv = require('minimist')(process.argv.slice(2))
const dotenv = require('dotenv')
dotenv.config({ path: argv.envfile || './config/qa.env' })

const NyplSourceMapper = require('discovery-store-models/lib/nypl-source-mapper')
const { awsInit, suppressIndexAndStreamWrites } = require('../lib/script-utils')
const platformApi = require('../lib/platform-api')
const discoveryStoreModel = require('../lib/discovery-store-model')

const logger = require('../lib/logger')
logger.setLevel(process.env.LOGLEVEL || 'info')

const usage = () => {
  console.log('Usage: node scripts/suppression-report --envfile [path to .env] --uri [bnum]')
  return true
}

const suppressionReport = (bib) => {
  const printRationale = function (what, result, rationale) {
    console.log(`${result ? '✅' : '❌'} ${what} is-research`)
    console.log('   Rationale:')
    Object.keys(rationale).forEach((key) => {
      console.log(`   ${rationale[key].result ? '✅' : '❌'} ${key}`)
      console.log(`        ${rationale[key].notes}`)
    })
  }

  const deletedDate = bib.deletedDate
  return discoveryStoreModel.buildDiscoveryStoreBibs([bib])
    .then((discoveryStoreBibs) => {
      discoveryStoreBibs.forEach((bib) => {
        const researchItemsCount = bib.items().filter((item) => item.isResearch()).length
        const nonElectronicItemsCount = bib.items().filter((item) => !item.isElectronic()).length

        const rationale = {
          'Is partner item': {
            notes: bib.uri,
            result: bib.isPartner()
          },
          'Has zero items': {
            notes: `Has ${bib.items().length} items`,
            result: bib.items().length === 0
          },
          'Has Research locations (and no electronic items)': {
            notes: [
              `Has ${nonElectronicItemsCount} non-electronic items, `,
              'and the following research locations: ',
              bib.researchLocations().map((l) => `${l.code} (${l.label})`).join(',')
            ].join(''),
            result: nonElectronicItemsCount === 0 && bib.researchLocations().length > 0
          },
          'Has Research items': {
            notes: `Has ${researchItemsCount} items`,
            result: researchItemsCount > 0
          },
          'Is not deleted': {
            notes: `Deleted ${deletedDate}`,
            result: !deletedDate
          }
        }
        printRationale(`Bib ${bib.uri}`, !deletedDate && bib.isResearch(), rationale)

        const catalogItemTypeMapping = require('@nypl/nypl-core-objects')('by-catalog-item-type')
        bib.items().forEach((item) => {
          const itype = (item.objectId('nypl:catalogItemType') || '').replace(/\w+:/, '')
          const rationale = {
            'Not suppressed': {
              result: item.literal('nypl:suppressed') === 'false',
              notes: item.literal('nypl:suppressed') === 'false' ? `Suppressed due to ${item.statement('nypl:suppressed') ? item.statement('nypl:suppressed').source_record_path : '?'}` : 'Not suppressed'
            },
            'Item Type is Research': {
              notes: `Item Type is ${itype}`,
              result: itype && catalogItemTypeMapping[itype] &&
                catalogItemTypeMapping[itype].collectionType.indexOf('Research') >= 0
            },
            'Is partner item': {
              result: item.isPartner(),
              notes: item.uri
            }
          }
          printRationale(`Item ${item.uri}`, !!item.isResearch(), rationale)
        })
      })
      return discoveryStoreBibs
    })
}

awsInit()
suppressIndexAndStreamWrites()

if (argv.uri) {
  const { id, type, nyplSource } = NyplSourceMapper.instance().splitIdentifier(argv.uri)
  switch (type) {
    case 'bib':
      platformApi.bibById(nyplSource, id)
        .then((bib) => {
          suppressionReport(bib)
        })
      break
  }
} else usage()
