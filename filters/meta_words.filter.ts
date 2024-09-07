import { Filter, FilterResult } from './pool-filters';
import { Connection } from '@solana/web3.js';
import { LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
import { getPdaMetadataKey } from '@raydium-io/raydium-sdk';
import { MetadataAccountData, MetadataAccountDataArgs } from '@metaplex-foundation/mpl-token-metadata';
import { Serializer } from '@metaplex-foundation/umi/serializers';
import { logger } from '../helpers';

export class MetaWordsFilter implements Filter {
  private readonly errorMessage: string[] = [];

  constructor(
    private readonly connection: Connection,
    private readonly metadataSerializer: Serializer<MetadataAccountDataArgs, MetadataAccountData>,
    private readonly checkWords: string[],
  ) {
    if (this.checkWords) {
      this.errorMessage.push('metawords');
    }
  }

  async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
    try {
      const metadataPDA = getPdaMetadataKey(poolKeys.baseMint);
      const metadataAccount = await this.connection.getAccountInfo(metadataPDA.publicKey, 
this.connection.commitment);

      if (!metadataAccount?.data) {
        return { ok: false, message: 'MetaWords -> Failed to fetch account data' };
      }

      const checkRisk = await this.checkRisk(poolKeys.lpMint.toString());
      if (checkRisk) {
        return { ok: true, message: "undefined" };
      }

      const deserialize = this.metadataSerializer.deserialize(metadataAccount.data);
      const hasWords = await this.hasWords(deserialize[0]);
      if (hasWords) {
        return { ok: true, message: undefined };
      }

    } catch (e) {
      logger.error({ mint: poolKeys.baseMint }, `MetaWords -> ${e}`);
    }

    return { ok: false, message: 'MetaWords -> Failed to check metadata words' };

  }


  private async checkRisk(mint: String) {
    try {
      const url = `https://api.rugcheck.xyz/v1/tokens/${mint}/report`;
      //const url = `https://tokens.jup.ag/token/${mint}`
      const response = await fetch(url);
      if (!response.ok) {
        logger.error(`Fetch ${ url } error ${ response.status }`);
      } 
      
      const data = await response.json()
      if (data != null ) {
        logger.trace(`OWNER : ${ data.topHolders[0].owner}`)
        if (data.topHolders[0].owner == "9YJPtYy1qd77ng1VdwKC52VenweyL5uULRWzu95fUJjg"){
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


  private async hasWords(metadata: MetadataAccountData) {
    //logger.trace(`URL ${metadata.uri}`);
    const response = await fetch(metadata.uri);
    if (!response.ok) {
      logger.error(`Fetch ${ metadata.uri } error ${ response.status }`);
      return false;
    }

    const responseText: string = await response.text();
      
    console.log(responseText);
  
    for (let i = 0; i < this.checkWords.length; i++) {
        const regex = new RegExp(this.checkWords[i].split('').join('\\s*'), 'gi');
        const matches = responseText.match(regex);
        if (!matches) {
          return false;
          //console.log("FOUND : ",this.checkWords[i]);
        }
    }
    
    return true;
  }



  private async hasSocials1(metadata: MetadataAccountData) {
    //logger.trace(`URL ${metadata.uri}`);
    const response = await fetch(metadata.uri);
    const data = await response.json();
    logger.trace(JSON.stringify(data));

    if ("extensions" in data) {
      let ext = data["extensions"];
      if ("twitter" in ext && ext["twitter"] != "null" && "telegram" in ext && ext["telegram"] != "null" && "website" in ext && ext["website"] != "null") {
        return true;
      }  
    } else {
      if ("twitter" in data && "telegram" in data && "website" in data) {
        return true;
      }  
    }
    

    return false;
    //return Object.values(data?.extensions ?? {}).some((value: any) => value !== null && value.length > 0);
  }
}
