import { Filter, FilterResult } from './pool-filters';
import { Connection } from '@solana/web3.js';
import { LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
import { getPdaMetadataKey } from '@raydium-io/raydium-sdk';
import { MetadataAccountData, MetadataAccountDataArgs } from '@metaplex-foundation/mpl-token-metadata';
import { Serializer } from '@metaplex-foundation/umi/serializers';
import { logger } from '../helpers';

export class MutableFilter implements Filter {
  private readonly errorMessage: string[] = [];

  constructor(
    private readonly connection: Connection,
    private readonly metadataSerializer: Serializer<MetadataAccountDataArgs, MetadataAccountData>,
    private readonly checkMutable: boolean,
  ) {
    if (this.checkMutable) {
      this.errorMessage.push('mutable');
    }
  }

  async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
    try {
      const metadataPDA = getPdaMetadataKey(poolKeys.baseMint);
      const metadataAccount = await this.connection.getAccountInfo(metadataPDA.publicKey, 
this.connection.commitment);

      if (!metadataAccount?.data) {
        return { ok: false, message: 'Mutable -> Failed to fetch account data' };
      }

      const deserialize = this.metadataSerializer.deserialize(metadataAccount.data);
      const mutable = this.checkMutable && deserialize[0].isMutable;

      if (!mutable) {
        return { ok: true, message: undefined };
      }
      
    } catch (e) {
      logger.error({ mint: poolKeys.baseMint }, `Mutable -> Failed to check 
${this.errorMessage.join(' and ')}`);
    }

    
    return { ok: false, message: "Mutable -> Metadata can be changed" };
    
  }
}
