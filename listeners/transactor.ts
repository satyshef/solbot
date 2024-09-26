import { 
  Connection,
  PublicKey,
  Commitment,
  Logs,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction, 
  ParsedInstruction
} from '@solana/web3.js';

import { EventEmitter } from 'events';
import { P } from 'pino';

export type Swap = {
  signature: string;
  owner: PublicKey;
  mint: PublicKey;
  amount: number;
  time: Date;
};

export type ProgramEvent = {
  name: string,
  mint: PublicKey;
  time: Date,
  error: any,
  data: any
}


export class Transactor extends EventEmitter {

    //private buyList: Record<string, Swap> = {};
    private buys: Swap[] = [];
    private sells: Swap[] = [];
    private signatures: String[] = [];
    private buyAmount: number = 0;
    private sellAmount: number = 0;
    private ghost: number = 0;
    private ghostAmount: number = 0;
    //private sellList: Record<string, Swap>;

    constructor(private readonly connection: Connection) {
      super();
    }
  
    public start(
      programId: PublicKey,
      parseSwap: boolean,
      commitment: Commitment | undefined,
    ): number {
        const id = this.connection.onLogs(programId, async (logs, ctx) => {
            const found = await this.findSignature(logs.signature);
            if (!found){      
                this.signatures.push(logs.signature);
                this.emit("raw", logs);
                const event = this.getEvent(programId, logs);
                this.emit("event", event);
                if (parseSwap){
                  const swap = await this.procTransaction(programId, logs);
                  if (swap != undefined) {
                    if (swap.amount < 0) {
                      this.sellAmount += swap.amount;
                      const buys = this.getBuys();
                      if (this.findSwapOwner(swap.owner, buys).length == 0){
                        this.ghost += 1;
                        this.ghostAmount += swap.amount;
                      }
                    }else{
                      this.buyAmount += swap.amount;
                    }
                  }
                }
            }
          },
          commitment,
        );
        return id;
    }

    public stop(id: number) {
      this.ghost = 0;
      this.ghostAmount = 0;
      this.connection.removeOnLogsListener(id);
    }

    public swapInfo(supply: number){
      console.log("###################################################");
      console.log(`${this.buyAmount} :: ${this.sellAmount} ::  ${this.buyAmount + this.sellAmount} :: ${this.buyAmount / this.sellAmount}`);
      console.log(`GHOST : ${this.ghost} :: ${this.ghostAmount}`);
      console.log(supply);
    }

    public getGhostCount(): number{
      return this.ghost;
    }

    public calcSwap() {
      const buyAmount = this.buys.reduce((sum, swap) => sum + swap.amount, 0);
      const sellAmount = this.sells.reduce((sum, swap) => sum + swap.amount, 0);
    }

    public addSwap(swap: Swap){
      if (this.findSwapID(swap.signature, this.buys).length > 0) {
        return;
      }

      if (this.findSwapID(swap.signature, this.sells).length > 0) {
        return;
      }

      if (swap.amount == 0) {
        return;
      }

      if (swap.amount > 0) {
        this.buys.push(swap);
      }else{
        this.sells.push(swap);
      }
    }


    public findSwapID(signature: string, swaps: Swap[]): Swap[] {
      return swaps.filter((swap) => swap.signature === signature);
    }

    public findSwapOwner(owner: PublicKey, swaps: Swap[]): Swap[] {
      return swaps.filter((swap) => swap.owner.toString() === owner.toString());
    }

    public getBuys(): Swap[] {
      return this.buys;
    }

    public getSells(): Swap[] {
      return this.sells;
    }

    
    private async findSignature(signature: string): Promise<boolean>{
      const ok = this.signatures.find((sign) => sign == signature);
      if (ok) {
        return true;
      }
      return false;
    }

    /*
    public findSwapOwner(owner: PublicKey, lst: Swap[]): boolean{
      const ok = lst.find((lst) => lst.owner === owner);
      if (ok) {
        return true;
      }
      return false;
    }
    */


    private async procTransaction(programId: PublicKey, logs: Logs): Promise<Swap | undefined> {
      const currentTime = new Date();

      if (!this.isTransferLogs(logs)){
        return;
      }
      
      const tx = await this.getTransactionDetails(logs.signature);
      if (!tx) {
        console.log('Транзакция не найдена.');
        return;
      }
      if (tx.meta?.err != null){
        //console.error(tx.meta.err);
        return;
      }
    
      //console.log(`\n*********\n${ currentTime.toISOString() }\n${logs.signature}\n*********\n`);
      
      const owner = this.getTransactionOwner(tx);
      if (owner == undefined) {
        console.error("OWNER UNDEF : ", logs.signature);
        //console.log(tx.meta?.preTokenBalances);
        //console.log("******************");
        //console.log(tx.meta?.postTokenBalances);
        //console.log(tx.transaction.message.instructions);
        return;  
      }
      //console.log(owner.toString());
      //calcAmount(PROGRAM_ID.toString(), owner.toString(), tx);
      
      const amount = this.getAmount(owner, tx);

      const swap: Swap = {
        signature: logs.signature,
        owner: owner,
        mint: programId,
        amount: amount, 
        time: currentTime,
      };
      
      this.addSwap(swap);
      this.emit("swap", swap);
      return swap;
    }

    public getEvent(mint: PublicKey, logs: Logs): ProgramEvent{
      const currentTime = new Date();
      let eventName: string = "unknown";

      const event : ProgramEvent = {
        name: eventName,
        mint: mint,
        time: currentTime,
        error: logs.err,
        data: "",
      }

      if (this.isError(logs)){
        event.name = "error";
        return event;
      };
    
      if (this.isTransferLogs(logs)){
        event.name = "swap";
        return event;
      }
    
      if (this.isBuyRaydiumLogs(logs)){
        event.name = "buy_raydium";
        return event;
      };
    
      if (this.isCreateAccLogs(logs)){
        event.name = "create_account";
        return event;
      };

      if (this.isCreateTradeAccLogs(logs)){
        event.name = "create_trade_account";
        return event;
      };
    
      if (this.isBurnLogs(logs)){
        event.name = "burn";
        return event;
      };

      if (this.isCreate(logs)){
        event.name = "create";
        return event;
      };

      if (this.isIncrementNonce(logs)){
        event.name = "increment";
        return event;
      };

      if (this.isInsufficientLamports(logs)){
        event.name = "lamports";
        return event;
      };

      if (this.isPepperRaydium(logs)){
        event.name = "pepper_raydium";
        return event;
      };

      if (this.isInitializeSwap(logs)){
        event.name = "initialize_swap";
        return event;
      };


      console.log(logs);
      return event;
    }


    public getAmount(owner: PublicKey, tx: ParsedTransactionWithMeta): number {

      //let result: number = 0;
      if (!tx) {
        console.error('Empty transaction');
        return 0;
      }
      //const instructions = tx.transaction.message.instructions as ParsedInstruction[];
      const postTokenBalances = tx.meta?.postTokenBalances;
      const preTokenBalances = tx.meta?.preTokenBalances;
    
      let postBalance: number = 0;
      let preBalance: number = 0;
      
      if (preTokenBalances == null || postTokenBalances == null){
        console.error('Null balance');
        return 0;
      }
    
      for (const [index, balance] of postTokenBalances.entries()) {
        if (
          balance.owner === owner.toString() &&
          balance.mint !== "So11111111111111111111111111111111111111112"
        ){
          if (balance.uiTokenAmount.uiAmount != null){
            postBalance = balance.uiTokenAmount.uiAmount;
          }else{
            postBalance = 0;
          }
          
          for (const [index, prebalance] of preTokenBalances.entries()) {
            if (balance.accountIndex == prebalance.accountIndex) {
              if (prebalance.uiTokenAmount.uiAmount != null) {
                preBalance = prebalance.uiTokenAmount.uiAmount;
              }else{
                preBalance = 0;
              }
              break;
            }
          }
          // Будет не корректное значение если в одной транзакции несколько инструкций
          return postBalance - preBalance;
        }
      }

      /*
      console.error(preTokenBalances);
      console.error("******************************************");
      console.error(postTokenBalances);
      */
      return 0;
    }


    public async getTransactionDetails(signature: string): Promise<ParsedTransactionWithMeta | null> {
      const tx = await this.connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      return tx;
    }

    public getTransactionOwner(tx: ParsedTransactionWithMeta): PublicKey | undefined{
  
      if (!tx) {
        console.error("Empty transactions list");
        return;
      }
    
      const instructions = tx.transaction.message.instructions as ParsedInstruction[];
      let owner: PublicKey | undefined;
      for (let i = 0; i < instructions.length; i++) {
        const instruction = instructions[i];
        owner = this.getTransferOwnerMethod1(instruction);
        if (owner != undefined){
          //console.log(instruction);
          break;
        }
      }
    
      if (owner == undefined){
        const instructions = tx.transaction.message.instructions as PartiallyDecodedInstruction[];
        for (let i = 0; i < instructions.length; i++) {
          const instruction = instructions[i];
          owner = this.getTransferOwnerMethod2(instruction);
          if (owner != undefined){
            //console.log(instruction);
            break;
          }
        }
      }
      return owner;
    }


    private getTransferOwnerMethod2(instruction: PartiallyDecodedInstruction): PublicKey | undefined {
      if(
        instruction.data == '7' ||
        instruction.programId.equals(new PublicKey("ChXs7eqjAKr8qrsGHcnp7sBKzrDU2JE2RjMqX59ATSeH")) ||
        instruction.programId.equals(new PublicKey("8ttQhToyumxCE8WxJFnjkBcc1HJeEQ249c99Qb8azuYq"))
      ){
        return instruction.accounts[0];
      }
    
      return undefined;
    }
    
    private getTransferOwnerMethod1(instruction: ParsedInstruction): PublicKey | undefined {
      try{
        if (
          instruction.programId.equals(new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')) ||
          instruction.programId.equals(new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))
        ){
          const owner = String(instruction.parsed.info?.owner || instruction.parsed.info?.source);
          if (owner != ""){
            return new PublicKey(owner);
          }
        }
      }catch(e){
        console.error(e);
      }
      
      return undefined;
    }
    


    public isTransferLogs(logs: Logs) {
      const flag = "Instruction: Transfer";
      for (const log of logs.logs) {
        if (log.includes(flag)) {
          return true;
        } 
      }
      return false;
    }
    
    public isCreateAccLogs(logs: Logs) {
      const flag = "Instruction: InitializeAccount3";
      for (const log of logs.logs) {
        if (log.includes(flag)) {
          return true;
        } 
      }
      return false;
    }

    public isCreateTradeAccLogs(logs: Logs) {
      const flag = "CreateTradeAccount";
      for (const log of logs.logs) {
        if (log.includes(flag)) {
          return true;
        } 
      }
      return false;
    }
    
    public isBuyRaydiumLogs(logs: Logs) {
      const flag = "Instruction: BuyRaydium";
      for (const log of logs.logs) {
        if (log.includes(flag)) {
          return true;
        } 
      }
      return false;
    }
    
    public isBurnLogs(logs: Logs) {
      const flag = "Instruction: Burn";
      for (const log of logs.logs) {
        if (log.includes(flag)) {
          return true;
        } 
      }
      return false;
    }

    public isCreate(logs: Logs) {
      const flag = "Program log: Create";
      for (const log of logs.logs) {
        if (log.includes(flag)) {
          return true;
        } 
      }
      return false;
    }

    public isIncrementNonce(logs: Logs) {
      const flag = "Instruction: IncrementNonceAndTimeoutCheck";
      for (const log of logs.logs) {
        if (log.includes(flag)) {
          return true;
        } 
      }
      return false;
    }

    public isInsufficientLamports(logs: Logs) {
      const flag = "Transfer: insufficient lamports";
      for (const log of logs.logs) {
        if (log.includes(flag)) {
          return true;
        } 
      }
      return false;
    }

    public isPepperRaydium(logs: Logs) {
      const flag = "Instruction: PepperRaydiumSwapV7";
      for (const log of logs.logs) {
        if (log.includes(flag)) {
          return true;
        } 
      }
      return false;
    }

    public isInitializeSwap(logs: Logs) {
      const flag = "Instruction: InitializeSwap";
      for (const log of logs.logs) {
        if (log.includes(flag)) {
          return true;
        } 
      }
      return false;
    }

    public isError(logs: Logs) {
      const flag = "log: Error:";
      for (const log of logs.logs) {
        if (log.includes(flag)) {
          return true;
        } 
      }
      return false;
    }

}