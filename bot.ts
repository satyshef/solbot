import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
  RawAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Liquidity, LiquidityPoolKeysV4, LiquidityStateV4, Percent, Token, TokenAmount, CurrencyAmount, LiquidityComputeAmountOutParams } from '@raydium-io/raydium-sdk';
import { MarketCache, PoolCache, SnipeListCache } from './cache';
import { PoolFilters } from './filters';
import { TransactionExecutor } from './transactions';
import { createPoolKeys, logger, NETWORK, sleep } from './helpers';
import { Mutex } from 'async-mutex';
import BN from 'bn.js';
import { WarpTransactionExecutor } from './transactions/warp-transaction-executor';
import { JitoTransactionExecutor } from './transactions/jito-rpc-transaction-executor';
//import { sendTelegramMessage } from './helpers/telegram';
import { saveToFile } from './helpers/file';
import path from 'path';
import { Worker } from 'worker_threads';

export interface BotConfig {
  wallet: Keypair;
  checkRenounced: boolean;
  checkFreezable: boolean;
  checkBurned: boolean;
  checkMinters: boolean;
  marketList: string[];
  minPoolSize: TokenAmount;
  maxPoolSize: TokenAmount;
  quoteToken: Token;
  quoteAmount: TokenAmount;
  quoteAta: PublicKey;
  oneTokenAtATime: boolean;
  useSnipeList: boolean;
  autoSell: boolean;
  autoBuy: boolean;
  simulationSell: boolean;
  autoBuyDelay: number;
  autoSellDelay: number;
  maxBuyRetries: number;
  maxSellRetries: number;
  unitLimit: number;
  unitPrice: number;
  takeProfit: number;
  stopLoss: number;
  buySlippage: number;
  sellSlippage: number;
  priceCheckInterval: number;
  priceCheckDuration: number;
  filterCheckInterval: number;
  filterCheckDuration: number;
  consecutiveMatchCount: number;
  checkWords: string[];
  telegramNotification: boolean,
  telegramBotToken: string,
  telegramChatID: string,
}

export class Bot {
  private readonly poolFilters: PoolFilters;

  private pressSpace: boolean = false;

  // snipe list
  private readonly snipeListCache?: SnipeListCache;

  // one token at the time
  private readonly mutex: Mutex;
  private sellExecutionCount = 0;
  public readonly isWarp: boolean = false;
  public readonly isJito: boolean = false;

  //private tgWorker: Worker | undefined;
  private tgWorker = new Worker(path.resolve(__dirname, './helpers/telegram.ts'), {
    execArgv: ['-r', 'ts-node/register'], 
  });

  constructor(
    private readonly connection: Connection,
    private readonly marketStorage: MarketCache,
    private readonly poolStorage: PoolCache,
    private readonly txExecutor: TransactionExecutor,
    readonly config: BotConfig,
  ) {

    /*
   
    const this.tgWorker = new Worker(path.resolve(__dirname, './helpers/tg.ts'), {
      execArgv: ['-r', 'ts-node/register'], // Подключаем ts-node для worker'а
    });
    */

    this.isWarp = txExecutor instanceof WarpTransactionExecutor;
    this.isJito = txExecutor instanceof JitoTransactionExecutor;

    this.mutex = new Mutex();
    this.poolFilters = new PoolFilters(connection, {
      quoteToken: this.config.quoteToken,
      minPoolSize: this.config.minPoolSize,
      maxPoolSize: this.config.maxPoolSize,
    });

    if (this.config.useSnipeList) {
      this.snipeListCache = new SnipeListCache();
      this.snipeListCache.init();
    }
  }

  async validate() {
    try {
      await getAccount(this.connection, this.config.quoteAta, this.connection.commitment);
    } catch (error) {
      logger.error(
        `${this.config.quoteToken.symbol} token account not found in wallet: ${this.config.wallet.publicKey.toString()}`,
      );
      return false;
    }

    return true;
  }

  public async buy(accountId: PublicKey, poolState: LiquidityStateV4): Promise<Boolean> {
    logger.trace({ mint: poolState.baseMint }, `Processing new pool...`);
    //this.getMintInfo(poolState)

    //if (this.config.useSnipeList && !this.snipeListCache?.isInList(poolState.baseMint.toString())) {
    if (this.config.useSnipeList && !this.snipeListCache?.isInList(poolState.owner.toString())) {
      logger.debug({ mint: poolState.baseMint.toString() }, `Skipping buy because token is not in a snipe list`);
      return false;
    }

    if (this.config.autoBuyDelay > 0) {
      logger.debug({ mint: poolState.baseMint }, `Waiting for ${this.config.autoBuyDelay} ms before buy`);
      await sleep(this.config.autoBuyDelay);
    }

    if (this.config.oneTokenAtATime) {
      if (this.mutex.isLocked() || this.sellExecutionCount > 0) {
        logger.debug(
          { mint: poolState.baseMint.toString() },
          `Skipping buy because one token at a time is turned on and token is already being processed`,
        );
        return false;
      }

      await this.mutex.acquire();
    }

    let success = false;

    try {
      const [market, mintAta] = await Promise.all([
        this.marketStorage.get(poolState.marketId.toString()),
        getAssociatedTokenAddress(poolState.baseMint, this.config.wallet.publicKey),
      ]);
      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(accountId, poolState, market);

      
      if (!this.config.useSnipeList) {
        const match = await this.filterMatch(poolKeys);

        if (!match) {
          logger.trace({ mint: poolKeys.baseMint.toString() }, `Skipping buy because pool doesn't match filters`);
          return false;
        }
      }

      if (!this.config.autoBuy) {
        logger.trace("Skip autobuy");
        return true;
      }

      for (let i = 0; i < this.config.maxBuyRetries; i++) {
        try {
          logger.info(
            { mint: poolState.baseMint.toString() },
            `Send buy transaction attempt: ${i + 1}/${this.config.maxBuyRetries}`,
          );
          const tokenOut = new Token(TOKEN_PROGRAM_ID, poolKeys.baseMint, poolKeys.baseDecimals);
          const result = await this.swap(
            poolKeys,
            this.config.quoteAta,
            mintAta,
            this.config.quoteToken,
            tokenOut,
            this.config.quoteAmount,
            this.config.buySlippage,
            this.config.wallet,
            'buy',
          );

          
          if (result.confirmed) {
            const solurl = `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`

            if (this.config.telegramNotification) {
              const message = `#BUY\n\n${ poolState.baseMint.toString() }\n\n${ solurl }`
              //await sendTelegramMessage(this.config.telegramChatID, this.config.telegramBotToken, message)
              this.tgWorker.postMessage({ chatID: this.config.telegramChatID, token: this.config.telegramBotToken, message: message });
            }
            logger.info(
              {
                mint: poolState.baseMint.toString(),
                signature: result.signature,
                url: solurl,
              },
              `Confirmed buy tx`,
            );
            success = true;
            break;
          }
          
          logger.info(
            {
              mint: poolState.baseMint.toString(),
              signature: result.signature,
              error: result.error,
            },
            `Error confirming buy tx`,
          );
        } catch (error) {
          logger.debug({ mint: poolState.baseMint.toString(), error }, `Error confirming buy transaction`);
          success = false;
        }
      }
    } catch (error) {
      logger.error({ mint: poolState.baseMint.toString(), error }, `Failed to buy token`);
      success = false;
    } finally {
      if (this.config.oneTokenAtATime) {
        this.mutex.release();
      }
    }

    return success;
  }

  public async sell(accountId: PublicKey, rawAccount: RawAccount) {
    if (this.config.oneTokenAtATime) {
      this.sellExecutionCount++;
    }

    try {
      logger.trace({ mint: rawAccount.mint }, `Processing new token...`);
      const poolData = await this.poolStorage.get(rawAccount.mint.toString());
      if (!poolData) {
        logger.trace({rawAccount})
        logger.trace({ mint: rawAccount.mint.toString() }, `Token pool data is not found, can't sell`);
        return;
      }

      
    
      const tokenIn = new Token(TOKEN_PROGRAM_ID, poolData.state.baseMint, poolData.state.baseDecimal.toNumber());
      const tokenAmountIn = new TokenAmount(tokenIn, rawAccount.amount, true);

      if (tokenAmountIn.isZero()) {
        logger.info({ mint: rawAccount.mint.toString() }, `Empty balance, can't sell`);
        return;
      }

      if (this.config.autoSellDelay > 0) {
        logger.debug({ mint: rawAccount.mint }, `Waiting for ${this.config.autoSellDelay} ms before sell`);
        await sleep(this.config.autoSellDelay);
      }

      const market = await this.marketStorage.get(poolData.state.marketId.toString());
      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(new PublicKey(poolData.id), poolData.state, market);

      logger.error('SELL POOL')
      logger.trace(poolData)

      const amountOut = await this.priceMatch(tokenAmountIn, poolKeys);
          
      const path = `/Users/outsider/tmp/tokens/${poolData.state.owner.toString()}`;
      await saveToFile(path, amountOut+"\n");

      if (this.config.simulationSell) {
        //logger.debug(`FAKE SELL : ${amountOut}`);
        logger.debug(`FAKE SELL SUCCESS`);
        return;
      }

      for (let i = 0; i < this.config.maxSellRetries; i++) {
        try {
          logger.info(
            { mint: rawAccount.mint },
            `Send sell transaction attempt: ${i + 1}/${this.config.maxSellRetries}`,
          );

          const result = await this.swap(
            poolKeys,
            accountId,
            this.config.quoteAta,
            tokenIn,
            this.config.quoteToken,
            tokenAmountIn,
            this.config.sellSlippage,
            this.config.wallet,
            'sell',
          );

          
          if (result.confirmed) {
            if (this.config.telegramNotification) {
              //const message = `#SELL\n\n${rawAccount.mint.toString()}\n\nPRICE : ${amountOut}`;
              const message = `#SELL\n\n${rawAccount.mint.toString()}`;
              this.tgWorker.postMessage({ chatID: this.config.telegramChatID, token: this.config.telegramBotToken, message: message });
            }

            logger.info(
              {
                dex: `https://dexscreener.com/solana/${rawAccount.mint.toString()}?maker=${this.config.wallet.publicKey}`,
                mint: rawAccount.mint.toString(),
                signature: result.signature,
                url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
              },
              `Confirmed sell tx`,
            );
            break;
          }

          logger.info(
            {
              mint: rawAccount.mint.toString(),
              signature: result.signature,
              error: result.error,
            },
            `Error confirming sell tx`,
          );
        } catch (error) {
          logger.debug({ mint: rawAccount.mint.toString(), error }, `Error confirming sell transaction`);
        }
      }
    } catch (error) {
      logger.error({ mint: rawAccount.mint.toString(), error }, `Failed to sell token`);
    } finally {
      if (this.config.oneTokenAtATime) {
        this.sellExecutionCount--;
      }
    }
  }

  public async sellSemulator(accountId: PublicKey, poolState: LiquidityStateV4){
    
    const amountOut = await this.computeAmountOut(accountId, poolState);
    if (amountOut){
        const rawAccount: RawAccount = {
          mint: poolState.baseMint,
          owner: this.config.wallet.publicKey,
          amount: BigInt(amountOut.numerator.toNumber()),
          delegateOption: 0,          
          delegate: PublicKey.default,
          state: 1,
          isNativeOption: 0,
          isNative: BigInt(0),
          delegatedAmount: BigInt(0),
          closeAuthorityOption: 0,
          closeAuthority: PublicKey.default
        };
        await this.sell(accountId, rawAccount);
    }
  }

  public async computeAmountOut(
    accountId: PublicKey, 
    poolState: LiquidityStateV4
  ): Promise<TokenAmount | CurrencyAmount | undefined> {

    try{
      const [market] = await Promise.all([
        this.marketStorage.get(poolState.marketId.toString()),
        getAssociatedTokenAddress(poolState.baseMint, this.config.wallet.publicKey),
      ]);

      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(accountId, poolState, market);
      const tokenOut = new Token(TOKEN_PROGRAM_ID, poolKeys.baseMint, poolKeys.baseDecimals);

      const slippagePercent = new Percent(this.config.buySlippage, 100);
      const poolInfo = await Liquidity.fetchInfo({
        connection: this.connection,
        poolKeys,
      });

      const computedAmountOut = Liquidity.computeAmountOut({
        poolKeys,
        poolInfo,
        amountIn: this.config.quoteAmount,
        currencyOut: tokenOut,
        slippage: slippagePercent,
      });
      //computedAmountOut.amountOut.numerator.toNumber()
      return computedAmountOut.amountOut

    }catch (error) {
      //const e = JSON.parse(String(error));
      logger.error({ mint: poolState.baseMint.toString(), error }, `Compute Amount Out`);
      //logger.error(`Compute Amount Out ${poolState.baseMint.toString()} : ${e["message"]} `);
    }

    return undefined;
    

  }

  // noinspection JSUnusedLocalSymbols
  private async swap(
    poolKeys: LiquidityPoolKeysV4,
    ataIn: PublicKey,
    ataOut: PublicKey,
    tokenIn: Token,
    tokenOut: Token,
    amountIn: TokenAmount,
    slippage: number,
    wallet: Keypair,
    direction: 'buy' | 'sell',
  ) {
    const slippagePercent = new Percent(slippage, 100);
    const poolInfo = await Liquidity.fetchInfo({
      connection: this.connection,
      poolKeys,
    });

    const computedAmountOut = Liquidity.computeAmountOut({
      poolKeys,
      poolInfo,
      amountIn,
      currencyOut: tokenOut,
      slippage: slippagePercent,
    });

    const latestBlockhash = await this.connection.getLatestBlockhash();
    const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
      {
        poolKeys: poolKeys,
        userKeys: {
          tokenAccountIn: ataIn,
          tokenAccountOut: ataOut,
          owner: wallet.publicKey,
        },
        amountIn: amountIn.raw,
        minAmountOut: computedAmountOut.minAmountOut.raw,
      },
      poolKeys.version,
    );

    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ...(this.isWarp || this.isJito
          ? []
          : [
              ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.config.unitPrice }),
              ComputeBudgetProgram.setComputeUnitLimit({ units: this.config.unitLimit }),
            ]),
        ...(direction === 'buy'
          ? [
              createAssociatedTokenAccountIdempotentInstruction(
                wallet.publicKey,
                ataOut,
                wallet.publicKey,
                tokenOut.mint,
              ),
            ]
          : []),
        ...innerTransaction.instructions,
        ...(direction === 'sell' ? [createCloseAccountInstruction(ataIn, wallet.publicKey, wallet.publicKey)] : []),
      ],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([wallet, ...innerTransaction.signers]);

    return this.txExecutor.executeAndConfirm(transaction, wallet, latestBlockhash);
  }


  private async filterMatch(poolKeys: LiquidityPoolKeysV4) {
    if (this.config.filterCheckInterval === 0 || this.config.filterCheckDuration === 0) {
      return true;
    }

    const timesToCheck = this.config.filterCheckDuration / this.config.filterCheckInterval;
    let timesChecked = 0;
    let matchCount = 0;

    do {
      try {
        const shouldBuy = await this.poolFilters.execute(poolKeys);
        if (shouldBuy) {
          matchCount++;
          
          if (this.config.consecutiveMatchCount <= matchCount) {
            logger.debug(
              { mint: poolKeys.baseMint.toString() },
              `Filter match ${matchCount}/${this.config.consecutiveMatchCount}`,
            );
            return true;
          }
        } else {
          matchCount = 0;
        }

        await sleep(this.config.filterCheckInterval);
      } finally {
        timesChecked++;
      }
    } while (timesChecked < timesToCheck);

    return false;
  }

  public test(){
    logger.trace("TEST");
    const lossFraction = this.config.quoteAmount.mul(this.config.stopLoss).numerator.div(new BN(100));
    const lossAmount = new TokenAmount(this.config.quoteToken, lossFraction, true);
    const stopLoss = this.config.quoteAmount.subtract(lossAmount);
    logger.trace(lossAmount.toFixed());
  }

  private async priceMatch(amountIn: TokenAmount, poolKeys: LiquidityPoolKeysV4): Promise<String | undefined>{
    if (this.config.priceCheckDuration === 0 || this.config.priceCheckInterval === 0) {
      return undefined;
    }

    await this.runListenerSpaceKey();

    const timesToCheck = this.config.priceCheckDuration / this.config.priceCheckInterval;
    const profitFraction = this.config.quoteAmount.mul(this.config.takeProfit).numerator.div(new BN(100));
    const profitAmount = new TokenAmount(this.config.quoteToken, profitFraction, true);
    const takeProfit = this.config.quoteAmount.add(profitAmount);

    const lossFraction = this.config.quoteAmount.mul(this.config.stopLoss).numerator.div(new BN(100));
    const lossAmount = new TokenAmount(this.config.quoteToken, lossFraction, true);
    const stopLoss = this.config.quoteAmount.subtract(lossAmount);
    const slippage = new Percent(this.config.sellSlippage, 100);

    
    let amountOut: TokenAmount | CurrencyAmount = new TokenAmount(this.config.quoteToken, new BN(10000), true);
    let timesChecked = 0;
    let result: string = "";

    do {
      try {
        const poolInfo = await Liquidity.fetchInfo({
          connection: this.connection,
          poolKeys,
        });

        amountOut = Liquidity.computeAmountOut({
          poolKeys,
          poolInfo,
          amountIn: amountIn,
          currencyOut: this.config.quoteToken,
          slippage,
        }).amountOut;
        
        result += amountOut.toFixed()+" ";
         //---------------------------------
         
         
        //const lossAmount2 = new TokenAmount(this.config.quoteToken, amountOut.toFixed(), true);
        const stopLoss2 = amountOut.sub(lossAmount);
        //const stopLoss2 = this.config.quoteAmount.subtract(lossAmount2);
        //logger.error(`lossAmount2  : ${ lossAmount2.toFixed() }`);
        logger.error(`stopLoss2   : ${ stopLoss2.toFixed() }`);
        
        //const stopLoss = this.config.quoteAmount.subtract(amountOut);
         //---------------------------------

        logger.debug(
          { mint: poolKeys.baseMint.toString() },
          `Take profit: ${takeProfit.toFixed()} | Stop loss: ${stopLoss.toFixed()} | Current: ${amountOut.toFixed()}`,
        );

        if (this.pressSpace){
          this.pressSpace = false;
          break;
        }

        if (amountOut.lt(stopLoss)) {
          break;
        }

        if (amountOut.gt(takeProfit)) {
          break;
        }

        await sleep(this.config.priceCheckInterval);
      } catch (e) {
        logger.trace({ mint: poolKeys.baseMint.toString(), e }, `Failed to check token price`);
      } finally {
        timesChecked++;
      }
    } while (timesChecked < timesToCheck);

    this.stopListenerSpaceKey();

    return result;

  }



  private async runListenerSpaceKey() {
      process.stdin.setRawMode(true);  // Включение режима "сырого ввода", чтобы сразу реагировать на нажатие
      process.stdin.resume();          // Возвращает поток stdin в активный режим
      process.stdin.setEncoding('utf8'); // Установка кодировки ввода

      process.stdin.removeAllListeners('data');
      // Слушаем событие data для получения нажатий клавиш
      process.stdin.on('data', (key: string) => {
        if (key === ' ') {
          this.pressSpace = true;
          //process.stdin.removeAllListeners('data');
          console.log('Нажата клавиша пробел');
          return;
        }
      });
  };
  

  private async stopListenerSpaceKey(){
      process.stdin.setRawMode(false);  // Возвращаем стандартный режим
      process.stdin.pause();  // Прекращаем поток stdin 
  }
}
