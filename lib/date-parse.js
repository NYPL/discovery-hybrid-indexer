const AWS = require('aws-sdk')
const SierraItem = require('pcdm-store-updater/lib/models/item-sierra-record')
const { flattenArray } = require('pcdm-store-updater/lib/utils')

AWS.config.region = 'us-east-1'
const lambda = new AWS.Lambda()

/**
 * Given an array of bibs that already have items attached, returns an
 * array of the fieldtagvs from all items on the bib.
 */
const extractFieldtagvs = (bibs) => {
  return flattenArray(bibs.map((bib) => {
    return bib.items.map((item) => {
      return (new SierraItem(item)).fieldTag('v')[0]
    })
  }))
}

/**
 *
 * @param {*} batchSize a number
 * @param {*} originalArray array
 * @returns a nested array whose elements have a maximum
 *  length of batchsize
 */

const batchDates = (batchSize, originalArray) => {
  const batches = []
  for (let i = 0; i < originalArray.length; i += batchSize) {
    batches.push(originalArray.slice(i, i + batchSize))
  }
  return batches
}

let dateCache = {}

const checkCache = (fieldtagv) => {
  return dateCache[fieldtagv]
}

/**
 *
 * @param {*} dates, an array of strings representing field tag 'v'
 * @returns an array of those dates with some string manipulation
 *  so the data plays nicely with timetwister
 */

const preparse = function (dates) {
  const preparsingObjects = [parens, colon, twoYearRangeMulti, yearRangeWithSlash, soloRangeSlash, shortYearBug, monthRangeWithSlash]
  return dates.map((date) => {
    // do some string manipulation so data works better with timetwister lambda
    preparsingObjects.forEach((preparse) => {
      if (date.match(preparse.matchExpression)) {
        date = preparse.transform(date)
      }
    })
    return date
  })
}

/**
 *
 * @param {array} bibs an array of bibs with items attached
 * @returns nothing, used for side effect of calling timetwister lambda and filling cache
 */

const parseDatesAndCache = async function (bibs) {
  const dates = extractFieldtagvs(bibs)
  const preparsedDates = preparse(dates)
  try {
    let ranges = await timeTwist(preparsedDates)
    ranges = filterNulls(ranges, preparsedDates)
    dateCache = dates.reduce((cache, date, i) => {
      return { ...cache, [date]: ranges[i] }
    }, {})
  } catch (e) {
    console.error(e)
  }
}

/**
 * This function is used for testing the date parsing mechanism
 * via scripts/check-date-parsing-targets.js and test/date-parse-test.js
 */

const _parseDates = async function (dates) {
  if (!Array.isArray(dates)) dates = [dates]
  const preparsedDates = preparse(dates)
  try {
    let ranges = await timeTwist(preparsedDates)
    ranges = filterNulls(ranges, preparsedDates)
    // ranges is returned super nested:
    /**
     * all fieldtagvs [
        individual fieldtagv [
          all parsed ranges [
            individual range [date, date]
          ]
        ]
      ]
     *  */
    return ranges[0]
  } catch (e) {
    console.error(e)
  }
}

/**
 *
 * @param {*} preparsedDates, an array of strings
 * @returns an array of parsed dates
 */

const timeTwist = async (preparsedDates) => {
  const payloadStr = JSON.stringify({
    path: '/',
    body: JSON.stringify({ dates: preparsedDates })
  })
  const params = {
    FunctionName: 'DateParser-qa',
    Payload: payloadStr
  }
  const preparsedDatesBatches = batchDates(1000, preparsedDates)

  const timetwistedDates = await Promise.all(preparsedDatesBatches.map(async (batch) => {
    try {
      const { Payload } = await lambda.invoke(params).promise()
      // Extract date information from payload
      const payloadParsed = batch.map((date) => JSON.parse(JSON.parse(Payload).body).dates[date])
      // Convert from object into nested array
      const ranges = payloadParsed.map((results) => results.map((result) => ([result.date_start, result.date_end])))
      return ranges
    } catch (error) {
      console.error(error)
    }
  }))
  return flattenArray(timetwistedDates)
}

const filterNulls = (rangesArray, preparsedDates) => {
  return rangesArray.map((rangesPerFieldtagv, rangesArrayIndex) => {
    return rangesPerFieldtagv.map((range) => {
      // If both values of a range are null, try and match on a single year in fieldtagv
      if (range[0] === null || range[1] === null) {
        const singleYear = hailMary.transform(preparsedDates[rangesArrayIndex])
        if (singleYear) {
          return [singleYear, singleYear]
        }
        // need to explicitly return null for standardjs linting
        return null
      } else return range
    })
  })
}

// If timetwister returns null values, try to return a date
const hailMary = {
  matchExpression: /(?:16|17|18|19|20)\d{2}/,
  transform: function (range) {
    const match = range.match(this.matchExpression)
    if (match) {
      return match[0]
    }
  }
}

// Extract values from inside parentheses; v. 5 (August 1990)
const parens = {
  matchExpression: /\((.+)\)/,
  transform: function (range) {
    const match = range.match(this.matchExpression)
    return match[1]
  },
  exampleString: 'v. 5 (August 1990)'
}

// 1992:spring
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June?', 'July?', 'Aug', 'Sept?', 'Oct', 'Nov', 'Dec']
const monthPattern = `(${monthNames.join('|')}).?`
const seasonNames = ['Win(ter)?', '(Autumn|Fall?)', 'Spr(ing)?', 'Sum(mer)?']
const seasonPattern = `(${seasonNames.join('|')}).?`
const monthOrSeasonPattern = `(${monthPattern}|${seasonPattern})`

const colon = {
  matchExpression: new RegExp(`\\d{4}:${monthOrSeasonPattern}`, 'i'),
  transform: function (range) {
    return range.split(':')[1] + ' ' + range.split(':')[0]
  },
  exampleString: '1992:spring'
}

// 1991/1992, but only if it is the only date range in the string
const soloRangeSlash = {
  matchExpression: /(?<!(?:no|v)\.?\s?)(?:^|\s|-)\d{4}\/(\d{4}|\d{2})/g,
  transform: function (range) {
    const rangeMatch = range.match(this.matchExpression)
    return rangeMatch[0].replace(/\//, '-')
  },
  exampleString: '1991/1992'
}

// 1956/57-1981/82
const twoYearRangeMulti = {
  matchExpression: /(?<!(no|v)\.\s?)\d{4}\/(\d{4}|\d{2})-\d{4}\/(\d{4}|\d{2})/gi,
  transform: (ranges) => {
    // turn 1956/57-1981/82 into 1956-82 and 1956/57-2001/02 into 1956-2002
    const range = ranges.match(/(\d{4})\/(\d{4}|\d{2})-\d{4}\/(\d{4}|\d{2})/)
    // Take the second capture group and the fourth, which are the first year in the string and the last.
    const start = range[1]
    let end = range[3]
    // for ranges that end up 1999-02, turn into 1999-2002
    if (start.match(/^19/) && end.match(/^0\d/)) {
      end = '20' + end
    }
    return start + '-' + end
  },
  exampleString: '1956/57-1981/82'
}

// addressing mysterious bug in timetwister that causes null values for XX0X-0X ranges
const shortYearBug = {
  matchExpression: /(\d{4})-(0\d)/,
  transform: function (range) {
    const shortYear = range.match(this.matchExpression)[2]
    const century = range.match(/^\d{2}/)[0]
    return range.replace(/(?<=-)(0\d)/, century + shortYear)
  },
  exampleString: 'XX0X-0X'
}

// month-month/month ' May-June/July 1963,  Oct. 1961-Sept./Oct. 1962'
const monthRangeWithSlash = {
  matchExpression: /(?<=-)[a-z]{3,4}\.?\/|\/[a-z]{3,4}\./gi,
  transform: function (range) {
    return range.replace(this.matchExpression, '')
  },
  exampleString: ' May-June/July 1963, Oct. 1961-Sept./Oct. 1962'
}

// 1895-1896/1897
const yearRangeWithSlash = {
  matchExpression: /(?<!(?:no|v)\.\s?)(\d{4}-)\d{4}\/(\d{4})/,
  transform: function (range) {
    const years = range.match(this.matchExpression)
    return years[1] + years[2]
  },
  exampleString: '1895-1896/1897'
}

module.exports = { parseDatesAndCache, checkCache, private: { _parseDates } }
