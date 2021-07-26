const utils = require('../lib/utils')

describe('utils', () => {
  describe('arrayChunks', () => {
    it('extracts distinct bib identifiers from items', () => {
      const ids = utils.arrayChunks([0, 1, 2, 3, 4, 5, 6, 7, 8], 2)
      expect(ids).to.be.a('array')
      expect(ids[0]).to.deep.include.members([0, 1])
    })
  })

  describe('groupObjectsByMultivalueProperty', () => {
    it('handles arrays of objects with multi-value properties', () => {
      const objects = [
        { bibIds: [4], id: 1 },
        { bibIds: [5], id: 2 },
        { bibIds: [5, 6], id: 3 }
      ]

      const grouped = utils.groupObjectsByMultivalueProperty(objects, 'bibIds')
      expect(grouped).to.be.a('object')
      expect(grouped).to.deep.include({
        4: [{ bibIds: [4], id: 1 }],
        5: [
          { bibIds: [5], id: 2 },
          { bibIds: [5, 6], id: 3 }
        ],
        6: [{ bibIds: [5, 6], id: 3 }]
      })
    })

    it('handles arrays of objects with single-value properties', () => {
      const objects = [
        { bibIds: 4, id: 1 },
        { bibIds: 5, id: 2 },
        { bibIds: 5, id: 3 }
      ]

      const grouped = utils.groupObjectsByMultivalueProperty(objects, 'bibIds')
      expect(grouped).to.be.a('object')
      expect(grouped).to.deep.include({
        4: [{ bibIds: 4, id: 1 }],
        5: [
          { bibIds: 5, id: 2 },
          { bibIds: 5, id: 3 }
        ]
      })
    })
  })
})
