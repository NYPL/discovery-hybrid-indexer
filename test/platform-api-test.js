const sinon = require('sinon')

const platformApi = require('../lib/platform-api')
const discoveryApiIndex = require('discovery-api-indexer/lib/index')

describe('platform-api', () => {
  describe('bibIdentifiersForItems', () => {
    it('extracts bib identifiers from item', async () => {
      const ids = await platformApi.internal.bibIdentifiersForItems([
        {
          bibIds: ['123'],
          nyplSource: 'sierra-nypl'
        }
      ])
      expect(ids).to.be.a('array')
      expect(ids).to.have.lengthOf(1)
      expect(ids).to.deep.include.members([
        { id: '123', nyplSource: 'sierra-nypl' }
      ])
    })

    it('extracts bib identifiers from items', async () => {
      const ids = await platformApi.internal.bibIdentifiersForItems([
        { bibIds: ['123'], nyplSource: 'sierra-nypl' },
        { bibIds: ['456'], nyplSource: 'recap-pul' }
      ])
      expect(ids).to.be.a('array')
      expect(ids).to.have.lengthOf(2)
      expect(ids).to.deep.include.members([
        { id: '456', nyplSource: 'recap-pul' },
        { id: '123', nyplSource: 'sierra-nypl' }
      ])
    })

    it('extracts distinct bib identifiers from items', async () => {
      const ids = await platformApi.internal.bibIdentifiersForItems([
        { bibIds: ['123'], nyplSource: 'sierra-nypl' },
        { bibIds: ['123'], nyplSource: 'sierra-nypl' },
        { bibIds: ['456'], nyplSource: 'recap-pul' },
        { bibIds: ['123'], nyplSource: 'sierra-nypl' }
      ])
      expect(ids).to.be.a('array')
      expect(ids).to.have.lengthOf(2)
      expect(ids).to.deep.include.members([
        { id: '456', nyplSource: 'recap-pul' },
        { id: '123', nyplSource: 'sierra-nypl' }
      ])
    })

    describe('for deleted items', () => {
      before(() => {
        sinon.stub(discoveryApiIndex, 'search')
          .callsFake((payload) => {
            return Promise.resolve({
              hits: {
                total: 1,
                hits: [
                  {
                    _source: {
                      uri: 'b9876'
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

      it('uses discovery-api index to resolve bibid for deleted item', async () => {
        // When items are deleted, all metadata is nulled including bibIds:
        const ids = await platformApi.internal.bibIdentifiersForItems([
          { id: '123', bibIds: [], nyplSource: 'sierra-nypl' }
        ])

        expect(ids).to.be.a('array')
        expect(ids).to.have.lengthOf(1)
        // We expect the method to call discoveryApiIndex.search (stubbed
        // above) to retrieve the bibId in the index:
        expect(ids).to.deep.include.members([
          { id: '9876', nyplSource: 'sierra-nypl', type: 'bib' }
        ])
      })
    })
  })
})
