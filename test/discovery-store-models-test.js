const discoveryStoreModel = require('../lib/discovery-store-model')

describe('discovery-store-model', () => {
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
  })
})
