const sinon = require('sinon')
const AWS = require('aws-sdk')
const discoveryApiIndex = require('discovery-api-indexer/lib/index')
const NyplStreamsClient = require('@nypl/nypl-streams-client')
// For stubbing scsb client instantiation from a different module
const kmsHelperPcdm = require('pcdm-store-updater/lib/kms-helper')
const ScsbClient = require('../lib/scsb-client')

const index = require('../index')
const fixtures = require('./fixtures')
const { expect } = require('chai')
const { awsLambdaStub } = require('./utils')

// const { printJsonObject } = require('./utils')

describe('index.handler', () => {
  let kinesisWrites = {}
  let client
  before(async function () {
    sinon.stub(AWS, 'Lambda').callsFake(awsLambdaStub)
    // If updating fixtures, increase timeout to 10s
    this.timeout(process.env.UPDATE_FIXTURES ? 10000 : 2000)
    sinon.stub(kmsHelperPcdm, 'decrypt').callsFake(() => Promise.resolve('decrypted!'))
    client = await ScsbClient.instance()
    sinon.stub(client, 'search').callsFake(() => Promise.resolve('search result'))

    sinon.stub(NyplStreamsClient.prototype, 'write')
      .callsFake((streamName, records) => {
        kinesisWrites[streamName] = (kinesisWrites[streamName] || []).concat(records)
        return Promise.resolve({ Records: records })
      })

    return fixtures.enableDataApiFixtures()
  })

  afterEach(() => {
    kinesisWrites = {}
  })

  after(() => {
    AWS.Lambda.restore()
    kmsHelperPcdm.decrypt.restore()
    client.search.restore()
    NyplStreamsClient.prototype.write.restore()

    fixtures.disableDataApiFixtures()
  })

  describe('Bibs', () => {
    it('Handles b10001936, with 0 holdings and 2 items (one electronic)', () => {
      const event = require('./sample-events/b10001936.json')

      return new Promise((resolve, reject) => {
        index.handler(event, {}, (e, result) => {
          try {
            expect(result).to.eq('Wrote 1 doc(s)')
            expect(discoveryApiIndex.resources.save.calledOnce).to.eq(true)

            const { indexedDocuments } = global

            expect(indexedDocuments).to.have.lengthOf(1)
            expect(indexedDocuments[0]).to.be.a('object')

            // Check bib metadata:
            expect(indexedDocuments[0].uri).to.eq('b10001936')
            expect(indexedDocuments[0].nyplSource).to.eql(['sierra-nypl'])
            expect(indexedDocuments[0].type).to.eql(['nypl:Item'])
            expect(indexedDocuments[0].identifierV2).to.deep.include.members([
              { value: '*ONR 84-743', type: 'bf:ShelfMark' },
              { type: 'nypl:Bnumber', value: '10001936' },
              { type: 'bf:Identifier', value: 'NNSZ00201976' },
              { type: 'bf:Identifier', value: '(WaOLN)nyp0201934' }
            ])
            expect(indexedDocuments[0].issuance_packed).to.eql(['urn:biblevel:m||monograph/item'])
            expect(indexedDocuments[0].idOclc).to.eql(['NYPG002001377-B'])
            expect(indexedDocuments[0].language_packed).to.eql(['lang:arm||Armenian'])
            expect(indexedDocuments[0].title).to.eql(['Niwtʻer azgayin patmutʻian hamar Ereveli hay kazunkʻ ; Parskastan'])
            expect(indexedDocuments[0].subjectLiteral_exploded).to.include.members([
              'Armenians',
              'Armenians -- Iran',
              'Armenians -- Iran -- History'
            ])
            // This one has 5 notes. Check two:
            expect(indexedDocuments[0].note).to.deep.include.members([
              { type: 'bf:Note', noteType: 'Note', label: 'Publication date from cover.' },
              { type: 'bf:Note', noteType: 'Bibliography', label: 'Includes bibliographical references.' }
            ])
            // Two items, one is electronic resource, so numItems should be 1
            expect(indexedDocuments[0].numItems).to.eql([1])
            expect(indexedDocuments[0].numElectronicResources).to.eql([1])

            // Check holdings:
            expect(indexedDocuments[0].holdings).to.eql([])

            // Check items:
            expect(indexedDocuments[0].items).to.have.lengthOf(2)
            expect(indexedDocuments[0].items[0]).to.be.a('object')
            expect(indexedDocuments[0].items[0].uri).to.eq('i10001320')
            expect(indexedDocuments[0].items[0].owner).to.deep.include.members([
              { id: 'orgs:1000', label: 'Stephen A. Schwarzman Building' }
            ])
            expect(indexedDocuments[0].items[0].holdingLocation).to.deep.include.members([
              { id: 'loc:rc2ma', label: 'Offsite' }
            ])
            expect(indexedDocuments[0].items[0].shelfMark).to.eql(['*ONR 84-743'])
            expect(indexedDocuments[0].items[0].identifierV2).to.deep.include.members([
              { value: '*ONR 84-743', type: 'bf:ShelfMark' },
              { type: 'bf:Barcode', value: '33433001892276' }
            ])
            expect(indexedDocuments[0].items[0].physicalLocation).to.eql(['*ONR 84-743'])
            expect(indexedDocuments[0].items[0].accessMessage).to.deep.include.members([
              { id: 'accessMessage:2', label: 'Request in advance' }
            ])
            expect(indexedDocuments[0].items[0].accessMessage_packed).to.eql(['accessMessage:2||Request in advance'])
            expect(indexedDocuments[0].items[0].shelfMark_sort).to.eq('a*ONR 84-000743')

            // Expect writes to "processed" stream:
            expect(kinesisWrites).to.have.property('IndexDocumentProcessed-test')
            expect(kinesisWrites['IndexDocumentProcessed-test']).to.have.lengthOf(1)
            expect(kinesisWrites['IndexDocumentProcessed-test']).to.deep.include.members([
              { id: '10001936', nyplSource: 'sierra-nypl', nyplType: 'bib' }
            ])

            return resolve()
          } catch (e) {
            return reject(e)
          }
        })
      })
    })

    it('Handles cb578091, with 0 holdings and 1 item', () => {
      const event = require('./sample-events/cb578091.json')

      return new Promise((resolve, reject) => {
        index.handler(event, {}, (e, result) => {
          try {
            expect(result).to.eq('Wrote 1 doc(s)')

            const { indexedDocuments } = global
            expect(indexedDocuments[0].nyplSource).to.eql(['recap-cul'])
            // Check bib metadata
            expect(indexedDocuments[0].identifierV2).to.deep.include.members([
              { type: 'nypl:Bnumber', value: '578091' },
              { type: 'bf:Lccn', value: '   68058380//r84 ' },
              { type: 'bf:Identifier', value: '(OCoLC)2972' },
              { type: 'bf:Identifier', value: '(OCoLC)ocm00002972' },
              { type: 'bf:Identifier', value: '(CStRLIN)NYCG87-B57862' },
              { type: 'bf:Identifier', value: '(NNC)578091' }
            ])
            expect(indexedDocuments[0].title).to.eql(['Gray.'])
            expect(indexedDocuments[0].numItems).to.eql([1])

            // Check holdings:
            expect(indexedDocuments[0].holdings).to.eql([])

            // Check items:
            expect(indexedDocuments[0].items).to.have.lengthOf(1)
            expect(indexedDocuments[0].items[0]).to.be.a('object')
            expect(indexedDocuments[0].items[0].uri).to.eq('ci925114')
            expect(indexedDocuments[0].items[0].owner).to.deep.include.members([
              { id: 'orgs:0002', label: 'Columbia University Libraries' }
            ])

            expect(indexedDocuments[0].items[0].identifierV2).to.deep.include.members([
              { value: 'PR3503 .G6 1968', type: 'bf:ShelfMark' },
              { type: 'bf:Barcode', value: 'CU54932505' }
            ])
            expect(indexedDocuments[0].items[0].idBarcode).to.eql(['CU54932505'])
            expect(indexedDocuments[0].items[0].shelfMark_sort).to.eq('aPR3503 .G6 001968')

            // Expect writes to "processed" stream:
            expect(kinesisWrites).to.have.property('IndexDocumentProcessed-test')
            expect(kinesisWrites['IndexDocumentProcessed-test']).to.have.lengthOf(1)
            expect(kinesisWrites['IndexDocumentProcessed-test']).to.deep.include.members([
              { id: '578091', nyplSource: 'recap-cul', nyplType: 'bib' }
            ])

            return resolve()
          } catch (e) {
            return reject(e)
          }
        })
      })
    })
  })

  describe('Holdings', () => {
    it('Handles h1032862 to build b12959619 with 1 holding and 12 items', () => {
      const event = require('./sample-events/h1032862.json')

      return new Promise((resolve, reject) => {
        index.handler(event, {}, (e, result) => {
          try {
            expect(result).to.eq('Wrote 1 doc(s)')

            const { indexedDocuments } = global
            expect(indexedDocuments[0].uri).to.eql('b12959619')
            expect(indexedDocuments[0].nyplSource).to.eql(['sierra-nypl'])

            // Check bib metadata
            expect(indexedDocuments[0].title).to.eql(['AAHGS news : the bi-monthly newsletter of the Afro-American Historical and Genealogical Society, Inc.'])
            expect(indexedDocuments[0].numItems).to.eql([12])

            // Check holdings:
            expect(indexedDocuments[0].holdings).to.have.lengthOf(1)
            expect(indexedDocuments[0].holdings[0]).to.deep.include({
              uri: 'h1032862',
              physicalLocation: ['Sc Ser.-M .N489'],
              holdingStatement: [
                'Jan 1997-Apr 1998,Nov 2000-Jul 2003,Nov 2003,Jan/Feb 2004-Mar/Apr 2004,Nov/Dec 2004-',
                '2009-07/08'
              ],
              shelfMark: ['Sc Ser.-M .N489'],
              identifier: [
                { value: 'Sc Ser.-M .N489', type: 'bf:shelfMark' }
              ],
              location: [
                { label: 'Schomburg Center - Research and Reference Division', code: 'loc:sc' }
              ]
            })
            const checkInBoxes = indexedDocuments[0].holdings[0].checkInBoxes
            expect(checkInBoxes).to.deep.include.members([
              {
                copies: undefined,
                type: 'nypl:CheckInBox',
                coverage: 'Jan. 2012',
                status: 'Arrived',
                position: '1',
                shelfMark: ['Sc Ser.-M .N489']
              },
              {
                copies: undefined,
                type: 'nypl:CheckInBox',
                coverage: 'Mar. 2012',
                status: 'Arrived',
                position: '2',
                shelfMark: ['Sc Ser.-M .N489']
              },
              {
                copies: undefined,
                type: 'nypl:CheckInBox',
                coverage: 'May. 2012',
                status: 'Expected',
                position: '3',
                shelfMark: ['Sc Ser.-M .N489']
              }
            ])

            // Check items:
            expect(indexedDocuments[0].items).to.have.lengthOf(15)
            // Check amount of checkin card items
            expect(indexedDocuments[0].items.filter(item => item.uri.includes('i-h'))).to.have.lengthOf(checkInBoxes.length)

            // Expect writes to "processed" stream:
            expect(kinesisWrites).to.have.property('IndexDocumentProcessed-test')
            expect(kinesisWrites['IndexDocumentProcessed-test']).to.have.lengthOf(1)
            expect(kinesisWrites['IndexDocumentProcessed-test']).to.deep.include.members([
              { id: '12959619', nyplSource: 'sierra-nypl', nyplType: 'bib' }
            ])

            return resolve()
          } catch (e) {
            return reject(e)
          }
        })
      })
    })
  })

  describe('Items', () => {
    it('Handles ci925114 to build cb578091 1 item', () => {
      const event = require('./sample-events/ci925114.json')

      return new Promise((resolve, reject) => {
        index.handler(event, {}, (e, result) => {
          try {
            expect(result).to.eq('Wrote 1 doc(s)')

            const { indexedDocuments } = global
            expect(indexedDocuments[0].uri).to.eql('cb578091')
            expect(indexedDocuments[0].nyplSource).to.eql(['recap-cul'])

            // Check items:
            expect(indexedDocuments[0].items).to.have.lengthOf(1)

            // Expect writes to "processed" stream:
            expect(kinesisWrites).to.have.property('IndexDocumentProcessed-test')
            expect(kinesisWrites['IndexDocumentProcessed-test']).to.have.lengthOf(1)
            expect(kinesisWrites['IndexDocumentProcessed-test']).to.deep.include.members([
              { id: '578091', nyplSource: 'recap-cul', nyplType: 'bib' }
            ])

            return resolve()
          } catch (e) {
            return reject(e)
          }
        })
      })
    })

    describe('Missing bib', () => {
      it('Handles i14783826, with missing bib', () => {
        // This item has bibId 10128427, which has fixture
        // platform-api-b0f57e3adb1d0eeed81c5c41aacbb107.json,
        // which has been written to emulate a 404
        const event = require('./sample-events/i14783826.json')

        return new Promise((resolve, reject) => {
          index.handler(event, {}, (e, result) => {
            try {
              expect(result).to.eq('Wrote 0 doc(s)')

              expect(global.indexedDocuments).to.have.lengthOf(0)

              // Expect no writes to "processed" stream:
              expect(kinesisWrites).to.not.have.property('IndexDocumentProcessed-test')

              return resolve()
            } catch (e) {
              return reject(e)
            }
          })
        })
      })

      it('Handles i14783826, i34162229, and i13172719, one of which has a missing bib', () => {
        // This item has bibId 10128427, which has fixture
        // platform-api-b0f57e3adb1d0eeed81c5c41aacbb107.json,
        // which has been written to emulate a 404
        const event = require('./sample-events/i14783826-and-i34162229-and-i13172719.json')

        return new Promise((resolve, reject) => {
          index.handler(event, {}, (e, result) => {
            try {
              expect(result).to.eq('Wrote 2 doc(s)')

              expect(global.indexedDocuments).to.have.lengthOf(2)

              // Expect writes to "processed" stream:
              expect(kinesisWrites).to.have.property('IndexDocumentProcessed-test')
              expect(kinesisWrites['IndexDocumentProcessed-test']).to.have.lengthOf(2)
              expect(kinesisWrites['IndexDocumentProcessed-test']).to.deep.include.members([
                { id: '20970375', nyplSource: 'sierra-nypl', nyplType: 'bib' },
                { id: '11361121', nyplSource: 'sierra-nypl', nyplType: 'bib' }
              ])

              return resolve()
            } catch (e) {
              return reject(e)
            }
          })
        })
      })
    })

    describe('Circ bib', () => {
      it('Handles deleting a circ bib', () => {
        const event = require('./sample-events/b22316804.json')

        return new Promise((resolve, reject) => {
          index.handler(event, {}, (e, result) => {
            try {
              expect(result).to.eq('Wrote 0 doc(s)')

              expect(global.indexedDocuments).to.have.lengthOf(0)
              expect(global.deletedUris).to.have.lengthOf(1)
              expect(global.deletedUris[0]).to.eq('b22316804')

              return resolve()
            } catch (e) {
              return reject(e)
            }
          })
        })
      })
    })

    describe('Deleted item', () => {
      before(() => {
        // The lack of bibIds in the deleted item will trigger a query on the
        // index to retrieve the bibid:
        sinon.stub(discoveryApiIndex, 'search')
          .callsFake((payload) => {
            return Promise.resolve({
              hits: {
                total: 1,
                hits: [
                  {
                    _source: {
                      uri: 'cb528410'
                    }
                  }
                ]
              }
            })
          })
      })

      after(() => {
        discoveryApiIndex.search.restore()
      })

      it('Handles ci5714552 a deleted partner item', () => {
        // This item has been deleted, meaning it has no bibIds
        const event = require('./sample-events/ci5714552.json')

        return new Promise((resolve, reject) => {
          index.handler(event, {}, (e, result) => {
            try {
              expect(result).to.eq('Wrote 1 doc(s)')
              const { indexedDocuments } = global
              expect(indexedDocuments).to.have.lengthOf(1)

              // Confirm the deleted item does not appear in the newly built
              // document:
              expect(indexedDocuments[0].items).to.be.a('array')
              expect(indexedDocuments[0].items).to.have.lengthOf(77)
              expect(indexedDocuments[0].items).to.not.deep.include({
                uri: 'ci5714552'
              })

              // Expect writes to "processed" stream:
              expect(kinesisWrites).to.have.property('IndexDocumentProcessed-test')
              expect(kinesisWrites['IndexDocumentProcessed-test']).to.have.lengthOf(1)
              expect(kinesisWrites['IndexDocumentProcessed-test']).to.deep.include.members([
                { id: '528410', nyplSource: 'recap-cul', nyplType: 'bib' }
              ])

              return resolve()
            } catch (e) {
              return reject(e)
            }
          })
        })
      })
    })

    describe('Deleted [circulating] item', () => {
      before(() => {
        // The lack of bibIds in the deleted item will trigger a query on the
        // index to retrieve the bibid, which will return 0 results because
        // it's a circulating item:
        sinon.stub(discoveryApiIndex, 'search')
          .callsFake((payload) => {
            return Promise.resolve({
              hits: {
                total: 0,
                hits: []
              }
            })
          })
      })

      after(() => {
        discoveryApiIndex.search.restore()
      })

      it('Handles a deleted circ item (noop)', () => {
        // This item has been deleted, meaning it has no bibIds
        const event = require('./sample-events/deleted-circ-item.json')

        return new Promise((resolve, reject) => {
          index.handler(event, {}, (e, result) => {
            try {
              expect(result).to.eq('Wrote 0 doc(s)')
              expect(global.indexedDocuments).to.have.lengthOf(0)

              return resolve()
            } catch (e) {
              return reject(e)
            }
          })
        })
      })
    })

    describe('Network error', function () {
      const NYPLDataApiClient = require('@nypl/nypl-data-api-client')

      before(() => {
        // Disable default fixtures to establish special error emulation:
        fixtures.disableDataApiFixtures()

        sinon.stub(NYPLDataApiClient.prototype, '_doAuthenticatedRequest').callsFake(function (requestOptions) {
          return Promise.reject(new Error('Emulated timeout'))
        })
      })

      after(() => {
        // Restore default fixtures:
        NYPLDataApiClient.prototype._doAuthenticatedRequest.restore()

        fixtures.enableDataApiFixtures()
      })

      it('Handles network error by firing error callback', () => {
        // This item has bibId 10128427, which has fixture
        // platform-api-b0f57e3adb1d0eeed81c5c41aacbb107.json,
        // which has been written to emulate a 404
        const event = require('./sample-events/i14783826.json')

        return new Promise((resolve, reject) => {
          index.handler(event, {}, (e, result) => {
            try {
              expect(result).to.be.a('undefined')
              expect(e).to.be.a('error')

              expect(global.indexedDocuments).to.have.lengthOf(0)

              // Expect writes to "processed" stream:
              expect(kinesisWrites).to.not.have.property('IndexDocumentProcessed-test')

              return resolve()
            } catch (e) {
              return reject(e)
            }
          })
        })
      })
    })
  })
})
