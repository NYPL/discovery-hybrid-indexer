const sinon = require('sinon')
const AWS = require('aws-sdk')

// const HoldingsUpdater = require('pcdm-store-updater/lib/holdings-updater')

const discoveryStoreModel = require('../lib/discovery-store-model')
const platformApi = require('../lib/platform-api')
const ScsbClient = require('../lib/scsb-client')
const { awsLambdaStub } = require('./utils')

const { enableDataApiFixtures, disableDataApiFixtures } = require('./fixtures')

/**
 *  Given an array of objects and a `toMatch` object to partially match,
 *  throws an error if one of the objects doesn't match `toMatch`
 */
const expectStatementIn = (objects, toMatch) => {
  const found = objects.some((object) => {
    return expectStatement(object._statements, toMatch, false)
  })

  if (!found) {
    throw new Error(`Expected statement matching ${JSON.stringify(toMatch)} in ${JSON.stringify(objects)}`)
  }
}

/**
 *  Given an array of {RDFStatement}s and a `toMatch` object to partially
 *  match, checks for a match among the statements. If a matching statement
 *  is found, returns true. Otherwise, either raises an Error if
 *  `raiseError` is true or returns false if `raiseError` is false.
 */
const expectStatement = (statements, toMatch, raiseError = true) => {
  expect(statements).to.be.a('array')

  let matchingPredicate
  if (toMatch.predicate) {
    matchingPredicate = statements.filter((s) => {
      return toMatch.predicate === s.predicate
    })
    if (raiseError && matchingPredicate.length === 0) {
      throw new Error(`Failed to find statement with predicate=${toMatch.predicate}`)
    }
  }

  if (toMatch.blanknode) {
    const matchingStatements = matchingPredicate.filter((_matchingPred) => {
      const matchingBlanknodeStatements = toMatch.blanknode._statements.filter((toMatchBlanknode) => {
        return expectStatement(_matchingPred.blanknode._statements, toMatchBlanknode, false)
      })
      return matchingBlanknodeStatements.length === toMatch.blanknode._statements.length
    })

    if (matchingStatements.length >= 1) {
      return true
    } else {
      if (raiseError) {
        throw new Error(`Expect statement with predicate=${toMatch.predicate} and matching blanknode statements`)
      }
      return false
    }
  } else {
    const stmt = statements.filter((s) => {
      return Object.keys(toMatch).reduce((matches, key) => {
        return matches && s[key] === toMatch[key]
      }, true)
    })[0]
    let statementPropsThatDidntMatch = {}
    if (!stmt) {
      statementPropsThatDidntMatch = statements.map((s) => {
        return Object.keys(toMatch).reduce((_statementProps, key) => {
          _statementProps[key] = s[key]
          return _statementProps
        }, {})
      })
    }
    if (raiseError) {
      expect(stmt, `Expect statement matching ${JSON.stringify(toMatch)} but found ${JSON.stringify(statementPropsThatDidntMatch, null, 2)}`).to.be.a('object')
    }
    return !!stmt
  }
}

describe('discovery-store-model', () => {
  before(() => {
    sinon.stub(AWS, 'Lambda')
      .callsFake(awsLambdaStub)
  })
  after(() => {
    AWS.Lambda.restore()
  })
  describe('filterOutAndDeleteNonResearchBibs', () => {
    it('removes non-research bib', () => {
      return discoveryStoreModel.filterOutAndDeleteNonResearchBibs([
        {
          id: 'circulating-bib',
          nyplSource: 'sierra-nypl',
          locations: [
            { code: 'ssj', name: '67th Street Children' }
          ]
        },
        {
          id: 'research-bib',
          nyplSource: 'sierra-nypl',
          locations: [
            { code: 'marr2', name: 'Schwarzman Building - Rare Book Collection Room 328' }
          ]
        }
      ]).then((filtered) => {
        expect(filtered).to.be.a('array')
        expect(filtered).to.have.lengthOf(1)
        expect(filtered[0].id).to.eq('research-bib')
      })
    })

    it('does not remove locations that are both Research and Branch', () => {
      return discoveryStoreModel.filterOutAndDeleteNonResearchBibs([
        {
          id: 'research-or-branch-bib',
          nyplSource: 'sierra-nypl',
          locations: [
            // This location has collectionType [ "Branch", "Research" ]
            { code: 'myrhr' }
          ]
        }
      ]).then((filtered) => {
        expect(filtered).to.be.a('array')
        expect(filtered).to.have.lengthOf(1)
        expect(filtered[0].id).to.eq('research-or-branch-bib')
      })
    })

    it('assues bibs with no locations are research', () => {
      return discoveryStoreModel.filterOutAndDeleteNonResearchBibs([
        { id: 123 },
        { id: 456, locations: [] }
      ]).then((filtered) => {
        expect(filtered).to.be.a('array')
        expect(filtered).to.have.lengthOf(2)
      })
    })

    it('assumes partner bibs are Research', () => {
      return discoveryStoreModel.filterOutAndDeleteNonResearchBibs([
        {
          id: 123,
          nyplSource: 'recap-cul',
          locations: [
            { code: 'marr2', name: 'This Research location would normally be compelling, but the partner nyplSource rule overrides it' }
          ]
        }
      ]).then((filtered) => {
        expect(filtered).to.be.a('array')
        expect(filtered).to.have.lengthOf(1)
      })
    })
  })

  describe('filterOutNonResearchItems', () => {
    it('removes circulating items', () => {
      return discoveryStoreModel.filterOutNonResearchItems([
        {
          nyplSource: 'sierra-nypl',
          id: 'research-item-1',
          fixedFields: {
            61: {
              label: 'Item Type',
              value: '3',
              display: null
            }
          }
        },
        {
          nyplSource: 'sierra-nypl',
          id: 'circulating-item-1',
          fixedFields: {
            61: {
              label: 'Item Type',
              value: '253',
              display: null
            }
          }
        }
      ]).then((filtered) => {
        expect(filtered).to.be.a('array')
        expect(filtered).to.have.lengthOf(1)
        expect(filtered[0].id).to.eq('research-item-1')
      })
    })

    it('assumes items with no/invalid Item Type are Research', () => {
      return discoveryStoreModel.filterOutNonResearchItems([
        {
          nyplSource: 'sierra-nypl',
          id: 'research-item-1',
          fixedFields: {
          }
        },
        {
          nyplSource: 'sierra-nypl',
          id: 'circulating-item-1',
          fixedFields: {
            61: {
              label: 'Item Type',
              value: 'fladeedle',
              display: null
            }
          }
        }
      ]).then((filtered) => {
        expect(filtered).to.be.a('array')
        expect(filtered).to.have.lengthOf(2)
      })
    })

    it('assumes partner items are Research', () => {
      return discoveryStoreModel.filterOutNonResearchItems([
        {
          nyplSource: 'recap-hl',
          id: 'research-item-1',
          fixedFields: {
            61: {
              label: 'Item Type',
              value: '3',
              display: null
            }
          }
        }
      ]).then((filtered) => {
        expect(filtered).to.be.a('array')
        expect(filtered).to.have.lengthOf(1)
      })
    })

    it('classifies bibs with location code "none" or "os" as Research (to ensure they are handled by suppression rules in the indexer)', () => {
      return discoveryStoreModel.filterOutAndDeleteNonResearchBibs([
        {
          nyplSource: 'sierra-nypl',
          id: 'research-bib-1',
          locations: [
            { code: 'none', name: 'This is a location that appears sometimes for 0-item bibs' }
          ]
        },
        {
          nyplSource: 'sierra-nypl',
          id: 'research-bibjj-2',
          locations: [
            { code: 'os', name: 'This is the OTF location, which nypl-core-objects considers Branch' }
          ]
        }

      ]).then((filtered) => {
        expect(filtered).to.be.a('array')
        expect(filtered).to.have.lengthOf(2)
      })
    })

    it('classifies bibs with location code "iarch" (has collectionTypes Branch & Research) as Research', () => {
      return discoveryStoreModel.filterOutAndDeleteNonResearchBibs([
        {
          nyplSource: 'sierra-nypl',
          id: 'research-bib-1',
          locations: [
            { code: 'iarch' }
          ]
        }
      ]).then((filtered) => {
        expect(filtered).to.be.a('array')
        expect(filtered).to.have.lengthOf(1)
      })
    })
  })

  describe('buildDiscoveryStoreBibs', () => {
    before(() => {
      sinon.stub(ScsbClient, 'instance').callsFake(() => Promise.resolve({ search: () => { } }))
      enableDataApiFixtures()
    })

    after(() => {
      ScsbClient.instance.restore()
      disableDataApiFixtures()
    })

    it('converts a plain bib into an object with correctly grouped statements', async () => {
      const bib = await platformApi.bibById('sierra-nypl', '10010064')
      const groupedStatements = await discoveryStoreModel.buildDiscoveryStoreBibs([bib])

      expect(groupedStatements).to.be.a('array')
      expect(groupedStatements[0]).to.be.a('object')
      expectStatement(groupedStatements[0]._statements, {
        predicate: 'dc:creator',
        object_literal: 'Vaux, Roberts, 1786-1836.'
      })
      expectStatement(groupedStatements[0]._statements, {
        predicate: 'bf:note',
        blanknode: {
          _statements: [
            { predicate: 'rdf:type', object_id: 'bf:Note' },
            { predicate: 'bf:noteType', object_literal: 'Bibliography' },
            { predicate: 'rdfs:label', object_literal: 'Bibliography: leaf preceding p. [1]' }
          ]
        }
      })
      expectStatement(groupedStatements[0]._statements, {
        predicate: 'bf:note',
        blanknode: {
          _statements: [
            { predicate: 'rdf:type', object_id: 'bf:Note' },
            { predicate: 'bf:noteType', object_literal: 'Source' },
            { predicate: 'rdfs:label', object_literal: 'of Sidney Lapidus; ' }
          ]
        }
      })

      expect(groupedStatements[0]._items).to.be.a('array')
      expect(groupedStatements[0]._items).to.have.lengthOf(4)

      expectStatementIn(groupedStatements[0]._items, {
        subject_id: 'i10005201',
        predicate: 'rdfs:type',
        object_id: 'bf:Item'
      })
      expectStatementIn(groupedStatements[0]._items, {
        predicate: 'nypl:holdingLocation',
        object_id: 'loc:scdd2'
      })

      expectStatementIn(groupedStatements[0]._items, {
        subject_id: 'i33615197',
        predicate: 'nypl:bnum',
        object_id: 'urn:bnum:b10010064'
      })

      expectStatementIn(groupedStatements[0]._items, {
        subject_id: 'i10010064-e',
        predicate: 'bf:electronicLocator',
        object_label: 'Request Access to Schomburg Rare Book Materials',
        object_literal: 'https://specialcollections.nypl.org/aeon/Aeon.dll?Action=10&Form=30&Title=Memoirs+of+the+life+of+Anthony+Benezet+/&Site=SCHRB&CallNumber=Sc+Rare+C+81-10&Author=Vaux,+Roberts,&ItemPlace=Philadelphia+:&ItemPublisher=James+P.+Parke,&Date=1817&ItemInfo3=https://nypl-sierra-test.nypl.org/record=b10010064&ReferenceNumber=b100100648&Genre=Book-text&Location=Schomburg+Center'
      })

      expect(groupedStatements[0]._holdings).to.be.a('array')
      expect(groupedStatements[0]._holdings).to.have.lengthOf(0)
    })

    it('converts a plain bib into an object with correctly grouped statements, including holdings', async () => {
      const bib = await platformApi.bibById('sierra-nypl', '12959619')
      const groupedStatements = await discoveryStoreModel.buildDiscoveryStoreBibs([bib])
      expect(groupedStatements).to.be.a('array')
      expect(groupedStatements[0]).to.be.a('object')
      expectStatement(groupedStatements[0]._statements, {
        predicate: 'dcterms:title',
        object_literal: 'AAHGS news : the bi-monthly newsletter of the Afro-American Historical and Genealogical Society, Inc.'
      })
      const realItems = groupedStatements[0]._items.filter(i => !i.id.includes('i-h'))
      const checkInCardItems = groupedStatements[0]._items.filter(i => i.id.includes('i-h'))
      expect(groupedStatements[0]._items).to.be.a('array')
      // real item statements
      expect(realItems).to.have.lengthOf(12)
      // checkin card item statements are there
      expect(checkInCardItems).to.have.lengthOf(3)
      // checkin card items have minimum properties
      expect(checkInCardItems.every(i => i._statements.some(statement => {
        return statement.predicate === 'rdfs:type' &&
          statement.object_id === 'nypl:CheckinCardItem'
      })))

      expect(groupedStatements[0]._holdings).to.be.a('array')
      expect(groupedStatements[0]._holdings).to.have.lengthOf(1)

      expectStatementIn(groupedStatements[0]._holdings, {
        predicate: 'rdfs:type',
        object_id: 'nypl:Holding'
      })
      expectStatementIn(groupedStatements[0]._holdings, {
        predicate: 'rdfs:type',
        object_id: 'nypl:Holding'
      })
      expectStatementIn(groupedStatements[0]._holdings, {
        predicate: 'dcterms:hasPart',
        blanknode: {
          _statements: [
            { subject_id: 'h1032862#1.0000', predicate: 'rdf:type', object_id: 'nypl:CheckInBox' },
            { predicate: 'dcterms:coverage', object_literal: 'Jan. 2012' },
            { predicate: 'bf:status', object_literal: 'Arrived' }
          ]
        }
      })
    })

    it('handles deleted bibs', async () => {
      const groupedStatements = await discoveryStoreModel.buildDiscoveryStoreBibs([{
        id: '987',
        nyplSource: 'sierra-nypl',
        nyplType: 'bib',
        deletedDate: '2022-06-22',
        deleted: true
      }])

      expect(groupedStatements).to.be.a('array')
      expect(groupedStatements[0]).to.be.a('object')
      // The following method will return true if the wrapped statements
      // include a statement with nypl:suppressed and value `true` and is
      // the mechanism for flagging bibs for deletion.
      expect(groupedStatements[0].isSuppressed()).to.eq(true)
    })
  })
})
