import { Database, EventEmitter, State, TransactionPool } from "@arkecosystem/core-interfaces";
import { Handlers, TransactionReader } from "@arkecosystem/core-transactions";
import { Interfaces, Managers, Transactions } from "@arkecosystem/crypto";
import { BusinessRegistrationAssetError, WalletIsAlreadyABusiness } from "../errors";
import { IBusinessRegistrationAsset } from "../interfaces";
import { BusinessRegistrationTransaction } from "../transactions";

export class BusinessRegistrationTransactionHandler extends Handlers.TransactionHandler {
  public getConstructor(): Transactions.TransactionConstructor {
    return BusinessRegistrationTransaction;
  }
    public dependencies(): ReadonlyArray<Handlers.TransactionHandlerConstructor> {
        return [];
    }

    public walletAttributes(): ReadonlyArray<string> {
        return [];
    }

    public async isActivated(): Promise<boolean> {
        return !!Managers.configManager.getMilestone().aip11;
    }
  public async bootstrap(connection: Database.IConnection, walletManager: State.IWalletManager): Promise<void> {
      const reader: TransactionReader = await TransactionReader.create(connection, this.getConstructor());

      while (reader.hasNext()) {
          const transactions = await reader.read();

          for (const transaction of transactions) {
              const wallet: State.IWallet = walletManager.findByPublicKey(transaction.senderPublicKey);
              const asset: IBusinessRegistrationAsset = {
                  name: transaction.asset.businessRegistration.name,
                  website: transaction.asset.businessRegistration.website
              };

              wallet.setAttribute<IBusinessRegistrationAsset>("business", asset);
              walletManager.reindex(wallet);
          }
      }
  }

  public async throwIfCannotBeApplied(
    transaction: Interfaces.ITransaction,
    wallet: State.IWallet,
    databaseWalletManager: State.IWalletManager,
  ): Promise<void> {
    const { data }: Interfaces.ITransaction = transaction;

    const { name, website }: { name: string; website: string } = data.asset.businessRegistration;
    if (!name || !website) {
      throw new BusinessRegistrationAssetError();
    }

    if (wallet.hasAttribute("business")) {
      throw new WalletIsAlreadyABusiness();
    }

    super.throwIfCannotBeApplied(transaction, wallet, databaseWalletManager);
  }

  public emitEvents(transaction: Interfaces.ITransaction, emitter: EventEmitter.EventEmitter): void {
    emitter.emit("business.registered", transaction.data);
  }

  public async canEnterTransactionPool(
    data: Interfaces.ITransactionData,
    pool: TransactionPool.IConnection,
    processor: TransactionPool.IProcessor,
  ): Promise<boolean> {
    if (this.typeFromSenderAlreadyInPool(data, pool, processor)) {
      return false;
    }

    const { name }: { name: string } = data.asset.businessRegistration;
    const businessRegistrationsSameNameInPayload = processor
      .getTransactions()
      .filter(tx => tx.type === this.getConstructor().type && tx.asset.businessRegistration.name === name);

    if (businessRegistrationsSameNameInPayload.length > 1) {
      processor.pushError(
        data,
        "ERR_CONFLICT",
        `Multiple business registrations for "${name}" in transaction payload`,
      );
      return false;
    }

    const businessRegistrationsInPool: Interfaces.ITransactionData[] = Array.from(
      await pool.getTransactionsByType(this.getConstructor().type),
    ).map((memTx: Interfaces.ITransaction) => memTx.data);
    const containsBusinessRegistrationForSameNameInPool: boolean = businessRegistrationsInPool.some(
      transaction => transaction.asset.businessRegistration.name === name,
    );
    if (containsBusinessRegistrationForSameNameInPool) {
      processor.pushError(data, "ERR_PENDING", `Business registration for "${name}" already in the pool`);
      return false;
    }

    return true;
  }

  public async applyToSender(transaction: Interfaces.ITransaction, walletManager: State.IWalletManager): Promise<void> {
    await super.applyToSender(transaction, walletManager);
    const sender: State.IWallet = walletManager.findByPublicKey(transaction.data.senderPublicKey);
    sender.setAttribute<IBusinessRegistrationAsset>("business", transaction.data.asset.businessRegistration);
    walletManager.reindex(sender);
  }

  public async revertForSender(transaction: Interfaces.ITransaction, walletManager: State.IWalletManager): Promise<void> {
    await super.revertForSender(transaction, walletManager);
    const sender: State.IWallet = walletManager.findByPublicKey(transaction.data.senderPublicKey);
    sender.forgetAttribute("business");
    walletManager.reindex(sender);
  }

  public async applyToRecipient(transaction: Interfaces.ITransaction, walletManager: State.IWalletManager): Promise<void> {
    return;
  }

  public async revertForRecipient(transaction: Interfaces.ITransaction, walletManager: State.IWalletManager): Promise<void> {
    return;
  }
}
