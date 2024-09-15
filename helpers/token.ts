import { Token } from '@raydium-io/raydium-sdk';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, Connection, VersionedTransactionResponse} from '@solana/web3.js';
import { logger } from './logger';


export function getToken(token: string) {
  switch (token) {
    case 'WSOL': {
      return Token.WSOL;
    }
    case 'USDC': {
      return new Token(
        TOKEN_PROGRAM_ID,
        new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        6,
        'USDC',
        'USDC',
      );
    }
    default: {
      throw new Error(`Unsupported quote mint "${token}". Supported values are USDC and WSOL`);
    }
  }
}

export async function getTokenTransactions(connection: Connection, account: PublicKey): Promise<VersionedTransactionResponse[] | undefined> {
  try {
      // Получение списка подписанных транзакций для указанного аккаунта
      const confirmedSignatures = await connection.getSignaturesForAddress(account);

      // Получение детализированной информации по каждой транзакции
      const transactions = [];
      for (const signatureInfo of confirmedSignatures) {
          const transaction = await connection.getTransaction(signatureInfo.signature, {
            maxSupportedTransactionVersion: 0,
          });
          if (transaction) {
              transactions.push(transaction);
          }
      }

      return transactions;
  } catch (error) {
      console.error("Ошибка при получении транзакций: ", error);
  }

  return undefined;
}


export async function getMintInfo(connection: Connection, accountId: PublicKey): Promise<string | undefined>{
  //logger.trace(`LP token: ${poolKeys.lpMint}`);
  //const transactions
  //const transactions: VersionedTransactionResponse[] | undefined
  const transactions =  await getTokenTransactions(connection, accountId)
  
  if (transactions == undefined){
    return undefined;
  }

  
  const transaction: VersionedTransactionResponse = transactions[0];

  if (
    transaction.meta != undefined &&
    transaction.meta.preTokenBalances != null
  ){
    if (transaction.meta.preTokenBalances.length > 1 ){
      return transaction.meta.preTokenBalances[1].owner;
    }

    logger.error(transaction.meta);

  }
  return undefined;
  
}

