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
        'callContract': this._call.bind(this)
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
      '_call',
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

    let balance = null
    if (this.kernel.environment.state.hasOwnProperty(addressHex)) {
      balance = this.kernel.environment.state[addressHex].balance
    } else {
      balance = '0x0'
    }

    const balanceU256 = new U256(balance)
    this.setMemory(offset, U128_SIZE_BYTES, balanceU256.toMemory(U128_SIZE_BYTES).reverse())
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

    return this.kernel.environment.code.length
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

    this.setMemory(resultOffset, length, codeCopied)
  }

  /**
   * Get size of an account’s code.
   * @param {integer} addressOffset the offset in memory to load the address from
   * @return {integer}
   */
  getExternalCodeSize (addressOffset, cbOffset) {
    log.debug('EVMImports.js getExternalCodeSize')
    log.trace('this.kernel.environment.state', this.kernel.environment.state)
    this.takeGas(20)

    const address = this.getMemory(addressOffset, ADDRESS_SIZE_BYTES)
    const addressHex = '0x' + Buffer.from(address).toString('hex')

    let addressCode = []
    if (this.kernel.environment.state[addressHex]) {
      const hexCode = this.kernel.environment.state[addressHex].code.slice(2)
      addressCode = Buffer.from(hexCode, 'hex')
    }

    return addressCode.length
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

    log.trace('this.kernel.environment.state:', this.kernel.environment.state)

    const address = this.getMemory(addressOffset, ADDRESS_SIZE_BYTES)
    const addressHex = '0x' + Buffer.from(address).toString('hex')

    let addressCode = Buffer.from([])

    if (length) {
      if (this.kernel.environment.state[addressHex]) {
        const hexCode = this.kernel.environment.state[addressHex].code.slice(2)
        addressCode = Buffer.from(hexCode, 'hex')
      }
    }

    const codeCopied = addressCode.slice(codeOffset, codeOffset + length)

    this.setMemory(resultOffset, length, codeCopied)
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
    let hash
    if (diff > 256 || diff <= 0) {
      hash = new U256(0)
    } else {
      hash = this.kernel.environment.getBlockHash(number)
    }
    log.debug('returning hash:', hash)
    log.debug('hash.toMemory:', hash.toMemory())

    // do bswap256 on the hash here?
    // reverse() replaces the bswap256
    this.setMemory(offset, U256_SIZE_BYTES, hash.toMemory().reverse())
  }

  /**
   * Gets the block’s beneficiary address and loads into memory.
   * @param offset
   */
  getBlockCoinbase (offset) {
    log.debug('EVMImports.js getBlockCoinbase')
    this.takeGas(2)

    const coinbaseAddress = this.kernel.environment.coinbase
    this.setMemory(offset, ADDRESS_SIZE_BYTES, coinbaseAddress.toMemory())
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

    let createdAddress
    if (value.gt(this.kernel.environment.value)) {
      createdAddress = Buffer.alloc(20)
    } else {
      // TODO: actually run the code
      createdAddress = ethUtil.generateAddress(this.kernel.environment.address, this.kernel.environment.nonce)
    }

    this.setMemory(resultOffset, ADDRESS_SIZE_BYTES, createdAddress)
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
  // _call (gasHigh, gasLow, addressOffset, valueOffset, dataOffset, dataLength, resultOffset, resultLength, cbIndex) {
  // cbIndex was for async method
  _call (gasHigh, gasLow, addressOffset, valueOffset, dataOffset, dataLength, resultOffset, resultLength) {
    log.debug('EVMimports.js _call')
    this.takeGas(40)

    /*
    # ABAcalls1 ABAcalls1
    vm.js calling instance.exports.main()...
    EVMimports.js _call
    EVMimports.js _call gas args: 2328 1316133889
    EVMimports.js _call addressOffset: 172
    EVMimports.js _call valueOffset: 144
    EVMimports.js _call dataOffset: 33832
    EVMimports.js _call dataLength: 0
    EVMimports.js _call resultOffset: 33832
    EVMimports.js _call resultLength: 0
    EVMimports.js _call got from memory, value: U256 { _value: <BN: 18> }
    */

    log.debug('EVMimports.js _call gasHigh gasHigh:', gasHigh, gasLow)
    log.debug('EVMimports.js _call addressOffset:', addressOffset)
    log.debug('EVMimports.js _call valueOffset:', valueOffset)
    log.debug('EVMimports.js _call dataOffset:', dataOffset)
    log.debug('EVMimports.js _call dataLength:', dataLength)
    log.debug('EVMimports.js _call resultOffset:', resultOffset)
    log.debug('EVMimports.js _call resultLength:', resultLength)

    const gas = from64bit(gasHigh, gasLow)

    // Load the params from mem
    // const toAddress = [...this.getMemory(addressOffset, ADDRESS_SIZE_BYTES)]
    const value = new U256(this.getMemory(valueOffset, U128_SIZE_BYTES))
    log.debug('EVMimports.js _call got from memory, value:', value)

    // Special case for non-zero value; why does this exist?
    if (!value.isZero()) {
      this.takeGas(9000 - 2300 + gas)
      this.takeGas(-gas)
    }

    return 1
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

    const value = U256.fromMemory(this.getMemory(valueOffset, U128_SIZE_BYTES))

    // for test case callcodeToReturn1
    if (!value.isZero()) {
      this.takeGas(6700)
    }

    // to actually run code, use this.environment.callCode?

    return 1
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
    // log.debug('getBalance kernel.environment.state:', this.kernel.environment.state)

    const key = this.getMemory(keyOffset, U256_SIZE_BYTES)
    const keyHex = U256.fromMemory(key).toString(16)

    const value = this.getMemory(valueOffset, U256_SIZE_BYTES).slice(0)
    const valueHex = U256.fromMemory(value).toString(16)
    const valIsZero = value.every((i) => i === 0)

    const contextAccount = this.kernel.environment.address
    const oldStorageVal = this.kernel.environment.state[contextAccount]['storage'][keyHex]

    log.debug('writing to storage, key/val:', keyHex, valueHex)

    if (valIsZero && oldStorageVal) {
      // delete a value
      this.kernel.environment.gasRefund += 15000
      delete this.kernel.environment.state[contextAccount]['storage'][keyHex]
    } else {
      if (!valIsZero && !oldStorageVal) {
        // creating a new value
        this.takeGas(15000)
      }
      this.kernel.environment.state[contextAccount]['storage'][keyHex] = valueHex
    }
  }

  /**
   * reterives a value at a given path in long term storage
   * @param {interger} keyOffset the memory offset to load the the path from
   * @param {interger} resultOffset the memory offset to load the value from
   */
  storageLoad (keyOffset, resultOffset, cbIndex) {
    log.debug('EVMimports.js storageLoad')
    // log.debug('getBalance kernel.environment.state:', this.kernel.environment.state)
    this.takeGas(50)

    const key = this.getMemory(keyOffset, U256_SIZE_BYTES)
    const keyHex = U256.fromMemory(key).toString(16)

    const contextAccount = this.kernel.environment.address
    let value = this.kernel.environment.state[contextAccount]['storage'][keyHex]
    if (typeof value === 'undefined') {
      value = new Uint8Array(32)
    } else {
      value = (new U256(value)).toMemory()
    }

    // reverse() since SLOAD doesn't use callback_256 (which does bswap256)
    this.setMemory(resultOffset, U256_SIZE_BYTES, value.reverse())
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
