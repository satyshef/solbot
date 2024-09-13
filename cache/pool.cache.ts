import { LiquidityStateV4 } from '@raydium-io/raydium-sdk';
import { PublicKey } from '@solana/web3.js';
import { logger } from '../helpers';

export class PoolCache {
  private readonly keys: Map<string, { id: string; minter: string | undefined ; state: LiquidityStateV4 }> = new Map<
    string,
    { id: string; minter: string; state: LiquidityStateV4 }
  >();

  public save(id: string, minter: string | undefined, state: LiquidityStateV4) {
    if (!this.keys.has(state.baseMint.toString())) {
      logger.trace(`Caching new pool for mint: ${state.baseMint.toString()}`);
      this.keys.set(state.baseMint.toString(), { id, minter, state });
    }
  }

  public async get(mint: string): Promise<{ id: string; minter:string | undefined; state: LiquidityStateV4 }> {
    return this.keys.get(mint)!;
  }

  public modifyOwner(id: string, owner: PublicKey): boolean {
    for (let [key, value] of this.keys.entries()) {
      if (value.id === id) {
        const updatedState = {
          ...value.state,
          owner: owner
        };

        this.keys.set(key, {
          ...value,
          state: updatedState
        });
        return true; 
      }
    }

    logger.warn(`Pool with id: ${id} not found`);
    return false; 
  }

  public modify(id: string, minter: string | undefined): boolean {
    // Найдем объект по id
    for (let [key, value] of this.keys.entries()) {
      if (value.id === id) {
        this.keys.set(key, {
          ...value,
          minter: minter
        });
        return true; 
      }
    }

    logger.warn(`Pool with id: ${id} not found`);
    return false; 
  }
}
