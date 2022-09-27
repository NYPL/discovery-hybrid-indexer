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
const { uriForRecordIdentifier } = require('./utils')
const { parseDatesAndCache } = require('pcdm-store-updater/lib/date-parse')

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

/**
 *  Given a list of statements, returns a modified list of statements that
 *  nests blanknode statements inside the appropriate statements
 */
function nestBlankNodes (statements) {
  // Blank node statements have subject_ids built via [parent subject id]#[number]
  // so they can be identified by '#'
  const isBlanknodeStatement = (stmt) => stmt.subject_id.includes('#')

  const blankNodeStatements = statements.filter(isBlanknodeStatement)
  // Identify statement groups that represent blanknodes:
  const blankNodeGroups = groupStatementsBySubjectId(blankNodeStatements)

  // Build statements to return as the set of statements that
  //   1) are not blanknodes and
  //   2) have blanknode statements nested property inside them
  const finalStatements = statements
    .filter((stmt) => !isBlanknodeStatement(stmt))
    .map((statement) => {
      // If statement appears to refer to a blanknode group..
      if (statement.object_id && statement.object_id.startsWith(`${statement.subject_id}#`)) {
        // Find the blanknode group:
        const blankNodeGroup = blankNodeGroups
          .find((group) => group[0].subject_id === statement.object_id)
        if (!blankNodeGroup) {
          logger.error(`Bad blanknode: No statements found for ${statement.object_id}`, statement)
        } else {
          // Wrap this array of statements in a Base class
          statement.blanknode = new DiscoveryStoreBase(blankNodeGroup)
        }
      }
      return statement
    })

  return finalStatements
}

// Given an array of statements, returns a discovery-store-models instance wrapping them
const discoveryStoreModelFromStatements = (statements, ModelKlass) => {
  const wrappedStatements = new ModelKlass(statements)
  wrappedStatements.uri = statements[0].subject_id
  return wrappedStatements
}

/**
 *  @typedef {object} RDFStatement
 *  @property {string} subject_id - ID of the subject (e.g. "b1234")
 *  @property {string} predicate - What is being said about the subject? (e.g. "dcterms:title", "bf:status")
 *  @property {integer} source_id - NYPL identifier for datastore. e.g. source:10004 is Sierra, source:10005 is Recap)
 *  @property {string} source_record_id - External local idenfier for record. e.g. bnum 10721826
 *  @property {integer} creator_id - Identifies the process that derived the data. (Presently we only have the Core Serializer)
 *  @property {integer} index - The numeric ranking of the statement among other statements with the same subject_id and predicate
 *  @property {string} source_record_path - Indicates where in the record the data was found. e.g. "260 $b", "008/35-37", "300 $a $b", "LDR/07", "fixed 'Material Type'"
 *  @property {string} object_literal - The object value of a statements that have a long string or other scalar value that is not a strong identifier.
 *  @property {string} object_id - The object identifier of a statement that is a strong identifier.
 *  @property {string} object_label - A place to store a denormalized label for the object (typically for a statement with an identifier stored in object_id)
 *  @property {string} object_type - The @type of the object
 *
 *  See also https://github.com/NYPL-discovery/discovery-store-poster/blob/master/data-model.md
 *
 *  @typedef {object} DiscoveryStoreBib
 *  @property {RDFStatement[]} _statements
 *  @property {string} uri - The prefixed id of the entity (e.g. "b1234", "h9876")
 */

/**
 *  Given a plain bib object, returns a DiscoveryStoreBib instance
 *
 *  @param {object} bib - The json object representing the bib (such as comes out of the BibService)
 *
 *  @return {DiscoveryStoreBib}
 */
const discoveryStoreBib = (bib) => {
  logger.debug('Extracting bib statements from ', bib.id)

  const bibUri = uriForRecordIdentifier(bib.nyplSource, bib.id, 'bib')
  const isBib = (group) => group.some((stmt) => stmt.subject_id === bibUri)

  // Set up some methods to match groups of statements and classify them as bib, item, or holding:
  const makeStatementGroupIdentifier = (types) => {
    return (group) => group.some((stmt) => stmt.predicate === 'rdfs:type' && types.includes(stmt.object_id))
  }
  const isItem = makeStatementGroupIdentifier(['bf:Item', 'nypl:CheckinCardItem'])
  const isHolding = makeStatementGroupIdentifier(['nypl:Holding'])

  // Set up an array of Promises that resolve arrays of statements for the bib
  // and all of its items and holdings:
  const sierraBib = new SierraBib(bib)
  const statementExtractors = [
    (new BibsUpdater()).extractStatements(sierraBib)
  ]
    .concat(bib.items.map((item) => (new ItemsUpdater()).extractStatements(new SierraItem(item), sierraBib)))
    .concat(bib.holdings.map((holding) => (new HoldingsUpdater()).extractStatements(new SierraHolding(holding))))

  return Promise.all(statementExtractors)
    .then((statements) => {
      // Flatten statements because they currently resemble:
      //   [ bibStatment1, bibstatment2,
      //     electronicItem1Statement1, electronicItem1Statement1, ...
      //     [ item1Statement1, item1Statement2, ... ],
      //     [ item2Statement1, item1Statement2, ... ],
      //     [ holding1Statement1, holding1Statement2, ... ],
      //     [ holding2Statement1, ... ],
      //     ...
      //   ]`:
      statements = statements.flat()
      // Convert non-string literals to strings (to emulate retrieval from db)
      statements = stringifyStatementLiterals(statements)
      // Nest blanknodes into relevant statements:
      statements = nestBlankNodes(statements)
      // Group by subject_id:
      const groups = groupStatementsBySubjectId(statements)

      // Instantiate a DiscoveryStoreBib instance wrapping the set of bib statements:
      const bib = discoveryStoreModelFromStatements(groups.find(isBib), DiscoveryStoreBib)
      // Identify groups of item statements and wrap them as DiscoveryStoreItem instances:
      bib._items = groups
        .filter(isItem)
        .map((group) => discoveryStoreModelFromStatements(group, DiscoveryStoreItem))
      // Identify groups of holding statements and wrap them as DiscoveryStoreHolding instances:
      bib._holdings = groups
        .filter(isHolding)
        .map((group) => discoveryStoreModelFromStatements(group, DiscoveryStoreHolding))

      return bib
    })
}

/**
 *  Given a plain bib object, resolves the same object with `items` and
 *  `holdings` properties containing plain item and holdings objects
 */
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

    // Gather location codes on the bib:
    const locationCodes = bib.locations && Array.isArray(bib.locations)
      ? bib.locations.map((location) => location.code)
      : []

    // If bib has location code 'os' or 'none', pass it through
    // and let discovery-api-indexer handle suppressing it if needed
    if (locationCodes.includes('none') || locationCodes.includes('os')) isResearch = true
    else {
      // Determine locations that are exclusively 'Branch'
      const branchLocations = locationCodes
        .map((code) => nyplCoreLocations[code] || {})
        .filter((location) => {
          return Array.isArray(location.collectionTypes) &&
            location.collectionTypes.length === 1 &&
            location.collectionTypes[0] === 'Branch'
        })
      // If bib has any locations with just "Branch" collection type, bib is not research:
      if (branchLocations.length > 0) {
        isResearch = false
        logger.debug(`#filterOutAndDeleteNonResearchBibs: Bib has branch locations: ${branchLocations.join(', ')}`)
      }
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
const buildDiscoveryStoreBibs = async (bibs) => {
  // Fire this off to fetch holdings for all of these bibs - so that later
  // requests for those holdings can leverage those calls
  platformApi.prefetchHoldingsForBibs(bibs)

  const bibsPlusItemsAndRecapCodes = await Promise.all(
    bibs.map((bib) => {
      return attachItemsAndHoldingsToBib(bib)
        .then(attachRecapCustomerCodes)
    })
  )
  await parseDatesAndCache(bibsPlusItemsAndRecapCodes)

  return Promise.all(bibsPlusItemsAndRecapCodes.map((bib) => {
    return discoveryStoreBib(bib)
  }))
}

module.exports = {
  buildDiscoveryStoreBibs,
  filterOutAndDeleteNonResearchBibs,
  filterOutNonResearchItems,
  internal: {
    discoveryStoreBib,
    attachItemsAndHoldingsToBib
  }
}
