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
      const metadataAccount = await this.connection.getAccountInfo(
                                        metadataPDA.publicKey, 
                                        this.connection.commitment
                                    );

      if (!metadataAccount?.data) {
        return { ok: false, message: 'MetaWords -> Failed to fetch account data' };
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


  private async hasWords(metadata: MetadataAccountData) {
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
