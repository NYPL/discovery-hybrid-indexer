const discoveryStoreModel = require('../lib/discovery-store-model')

describe('discovery-store-model', () => {
  describe('filterOutNonResearchBibs', () => {
    it('removes non-research bib', () => {
      return discoveryStoreModel.filterOutNonResearchBibs([
        {
          id: 'circulating-bib',
          locations: [
            { code: 'ssj', name: '67th Street Children' }
          ]
        },
        {
          id: 'research-bib',
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
      return discoveryStoreModel.filterOutNonResearchBibs([
        {
          id: 'research-or-branch-bib',
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

    it('handles bibs with no locations: assumes they\'re research', () => {
      return discoveryStoreModel.filterOutNonResearchBibs([
        { id: 123 },
        { id: 456, locations: [] }
      ]).then((filtered) => {
        expect(filtered).to.be.a('array')
        expect(filtered).to.have.lengthOf(2)
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
  })
})
