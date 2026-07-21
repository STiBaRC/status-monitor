/**
 * @typedef {SuccessResult | FailureResult} Result
 */

/**
 * @typedef {Object} SuccessResult
 * @property {true} success
 * @property {number} latency
 */

/**
 * @typedef {Object} FailureResult
 * @property {false} success
 * @property {string?} errorCode
 */