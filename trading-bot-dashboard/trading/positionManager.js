export class PositionManager {
  constructor(config) {
    this.config = config;
    this.positions = new Map();
  }

  async openPosition(token, entryPrice, amount) {
    if (this.positions.size >= this.config.trading.maxOpenPositions) {
      return null;
    }

    const position = {
      token,
      entryPrice,
      amount,
      stopLoss: entryPrice * (1 - this.config.trading.stopLoss / 100),
      takeProfit: entryPrice * (1 + this.config.trading.takeProfit / 100),
      openTime: Date.now()
    };

    this.positions.set(token, position);
    return position;
  }

  async checkPositions(currentPrices) {
    const closedPositions = [];

    for (const [token, position] of this.positions.entries()) {
      const currentPrice = currentPrices.get(token);
      
      if (!currentPrice) continue;

      if (currentPrice <= position.stopLoss || currentPrice >= position.takeProfit) {
        const profit = (currentPrice - position.entryPrice) * position.amount;
        closedPositions.push({
          token,
          entryPrice: position.entryPrice,
          exitPrice: currentPrice,
          profit,
          holdingTime: Date.now() - position.openTime
        });

        this.positions.delete(token);
      }
    }

    return closedPositions;
  }

  getOpenPositions() {
    return Array.from(this.positions.values());
  }
}
