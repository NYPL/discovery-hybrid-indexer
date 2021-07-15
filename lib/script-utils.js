const aws = require('aws-sdk')

const awsInit = (profile) => {
  // Set aws creds:
  aws.config.credentials = new aws.SharedIniFileCredentials({
    profile: profile || 'nypl-digital-dev'
  })

  // Set aws region:
  const awsSecurity = { region: 'us-east-1' }
  aws.config.update(awsSecurity)
}

const die = (message) => {
  console.log('Error: ' + message)
  process.exit()
}

module.exports = {
  die,
  awsInit
}
