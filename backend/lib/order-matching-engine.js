// heapify on startup

const Transaction = require('./transaction');

const parent = (i) => Math.floor(((i - 1) / 2));
const left = (i) => (2 * i) + 1;
const right = (i) => (2 * i) + 2;

function exchangeRateAsk(a) {
  return a.targetAmount / a.sourceAmount;
}

function exchangeRateBid(a) {
  return a.sourceAmount / a.targetAmount;
}

function compareTime(a, b) {
  return Math.sign(b.timestamp - a.timestamp);
}

function compareExchangeRateAndTime(a, b) {
  const exchangeRateA = exchangeRateBid(a);
  const exchangeRateB = exchangeRateBid(b);
  if (exchangeRateA === exchangeRateB) {
    return compareTime(a, b);
  }
  return Math.sign(exchangeRateB - exchangeRateA);
}
exports.compareExchangeRateAndTime = compareExchangeRateAndTime;

class OrderMatchingEngine {
  constructor(targetToken, sourceToken, db, getBlockNumber, compareFunc) {
    this.compareFunc = compareFunc;
    if (!this.compareFunc) {
      this.compareFunc = compareExchangeRateAndTime;
    }
    this.targetToken = targetToken;
    this.sourceToken = sourceToken;
    this.allOrders = db;
    this.getBlockNumber = getBlockNumber;
    this.bids = [];
    this.asks = [];
    this.heapifyOrders();
  }

  heapifyOrders() {
    for (let i = 0; i < this.allOrders.length; i++) {
      if (this.allOrders[i].sourceToken === this.sourceToken &&
        this.allOrders[i].targetToken === this.targetToken) {
        this.push(this.bids, this.allOrders[i]);
      } else if (this.allOrders[i].sourceToken === this.targetToken &&
        this.allOrders[i].targetToken === this.sourceToken) {
        this.push(this.asks, this.allOrders[i]);
      }
    }
  }

  isExchangeRatesGreater(ask, bid) {
    if (!ask || !bid) {
      return false;
    }
    return exchangeRateBid(bid) >= exchangeRateAsk(ask);
  }

  isNonZeroOrder(order) {
    if (!order || order.targetAmount <= 0 || order.sourceAmount <= 0) {
      return false;
    }
    return true;
  }

  async matchOrders() {
    const transactions = [];
    /* eslint-disable no-await-in-loop */
    while (this.isExchangeRatesGreater(await this.peek(this.asks),
                                       await this.peek(this.bids))) {
      const askToExecute = await this.pop(this.asks);
      while (this.isExchangeRatesGreater(askToExecute, await this.peek(this.bids)) && this.isNonZeroOrder(askToExecute)) {

        const bidToExecute = await this.pop(this.bids);
        if (bidToExecute.targetAmount <= askToExecute.sourceAmount && this.isNonZeroOrder(bidToExecute)) {
          // keep ask rate constant and allow bid rate to change
          bidToExecute.sourceAmount = bidToExecute.targetAmount * exchangeRateAsk(askToExecute);
          askToExecute.targetAmount -= bidToExecute.targetAmount * exchangeRateAsk(askToExecute);
          askToExecute.sourceAmount -= bidToExecute.targetAmount;
          transactions.push(this.makeTransaction(bidToExecute, askToExecute));
          bidToExecute.targetAmount = 0;

          if (this.isNonZeroOrder(bidToExecute)) {
            this.push(this.bids, bidToExecute);
          }
        } else if (bidToExecute.sourceAmount > askToExecute.targetAmount, this.isNonZeroOrder(bidToExecute)) {
          transactions.push(this.makeTransaction(askToExecute, bidToExecute));
          bidToExecute.sourceAmount -= askToExecute.targetAmount;
          bidToExecute.targetAmount -= askToExecute.sourceAmount;
          askToExecute.sourceAmount = 0;
          if (this.isNonZeroOrder(bidToExecute)) {
            this.push(this.bids, bidToExecute);
          }
        }
      }
    }
    return transactions;
  }

  makeTransaction(buyOrder, sellOrder) {
    return new Transaction(
      buyOrder._id,
      sellOrder._id,
      buyOrder.address,
      sellOrder.address,
      buyOrder.sourceToken,
      buyOrder.targetToken,
      Math.round(buyOrder.sourceAmount),
      Math.round(buyOrder.targetAmount),
      buyOrder.expiry,
      sellOrder.expiry
    );
  }

  // all the auxiliary heap functions
  size(side) {
    return side.length;
  }

  isEmpty(side) {
    return side.length === 0;
  }

  async peek(side) {
    const val = side[0];
    const blockNumber = await this.getBlockNumber();
    if (val && val.expiry && val.expiry < blockNumber) {
      await this.pop(side, false);
      return this.peek(side);

    }
    return val;
  }

  push(side, ...values) {
    values.forEach((value) => {
      side.push(value);
      this._siftUp(side);
    });
    return this.size(side);
  }

  async pop(side, retry = true) {
    if (this.isEmpty(side)) {
      return null;
    }
    const poppedVal = side[0];
    const bottom = this.size(side) - 1;
    if (bottom > 0) {
      this._swap(side, 0, bottom);
    }
    side.pop();
    this._siftDown(side);
    const blockNumber = await this.getBlockNumber();
    if (poppedVal.expiry && poppedVal.expiry < blockNumber && retry) {
      return this.pop(side, retry);
    }
    return poppedVal;
  }

  _greater(side, i, j) {
    return this.compareFunc(side[i], side[j]) <= 0;
  }

  _swap(side, i, j) {
    [side[i], side[j]] = [side[j], side[i]];
  }

  _siftUp(side) {
    let node = this.size(side) - 1;
    while (node > 0 && this._greater(side, node, parent(node))) {
      this._swap(side, node, parent(node));
      node = parent(node);
    }
  }

  _siftDown(side) {
    let node = 0;

    while (
      (left(node) < this.size(side) && this._greater(side, left(node), node)) ||
      (right(node) < this.size(side) && this._greater(side, right(node), node))) {
      const maxChild = (right(node) < this.size(side) && this._greater(side, right(node), left(node))) ? right(node) : left(node);
      this._swap(side, node, maxChild);
      node = maxChild;
    }
  }
}

exports.OrderMatchingEngine = OrderMatchingEngine;
