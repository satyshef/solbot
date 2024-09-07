import { Filter, FilterResult } from './pool-filters';
import { Connection } from '@solana/web3.js';
import { LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
import { logger } from '../helpers';

const MARKET_YUPITER: string = "jupiter";

export class MarketFilter implements Filter {
  
  private readonly errorMessage: string[] = [];

  constructor(
    private readonly marketList: string[],
  ) {
    if (this.marketList) {
      this.errorMessage.push('markets list');
    }
  }

  async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
    try {
        let ok: boolean = true; 
        const message: string[] = [];

        if (this.marketList.includes(MARKET_YUPITER)) {
            const isHasJupiter = await this.hasJupiter(poolKeys.baseMint.toString());
            if (!isHasJupiter) {
                ok = false;
                message.push('jupiter not mint');
                //return { ok: false, message: 'CheckMarkets -> Failed to fetch jupiter market' };
            }
        }
 
        return { ok: ok, message: ok ? undefined : `CheckMarkets -> Market ${message.join(' and ')}` };
    } catch (e: any) {
        logger.error(
            { mint: poolKeys.baseMint },
            `CheckMarkets -> Failed to check ${this.errorMessage.join(' and ')}`,
          );
    }
    
    return { ok: false, message: 'Failed to check markets' };
  }

  private async hasJupiter(mint: String) {
    const url = 'https://tokens.jup.ag/token/' + mint;
    const response = await fetch(url);
    const responseText: string = await response.text();

    if (!response.ok || responseText == "null") {
      return false;      
    }
    return true;
  }
}
