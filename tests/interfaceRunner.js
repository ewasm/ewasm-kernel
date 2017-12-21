const tape = require('tape')
const fs = require('fs')
const path = require('path')
const Address = require('../deps/address')
const U256 = require('../deps/u256')

const Kernel = require('../index.js')
const Environment = require('../testEnvironment.js')

const dir = path.join(__dirname, '/interface')
// get the test names
let tests = fs.readdirSync(dir).filter((file) => file.endsWith('.wast'))
// tests = ['callDataSize.wast']

runTests(tests)

function runTests (tests) {
  for (let testName of tests) {
    testName = testName.split('.')[0]
    tape(testName, async (t) => {
      // Compile Command
      const code = fs.readFileSync(`${dir}/${testName}.wasm`)
      const envData = JSON.parse(fs.readFileSync(`${dir}/${testName}.json`).toString())

      envData.caller = new Address(envData.caller)
      envData.address = new Address(envData.address)
      envData.coinbase = new Address(envData.coinbase)
      envData.origin = new Address(envData.origin)
      envData.callData = Buffer.from(envData.callData.slice(2), 'hex')
      envData.callValue = new U256(envData.callValue)

      for (let address in envData.state) {
        envData.state[address]['storage'] = {}
      }

      // state is in envData.state
      const kernel = new Kernel({code: code})
      const env = new Environment(envData)

      try {
        await kernel.run(env)
      } catch (e) {
        t.fail('Exception: ' + e)
        console.error('FAIL')
        console.error(e)
      } finally {
        t.pass(testName)
        console.log('done')
      }
      t.end()
    })
  }
}
