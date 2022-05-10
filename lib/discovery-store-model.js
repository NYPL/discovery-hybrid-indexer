const DiscoveryStoreBib = require('discovery-store-models/lib/models/bib')
const DiscoveryStoreItem = require('discovery-store-models/lib/models/item')
const DiscoveryStoreHolding = require('discovery-store-models/lib/models/holding')
const DiscoveryStoreBase = require('discovery-store-models/lib/models/base')
const nyplCoreLocations = require('@nypl/nypl-core-objects')('by-sierra-location')
const nyplCoreItemTypes = require('@nypl/nypl-core-objects')('by-catalog-item-type')

const BibsUpdater = require('pcdm-store-updater/lib/bibs-updater')
const ItemsUpdater = require('pcdm-store-updater/lib/items-updater')
const HoldingsUpdater = require('pcdm-store-updater/lib/holdings-updater')
const SierraBib = require('pcdm-store-updater/lib/models/bib-sierra-record')
const SierraItem = require('pcdm-store-updater/lib/models/item-sierra-record')
const SierraHolding = require('pcdm-store-updater/lib/models/holding-sierra-record')

const discoveryApiIndexer = require('./discovery-api-indexer')
const platformApi = require('./platform-api')
const logger = require('./logger')
const { attachRecapCustomerCodes } = require('./attach-recap-to-items')

function groupStatementsBySubjectId (statements) {
  return Object.values(
    statements
      .reduce((h, s) => {
        if (!h[s.subject_id]) h[s.subject_id] = []
        h[s.subject_id].push(s)
        return h
      }, {})
  )
}

function stringifyStatementLiterals (statements) {
  return statements.map((s) => {
    return Object.assign({}, s, {
      object_literal: ['number', 'boolean'].includes(typeof s.object_literal) ? String(s.object_literal) : s.object_literal
    })
  })
}

function nestBlankNodes (statements) {
  const grouped = groupStatementsBySubjectId(statements)

  // Blank node statements have subject_ids built via [parent subject id]#[number]
  // so they can be identified by '#'
  const groupIsBlankNode = (statementGroup) => statementGroup[0].subject_id.includes('#')

  // Identify statement groups that represent blanknodes:
  const blankNodeGroups = grouped.filter(groupIsBlankNode)
  // Identify the one set of statements that are not blank nodes; these are
  // our root record statements:
  const rootStatements = grouped
    .find((group) => !groupIsBlankNode(group))
    .map((statement) => {
      // If statement refers to a set of blanknode statement group identified
      // above, link it:
      if (statement.object_id && statement.object_id.startsWith(`${statement.subject_id}#`)) {
        const group = blankNodeGroups
          .find((group) => group[0].subject_id === statement.object_id)
        if (!group) {
          logger.error(`Bad blanknode: No statements found for ${statement.object_id}`, statement)
        } else {
          // Wrap this array of statements in a Base class
          statement.blanknode = new DiscoveryStoreBase(group)
        }
      }
      return statement
    })

  return rootStatements
}

// Given an array of statements, returns a discovery-store-models instance wrapping them
const discoveryStoreModelFromStatements = (statements, ModelKlass) => {
  // stringify literals (to approximate db data)
  statements = stringifyStatementLiterals(statements)
  // Identify and properly nest blanknodes
  statements = nestBlankNodes(statements)
  const wrappedStatements = new ModelKlass(statements)
  wrappedStatements.uri = statements[0].subject_id
  return wrappedStatements
}

const discoveryStoreBib = (bib) => {
  logger.debug('Extracting bib statements from ', bib.id)
  return (new BibsUpdater()).extractStatements(new SierraBib(bib))
    .then((bibStatements) => {
      // Identify electronic item statements extracted from bib record:
      const isElectronicStatement = (s) => /-e$/.test(s.subject_id)
      const electronicStatements = bibStatements
        .filter(isElectronicStatement)
      const groupedElectronicItemStatements = groupStatementsBySubjectId(electronicStatements)
      logger.debug('Got electronic items: ', groupedElectronicItemStatements.length ? JSON.stringify(groupedElectronicItemStatements, null, 2) : 'None')
      // Remove electronic statements from bib statements:
      bibStatements = bibStatements.filter((s) => !isElectronicStatement(s))

      logger.debug(`Extracting statements from ${bib.items.length} items`)
      return Promise.all([
        Promise.all(bib.items.map((item) => (new ItemsUpdater()).extractStatements(new SierraItem(item)))),
        Promise.all(bib.holdings.map((holding) => (new HoldingsUpdater()).extractStatements(new SierraHolding(holding))))
      ]).then((groupedChildrenStatements) => {
        let [groupedItemStatements, groupedHoldingStatements] = groupedChildrenStatements

        logger.debug(`Got ${groupedItemStatements.length} grouped item statements`)
        logger.debug(`Got ${groupedHoldingStatements.length} grouped holding statements`)

        const bib = discoveryStoreModelFromStatements(bibStatements, DiscoveryStoreBib)

        // Fold in electronic items:
        if (groupedElectronicItemStatements) {
          groupedItemStatements = groupedItemStatements.concat(groupedElectronicItemStatements)
        }

        // Add items
        bib._items = groupedItemStatements
          .map((itemStatements) => discoveryStoreModelFromStatements(itemStatements, DiscoveryStoreItem))

        // Add holdings
        bib._holdings = groupedHoldingStatements
          .map((holdingStatements) => discoveryStoreModelFromStatements(holdingStatements, DiscoveryStoreHolding))

        return bib
      })
    })
}

const attachItemsAndHoldingsToBib = (bib) => {
  return Promise.all([
    platformApi.itemsForBib(bib),
    platformApi.holdingsForBib(bib)
  ]).then((children) => {
    bib.items = children[0]
    bib.holdings = children[1]
    logger.debug(`Got ${bib.items ? bib.items.length : 0} items, ${bib.holdings ? bib.holdings.length : 0} holdings`)
    return bib
  }).catch((e) => {
    logger.error('Error attaching items and holdings to bib: ', e)
    throw e
  })
}

/**
 * Given an array of items, resolves a new array of items containing only
 * those items that *may* be Research based on Item Type
 */
const filterOutNonResearchItems = (items) => {
  const originalCount = items.length
  return Promise.all(
    items.map((item) => {
      // Partner items are Research
      if (item.nyplSource !== 'sierra-nypl') return Promise.resolve(item)

      // If item has a Branch Item Type, nullify it:
      const sierraItem = new SierraItem(item)
      const itype = sierraItem.fixed('Item Type')
      if (itype && nyplCoreItemTypes[itype]) {
        if (!(nyplCoreItemTypes[itype].collectionType || []).includes('Research')) {
          logger.debug(`#filterOutNonResearchItems: Skipping ${item.nyplSource}/${item.id} due to non-Research Item Type (${itype})`)
          return Promise.resolve(null)
        }
      }
      return Promise.resolve(item)
    })
  ).then((items) => {
    // Filter out null (non-research) items
    items = items.filter((item) => item)
    logger.info(`From original ${originalCount} item(s), removed ${originalCount - items.length} circulating, resulting in ${items.length} research item(s)`)
    return items
  })
}

/**
 * Given an array of bibs, resolves a new array of bibs containing only
 * those items that *may* be Research. (Just does a cursory check of the bib
 * itself without examing items.)
 */
const filterOutAndDeleteNonResearchBibs = async (bibs) => {
  const originalCount = bibs.length

  // Segment bibs into (possible) research bibs and (definitely) non-research bibs
  const researchOrCirc = bibs.reduce((researchOrCirc, bib) => {
    // Default to classifying bibs as research because they *may* be Research
    let isResearch = true

    // Partner bibs are Research
    if (bib.nyplSource !== 'sierra-nypl') isResearch = true

    // If bib has locations and all locations are classified as Branch,
    // remove bib:
    if (bib.locations && Array.isArray(bib.locations) && bib.locations.length > 0) {
      // If bib has 'os' or 'none' location it may be OTF, so pass it through
      // and let discovery-api-indexer handle suppressing it if needed
      if (bib.locations[0] && ['none', 'os'].includes(bib.locations[0].code)) isResearch = true

      // If bib has any locations with "Research" collection type, bib is research:
      const researchLocations = bib.locations
        .map((location) => nyplCoreLocations[location.code] || {})
        .filter((location) => (location.collectionTypes || []).includes('Research'))
      if (researchLocations.length > 0) isResearch = true
    }

    // Add bib to appropriate category:
    researchOrCirc[isResearch ? 'research' : 'circ'].push(bib)

    return researchOrCirc
  }, { research: [], circ: [] })

  if (originalCount) {
    logger.info(`From original ${originalCount} bib(s), removed ${researchOrCirc.circ.length} circulating, resulting in ${researchOrCirc.research.length} research bibs(s)`)

    // Issue DELETEs on circ bibs (just in case they snuck into the index when they weren't strictly identified as Research
    logger.debug(`Issuing DELETE on ${researchOrCirc.circ.length} bib(s): ${researchOrCirc.circ.map((b) => b.id).join(',')}`)
    await Promise.all(
      // [].map(discoveryApiIndexer.suppressBib)
      researchOrCirc.circ.map(discoveryApiIndexer.suppressBib)
    ).catch((e) => {
      logger.error(`Error deleting all/some of ${researchOrCirc.circ.length} bib(s): ${researchOrCirc.circ.map((b) => b.id).join(',')}`, e)
    })
  }

  return Promise.resolve(researchOrCirc.research)
}

/**
 *  Given an array of bibs (marcinjson JSON objects), returns a Promise that
 *  resolves an array of DiscoveryStoreBib instances, each wrapping all of the
 *  statements extracted from the original bib. Includes _items and _holdings
 *  properties holding arrays of DiscoveryStoreItem and DiscoveryStoreHolding
 *  instances. Essentially this translates an array of marcinjson bibs into the
 *  form they come out of the legacy discovery-store database.
 */
const buildDiscoveryStoreBibs = (bibs) => {
  // Fire this off to fetch holdings for all of these bibs - so that later
  // requests for those holdings can leverage those calls
  platformApi.prefetchHoldingsForBibs(bibs)

  return Promise.all(
    bibs.map((bib) => {
      return attachItemsAndHoldingsToBib(bib)
        .then(attachRecapCustomerCodes)
        .then(discoveryStoreBib)
    })
  )
}

module.exports = {
  buildDiscoveryStoreBibs,
  filterOutAndDeleteNonResearchBibs,
  filterOutNonResearchItems,
  internal: {
    discoveryStoreBib
  }
}
