const dotenv = require('dotenv')

dotenv.config({ path: './config/test.env' })

global.expect = require('chai').expect
