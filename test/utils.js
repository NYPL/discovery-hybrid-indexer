const standard = require('standard')

const printJsonObject = (obj) => {
  const stringified = JSON.stringify(obj, null, 2)
  const linted = standard.lintTextSync(stringified, { fix: true }).results[0].output

  console.log('Doc: ', linted)
}

const awsLambdaStub = () => {
  return {
    invoke: () => {
      return {
        promise: () => {
          return Promise.resolve({
            Payload: JSON.stringify({
              body: JSON.stringify({ dates: {} })
            })
          })
        }
      }
    }
  }
}

module.exports = {
  printJsonObject, awsLambdaStub
}
