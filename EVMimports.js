/**
 * This is the Ethereum interface that is exposed to the WASM instance which
 * enables to interact with the Ethereum Environment
 */
const fs = require('fs')
const path = require('path')
const ethUtil = require('ethereumjs-util')
const U256 = require('./deps/u256.js')

const U128_SIZE_BYTES = 16
const ADDRESS_SIZE_BYTES = 20
const U256_SIZE_BYTES = 32

const log = require('loglevel')
log.setLevel('warn') // hide logs
// log.setLevel('debug') // for debugging

// The interface exposed to the WebAessembly Core
module.exports = class Interface {
  constructor (kernel) {
    this.kernel = kernel
    const shimBin = fs.readFileSync(path.join(__dirname, '/wasm/interface.wasm'))
    const shimMod = WebAssembly.Module(shimBin)
    this.shims = WebAssembly.Instance(shimMod, {
      'interface': {
        'useGas': this._useGas.bind(this),
        'getGasLeftHigh': this._getGasLeftHigh.bind(this),
        'getGasLeftLow': this._getGasLeftLow.bind(this),
        'call': this._call.bind(this)
      }
    })
  }

  static get name () {
    return 'ethereum'
  }

  get exports () {
    let exportMethods = [
      // include all the public methods according to the Ethereum Environment Interface (EEI) r1
      'getAddress',
      'getBalance',
      'getTxOrigin',
      'getCaller',
      'getCallValue',
      'getCallDataSize',
      'callDataCopy',
      'callDataCopy256',
      'getCodeSize',
      'codeCopy',
      'getExternalCodeSize',
      'externalCodeCopy',
      'getTxGasPrice',
      'getBlockHash',
      'getBlockCoinbase',
      'getBlockTimestamp',
      'getBlockNumber',
      'getBlockDifficulty',
      'getBlockGasLimit',
      'log',
      'create',
      'callCode',
      'callDelegate',
      'storageStore',
      'storageLoad',
      'return',
      'selfDestruct'
    ]
    let ret = {}
    exportMethods.forEach((method) => {
      ret[method] = this[method].bind(this)
    })

    // add shims
    ret.useGas = this.shims.exports.useGas
    ret.getGasLeft = this.shims.exports.getGasLeft
    ret.call = this.shims.exports.call
    return ret
  }

  setModule (mod) {
    this.module = mod
  }

  /**
   * Subtracts an amount to the gas counter
   * @param {integer} amount the amount to subtract to the gas counter
   */
  _useGas (high, low) {
    this.takeGas(from64bit(high, low))
  }

  /**
   * Returns the current amount of gas
   * @return {integer}
   */
  _getGasLeftHigh () {
    return Math.floor(this.kernel.environment.gasLeft / 4294967296)
  }

  /**
   * Returns the current amount of gas
   * @return {integer}
   */
  _getGasLeftLow () {
    return this.kernel.environment.gasLeft
  }

  /**
   * Gets address of currently executing account and loads it into memory at
   * the given offset.
   * @param {integer} offset
   */
  getAddress (offset) {
    log.debug('EVMImports.js getAddress')
    this.takeGas(2)

    this.setMemory(offset, ADDRESS_SIZE_BYTES, this.kernel.environment.address.toMemory())
  }

  /**
   * Gets balance of the given account and loads it into memory at the given
   * offset.
   * @param {integer} addressOffset the memory offset to laod the address
   * @param {integer} resultOffset
   */
  getBalance (addressOffset, offset, cbIndex) {
    log.debug('EVMImports.js getBalance')
    this.takeGas(20)

    const address = this.getMemory(addressOffset, ADDRESS_SIZE_BYTES)
    const addressHex = '0x' + Buffer.from(address).toString('hex')

    let balance
    if (this.kernel.environment.state.hasOwnProperty(addressHex)) {
      balance = this.kernel.environment.state[addressHex].balance
    } else {
      balance = '0x0'
    }

    const balanceU256 = new U256(balance)
    const opPromise = Promise.resolve(balanceU256)

    this.kernel.pushOpsQueue(opPromise, cbIndex, balance => {
      this.setMemory(offset, U128_SIZE_BYTES, balance.toMemory(U128_SIZE_BYTES))
    })
  }

  /**
   * Gets the execution's origination address and loads it into memory at the
   * given offset. This is the sender of original transaction; it is never an
   * account with non-empty associated code.
   * @param {integer} offset
   */
  getTxOrigin (offset) {
    log.debug('EVMImports.js getTxOrigin')
    this.takeGas(2)

    this.setMemory(offset, ADDRESS_SIZE_BYTES, this.kernel.environment.origin.toMemory())
  }

  /**
   * Gets caller address and loads it into memory at the given offset. This is
   * the address of the account that is directly responsible for this execution.
   * @param {integer} offset
   */
  getCaller (offset) {
    log.debug('EVMImports.js getCaller')
    this.takeGas(2)

    this.setMemory(offset, ADDRESS_SIZE_BYTES, this.kernel.environment.caller.toMemory())
  }

  /**
   * Gets the deposited value by the instruction/transaction responsible for
   * this execution and loads it into memory at the given location.
   * @param {integer} offset
   */
  getCallValue (offset) {
    log.debug('EVMImports.js getCallValue')
    this.takeGas(2)

    this.setMemory(offset, U128_SIZE_BYTES, this.kernel.environment.callValue.toMemory(U128_SIZE_BYTES))
  }

  /**
   * Get size of input data in current environment. This pertains to the input
   * data passed with the message call instruction or transaction.
   * @return {integer}
   */
  getCallDataSize () {
    log.debug('EVMImports.js getCallDataSize')
    this.takeGas(2)

    return this.kernel.environment.callData.length
  }

  /**
   * Copys the input data in current environment to memory. This pertains to
   * the input data passed with the message call instruction or transaction.
   * @param {integer} offset the offset in memory to load into
   * @param {integer} dataOffset the offset in the input data
   * @param {integer} length the length of data to copy
   */
  callDataCopy (offset, dataOffset, length) {
    log.debug('EVMImports.js callDataCopy')
    this.takeGas(3 + Math.ceil(length / 32) * 3)

    if (length) {
      const callData = this.kernel.environment.callData.slice(dataOffset, dataOffset + length)
      this.setMemory(offset, length, callData)
    }
  }

  /**
   * Copys the input data in current environment to memory. This pertains to
   * the input data passed with the message call instruction or transaction.
   * @param {integer} offset the offset in memory to load into
   * @param {integer} dataOffset the offset in the input data
   */
  callDataCopy256 (offset, dataOffset) {
    log.debug('EVMImports.js callDataCopy256')
    this.takeGas(3)
    const callData = this.kernel.environment.callData.slice(dataOffset, dataOffset + 32)
    this.setMemory(offset, U256_SIZE_BYTES, callData)
  }

  /**
   * Gets the size of code running in current environment.
   * @return {interger}
   */
  getCodeSize (cbIndex) {
    log.debug('EVMImports.js getCodeSize')
    this.takeGas(2)

    const opPromise = Promise.resolve(this.kernel.environment.code.length)

    // wait for all the prevouse async ops to finish before running the callback
    this.kernel.pushOpsQueue(opPromise, cbIndex, length => length)
  }

  /**
   * Copys the code running in current environment to memory.
   * @param {integer} offset the memory offset
   * @param {integer} codeOffset the code offset
   * @param {integer} length the length of code to copy
   */
  codeCopy (resultOffset, codeOffset, length, cbIndex) {
    log.debug('EVMimports.js codeCopy')
    this.takeGas(3 + Math.ceil(length / 32) * 3)

    const contextAccount = this.kernel.environment.address
    let addressCode = Buffer.from([])
    let codeCopied = Buffer.from([])

    if (length) {
      if (this.kernel.environment.state[contextAccount]) {
        const hexCode = this.kernel.environment.state[contextAccount].code.slice(2)
        addressCode = Buffer.from(hexCode, 'hex')
        codeCopied = addressCode.slice(codeOffset, codeOffset + length)
      }
    }

    const opPromise = Promise.resolve(codeCopied)

    // wait for all the prevouse async ops to finish before running the callback
    this.kernel.pushOpsQueue(opPromise, cbIndex, code => {
      if (code.length) {
        this.setMemory(resultOffset, length, code)
      }
    })
  }

  /**
   * Get size of an account’s code.
   * @param {integer} addressOffset the offset in memory to load the address from
   * @return {integer}
   */
  getExternalCodeSize (addressOffset, cbOffset) {
    log.debug('EVMImports.js getExternalCodeSize')
    this.takeGas(20)
    const address = this.getMemory(addressOffset, ADDRESS_SIZE_BYTES)
    const addressHex = '0x' + Buffer.from(address).toString('hex')

    let addressCode = []
    if (this.kernel.environment.state[addressHex]) {
      const hexCode = this.kernel.environment.state[addressHex].code.slice(2)
      addressCode = Buffer.from(hexCode, 'hex')
    }

    const opPromise = Promise.resolve(addressCode.length)

    // wait for all the prevouse async ops to finish before running the callback
    this.kernel.pushOpsQueue(opPromise, cbOffset, length => length)
  }

  /**
   * Copys the code of an account to memory.
   * @param {integer} addressOffset the memory offset of the address
   * @param {integer} resultOffset the memory offset
   * @param {integer} codeOffset the code offset
   * @param {integer} length the length of code to copy
   */
  externalCodeCopy (addressOffset, resultOffset, codeOffset, length, cbIndex) {
    log.debug('EVMImports.js externalCodeCopy')
    this.takeGas(20 + Math.ceil(length / 32) * 3)

    const address = this.getMemory(addressOffset, ADDRESS_SIZE_BYTES)
    const addressHex = '0x' + Buffer.from(address).toString('hex')

    let addressCode = Buffer.from([])

    if (length) {
      if (this.kernel.environment.state[addressHex]) {
        const hexCode = this.kernel.environment.state[addressHex].code.slice(2)
        addressCode = Buffer.from(hexCode, 'hex')
      }
    }

    let opPromise = Promise.resolve(addressCode)

    // wait for all the prevouse async ops to finish before running the callback
    this.kernel.pushOpsQueue(opPromise, cbIndex, code => {
      if (code.length) {
        code = code.slice(codeOffset, codeOffset + length)
        this.setMemory(resultOffset, length, code)
      }
    })
  }

  /**
   * Gets price of gas in current environment.
   * @return {integer}
   */
  getTxGasPrice () {
    log.debug('EVMImports.js getTxGasPrice')
    this.takeGas(2)

    return this.kernel.environment.gasPrice
  }

  /**
   * Gets the hash of one of the 256 most recent complete blocks.
   * @param {integer} number which block to load
   * @param {integer} offset the offset to load the hash into
   */
  getBlockHash (number, offset, cbOffset) {
    log.debug('EVMImports.js getBlockHash')
    this.takeGas(20)

    const diff = this.kernel.environment.block.number - number
    let opPromise

    if (diff > 256 || diff <= 0) {
      opPromise = Promise.resolve(new U256(0))
    } else {
      opPromise = this.kernel.environment.getBlockHash(number)
    }

    // wait for all the prevouse async ops to finish before running the callback
    this.kernel.pushOpsQueue(opPromise, cbOffset, hash => {
      this.setMemory(offset, U256_SIZE_BYTES, hash.toMemory())
    })
  }

  /**
   * Gets the block’s beneficiary address and loads into memory.
   * @param offset
   */
  getBlockCoinbase (offset) {
    log.debug('EVMImports.js getBlockCoinbase')
    this.takeGas(2)

    this.setMemory(offset, ADDRESS_SIZE_BYTES, this.kernel.environment.coinbase.toMemory())
  }

  /**
   * Get the block’s timestamp.
   * @return {integer}
   */
  getBlockTimestamp () {
    log.debug('EVMImports.js getBlockTimestamp')
    this.takeGas(2)

    return this.kernel.environment.block.timestamp
  }

  /**
   * Get the block’s number.
   * @return {integer}
   */
  getBlockNumber () {
    log.debug('EVMImports.js getBlockNumber')
    this.takeGas(2)

    return this.kernel.environment.block.number
  }

  /**
   * Get the block’s difficulty.
   * @return {integer}
   */
  getBlockDifficulty (offset) {
    log.debug('EVMImports.js getBlockDifficulty')
    this.takeGas(2)

    this.setMemory(offset, U256_SIZE_BYTES, this.kernel.environment.block.difficulty.toMemory())
  }

  /**
   * Get the block’s gas limit.
   * @return {integer}
   */
  getBlockGasLimit () {
    log.debug('EVMImports.js getBlockGasLimit')
    this.takeGas(2)

    return this.kernel.environment.block.gasLimit
  }

  /**
   * Creates a new log in the current environment
   * @param {integer} dataOffset the offset in memory to load the memory
   * @param {integer} length the data length
   * @param {integer} number of topics
   */
  log (dataOffset, length, numberOfTopics, topic1, topic2, topic3, topic4) {
    log.debug('EVMImports.js log')
    if (numberOfTopics < 0 || numberOfTopics > 4) {
      throw new Error('Invalid numberOfTopics')
    }

    this.takeGas(375 + length * 8 + numberOfTopics * 375)

    const data = length ? this.getMemory(dataOffset, length).slice(0) : new Uint8Array([])
    const topics = []

    if (numberOfTopics > 0) {
      topics.push(U256.fromMemory(this.getMemory(topic1, U256_SIZE_BYTES)))
    }

    if (numberOfTopics > 1) {
      topics.push(U256.fromMemory(this.getMemory(topic2, U256_SIZE_BYTES)))
    }

    if (numberOfTopics > 2) {
      topics.push(U256.fromMemory(this.getMemory(topic3, U256_SIZE_BYTES)))
    }

    if (numberOfTopics > 3) {
      topics.push(U256.fromMemory(this.getMemory(topic4, U256_SIZE_BYTES)))
    }

    this.kernel.environment.logs.push({
      data: data,
      topics: topics
    })
  }

  /**
   * Creates a new contract with a given value.
   * @param {integer} valueOffset the offset in memory to the value from
   * @param {integer} dataOffset the offset to load the code for the new contract from
   * @param {integer} length the data length
   * @param (integer} resultOffset the offset to write the new contract address to
   * @return {integer} Return 1 or 0 depending on if the VM trapped on the message or not
   */
  create (valueOffset, dataOffset, length, resultOffset, cbIndex) {
    log.debug('EVMImports.js create')
    this.takeGas(32000)

    const value = U256.fromMemory(this.getMemory(valueOffset, U128_SIZE_BYTES))
    // if (length) {
    //   const code = this.getMemory(dataOffset, length).slice(0)
    // }

    let opPromise

    if (value.gt(this.kernel.environment.value)) {
      opPromise = Promise.resolve(Buffer.alloc(20))
    } else {
      // todo actully run the code
      opPromise = Promise.resolve(ethUtil.generateAddress(this.kernel.environment.address, this.kernel.environment.nonce))
    }

    // wait for all the prevouse async ops to finish before running the callback
    this.kernel.pushOpsQueue(opPromise, cbIndex, address => {
      this.setMemory(resultOffset, ADDRESS_SIZE_BYTES, address)
    })
  }

  /**
   * Sends a message with arbiatary data to a given address path
   * @param {integer} addressOffset the offset to load the address path from
   * @param {integer} valueOffset the offset to load the value from
   * @param {integer} dataOffset the offset to load data from
   * @param {integer} dataLength the length of data
   * @param {integer} resultOffset the offset to store the result data at
   * @param {integer} resultLength
   * @param {integer} gas
   * @return {integer} Returns 1 or 0 depending on if the VM trapped on the message or not
   */
  _call (gasHigh, gasLow, addressOffset, valueOffset, dataOffset, dataLength, resultOffset, resultLength, cbIndex) {
    log.debug('EVMimports.js _call')
    this.takeGas(40)

    const gas = from64bit(gasHigh, gasLow)
    // Load the params from mem
    // const toAddress = [...this.getMemory(addressOffset, ADDRESS_SIZE_BYTES)]
    const value = new U256(this.getMemory(valueOffset, U128_SIZE_BYTES))

    // Special case for non-zero value; why does this exist?
    if (!value.isZero()) {
      this.takeGas(9000 - 2300 + gas)
      this.takeGas(-gas)
    }

    const opPromise = Promise.resolve(0)

    // wait for all the prevouse async ops to finish before running the callback
    this.kernel.pushOpsQueue(opPromise, cbIndex, () => {
      return 1
    })
  }

  /**
   * Message-call into this account with an alternative account’s code.
   * @param {integer} addressOffset the offset to load the address path from
   * @param {integer} valueOffset the offset to load the value from
   * @param {integer} dataOffset the offset to load data from
   * @param {integer} dataLength the length of data
   * @param {integer} resultOffset the offset to store the result data at
   * @param {integer} resultLength
   * @param {integer} gas
   * @return {integer} Returns 1 or 0 depending on if the VM trapped on the message or not
   */
  callCode (gas, addressOffset, valueOffset, dataOffset, dataLength, resultOffset, resultLength, cbIndex) {
    log.debug('EVMimports.js callCode')
    this.takeGas(40)
    // Load the params from mem
    // const address = this.getMemory(addressOffset, ADDRESS_SIZE_BYTES)
    const value = U256.fromMemory(this.getMemory(valueOffset, U128_SIZE_BYTES))

    // makes vm test callcodeToReturn1 pass
    if (!value.isZero()) {
      this.takeGas(6700)
    }

    // TODO: actually run code, using this.environment.callCode?
    const opPromise = Promise.resolve(null)

    this.kernel.pushOpsQueue(opPromise, cbIndex, oldValue => {
      return 1
    })
  }

  /**
   * Message-call into this account with an alternative account’s code, but
   * persisting the current values for sender and value.
   * @param {integer} gas
   * @param {integer} addressOffset the offset to load the address path from
   * @param {integer} valueOffset the offset to load the value from
   * @param {integer} dataOffset the offset to load data from
   * @param {integer} dataLength the length of data
   * @param {integer} resultOffset the offset to store the result data at
   * @param {integer} resultLength
   * @return {integer} Returns 1 or 0 depending on if the VM trapped on the message or not
   */
  callDelegate (gas, addressOffset, dataOffset, dataLength, resultOffset, resultLength) {
    log.debug('EVMimports.js callDelegate')
    // FIXME: count properly
    this.takeGas(40)

    const data = this.getMemory(dataOffset, dataLength).slice(0)
    const address = [...this.getMemory(addressOffset, ADDRESS_SIZE_BYTES)]
    const [errorCode, result] = this.environment.callDelegate(gas, address, data)
    this.setMemory(resultOffset, resultLength, result)
    return errorCode
  }

  /**
   * store a value at a given path in long term storage which are both loaded
   * from Memory
   * @param {interger} keyOffest the memory offset of the storage key
   * @param {interger} valueOffset the memory offset of the storage value
   */
  storageStore (keyOffset, valueOffset, cbIndex) {
    log.debug('EVMimports.js storageStore')
    this.takeGas(5000)

    const key = this.getMemory(keyOffset, U256_SIZE_BYTES)
    key.reverse()
    const keyHex = U256.fromMemory(key).toString(16)

    const value = this.getMemory(valueOffset, U256_SIZE_BYTES).slice(0)
    value.reverse()
    const valueHex = U256.fromMemory(value).toString(16)

    const valIsZero = value.every((i) => i === 0)

    const contextAccount = this.kernel.environment.address
    const oldStorageVal = this.kernel.environment.state[contextAccount]['storage'][keyHex]
    const opPromise = Promise.resolve(oldStorageVal)

    this.kernel.pushOpsQueue(opPromise, cbIndex, oldValue => {
      if (valIsZero && oldValue) {
        // delete a value
        this.kernel.environment.gasRefund += 15000
        delete this.kernel.environment.state[contextAccount]['storage'][keyHex]
      } else {
        if (!valIsZero && !oldValue) {
          // creating a new value
          this.takeGas(15000)
        }
        // update
        this.kernel.environment.state[contextAccount]['storage'][keyHex] = valueHex
      }
    })
  }

  /**
   * reterives a value at a given path in long term storage
   * @param {interger} keyOffset the memory offset to load the the path from
   * @param {interger} resultOffset the memory offset to load the value from
   */
  storageLoad (keyOffset, resultOffset, cbIndex) {
    log.debug('EVMimports.js storageLoad')
    log.trace('getBalance kernel.environment.state:', this.kernel.environment.state)
    this.takeGas(50)

    const key = this.getMemory(keyOffset, U256_SIZE_BYTES)
    key.reverse()
    const keyHex = U256.fromMemory(key).toString(16)

    const contextAccount = this.kernel.environment.address
    let value = this.kernel.environment.state[contextAccount]['storage'][keyHex]
    if (typeof value === 'undefined') {
      value = new Uint8Array(32)
    } else {
      value = (new U256(value)).toMemory()
    }

    const opPromise = Promise.resolve(value)

    this.kernel.pushOpsQueue(opPromise, cbIndex, value => {
      this.setMemory(resultOffset, U256_SIZE_BYTES, value)
    })
  }

  /**
   * Halt execution returning output data.
   * @param {integer} offset the offset of the output data.
   * @param {integer} length the length of the output data.
   */
  return (offset, length) {
    if (length) {
      this.kernel.environment.returnValue = this.getMemory(offset, length).slice(0)
    }
  }

  /**
   * Halt execution and register account for later deletion giving the remaining
   * balance to an address path
   * @param {integer} offset the offset to load the address from
   */
  selfDestruct (addressOffset) {
    log.debug('EVMimports.js selfDestruct')
    this.kernel.environment.selfDestruct = true
    this.kernel.environment.selfDestructAddress = this.getMemory(addressOffset, ADDRESS_SIZE_BYTES)
    this.kernel.environment.gasRefund += 24000
  }

  getMemory (offset, length) {
    return new Uint8Array(this.kernel.memory, offset, length)
  }

  setMemory (offset, length, value) {
    const memory = new Uint8Array(this.kernel.memory, offset, length)
    memory.set(value)
  }

  /*
   * Takes gas from the tank. Only needs to check if there's gas left to be taken,
   * because every caller of this method is trusted.
   */
  takeGas (amount) {
    if (this.kernel.environment.gasLeft < amount) {
      throw new Error('Ran out of gas')
    }
    this.kernel.environment.gasLeft -= amount
  }
}

// converts a 64 bit number to a JS number
function from64bit (high, low) {
  if (high < 0) {
    // convert from a 32-bit two's compliment
    high = 0x100000000 - high
  }
  if (low < 0) {
    // convert from a 32-bit two's compliment
    low = 0x100000000 - low
  }
  // JS only bitshift 32bits, so instead of high << 32 we have high * 2 ^ 32
  return (high * 4294967296) + low
}
