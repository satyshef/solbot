import { Filter, FilterResult } from './pool-filters';
import { Connection, TransactionInstruction } from '@solana/web3.js';
import { LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
import { logger, getTokenTransactions } from '../helpers';


export class MintersFilter implements Filter {
  
  private readonly errorMessage: string[] = [];

  constructor(
    private readonly connection: Connection,
    private readonly mintersList: string[],
  ) {}

  async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
    try {
  
      const minter = await this.getMintInfo(poolKeys);
      logger.trace(`Minter : ${ minter }`);
      if (minter == undefined){
        return { ok: false, message: "CheckMinters -> Failed get LP token owner" };
      }

      for (let i = 0; i < this.mintersList.length; i++) {
        if (this.mintersList[i] == minter) {
          return { ok: true, message: undefined};
        }
      }

      return { ok: false, message: "CheckMinters -> Minter not found" };

    } catch (e: any) {
        logger.error(
            { mint: poolKeys.baseMint },
            `CheckMarkets -> Failed to check ${this.errorMessage.join(' and ')}`,
          );
    }
    
    return { ok: false, message: 'Failed to check markets' };
  }


  private async getMintInfo(poolKeys: LiquidityPoolKeysV4): Promise<String | undefined>{
    logger.trace(`LP token: ${poolKeys.lpMint}`);
    return getTokenTransactions(this.connection, poolKeys.lpMint).then((transactions) => {
      if (
        transactions != null &&
        transactions[0].meta != undefined &&
        transactions[0].meta.preTokenBalances != null
      ){
        return transactions[0].meta.preTokenBalances[1].owner
      }
      return undefined;
    });
    

    // && transactions[0].meta.preTokenBalances[1] != null
  }

  private async checkRisk(mint: String) {
    try {
      // 1
      //const mintOwner = "9YJPtYy1qd77ng1VdwKC52VenweyL5uULRWzu95fUJjg"
      // 2
      const mintOwner = "VLgFg159e7gD8hHB6k8PRAAPoX9nTRTaysuXQ5CUJjg";

      const url = `https://api.rugcheck.xyz/v1/tokens/${mint}/report`;
      //const url = `https://tokens.jup.ag/token/${mint}`
      const response = await fetch(url);
      if (!response.ok) {
        logger.error(`Fetch ${ url } error ${ response.status }`);
      } 
      
      const data = await response.json()
      if (data != null ) {
        logger.trace(`OWNER : ${ data.topHolders[0].owner}`)
        if (data.topHolders[0].owner == mintOwner){
          return true;
        }
      /*
      if ('markets' in data && data.markets != null ) {
        //console.log(`Markets : ${data.markets}`);
       
        logger.trace(`Markets : ${data.markets[0].marketType}`);
        logger.trace('Mint account :', data.markets[0].mintLPAccount.mintAuthority);
        if ('lp' in data.markets[0] && 'holders' in data.markets[0].lp) {
          logger.trace('Owner :', data.markets[0].lp.holders[0].owner);
        }

        logger.trace('*******************************');
        */
        
      } else {
        logger.trace('Markets : NULL');
      }

    } catch (error) {
      logger.error('Check risk error:', error);
    }

    return false;

  }

}
