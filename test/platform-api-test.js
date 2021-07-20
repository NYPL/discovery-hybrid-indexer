const platformApi = require('../lib/platform-api')

describe('platform-api', () => {
  describe('bibIdentifiersForItems', () => {
    it('extracts bib identifiers from item', () => {
      const ids = platformApi.internal.bibIdentifiersForItems([
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

    it('extracts bib identifiers from items', () => {
      const ids = platformApi.internal.bibIdentifiersForItems([
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

    it('extracts distinct bib identifiers from items', () => {
      const ids = platformApi.internal.bibIdentifiersForItems([
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
  })
})
