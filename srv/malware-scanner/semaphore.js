class Semaphore {
  constructor(max) {
    this._max = max
    this._current = 0
    this._queue = []
  }

  acquire() {
    if (this._current < this._max) {
      this._current++
      return Promise.resolve()
    }
    return new Promise((resolve) => this._queue.push(resolve))
  }

  release() {
    if (this._queue.length > 0) {
      const next = this._queue.shift()
      next()
    } else {
      this._current--
    }
  }
}

module.exports = Semaphore
