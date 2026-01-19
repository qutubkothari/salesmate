/**
 * Blockchain Audit Trail Service
 * Immutable logging of critical transactions using Ethereum
 */

const { ethers } = require('ethers');
const crypto = require('crypto');
const { db } = require('./config');

class BlockchainService {
  constructor() {
    this.enabled = process.env.BLOCKCHAIN_ENABLED === 'true';
    this.provider = null;
    this.wallet = null;
    this.contract = null;
    
    // Simple audit log contract ABI
    this.contractABI = [
      "function logTransaction(string txType, string txHash, string data) public returns (uint256)",
      "function getTransaction(uint256 id) public view returns (string, string, string, uint256)",
      "function getTransactionCount() public view returns (uint256)",
      "event TransactionLogged(uint256 indexed id, string txType, string txHash, uint256 timestamp)"
    ];
    
    if (this.enabled) {
      this.initialize();
    }
  }

  /**
   * Initialize blockchain connection
   */
  async initialize() {
    try {
      // Use Ethereum testnet (Sepolia) or local node
      const rpcUrl = process.env.ETHEREUM_RPC_URL || 'http://localhost:8545';
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      
      // Create or load wallet
      const privateKey = process.env.ETHEREUM_PRIVATE_KEY;
      if (privateKey) {
        this.wallet = new ethers.Wallet(privateKey, this.provider);
      } else {
        // Generate new wallet for demo
        this.wallet = ethers.Wallet.createRandom().connect(this.provider);
        console.log('Generated new wallet:', this.wallet.address);
        console.log('Set ETHEREUM_PRIVATE_KEY env var to persist');
      }
      
      // Load contract if address is provided
      const contractAddress = process.env.ETHEREUM_CONTRACT_ADDRESS;
      if (contractAddress) {
        this.contract = new ethers.Contract(contractAddress, this.contractABI, this.wallet);
      }
      
      console.log('Blockchain service initialized:', {
        network: await this.provider.getNetwork(),
        wallet: this.wallet.address,
        contract: contractAddress || 'not_deployed'
      });
      
    } catch (error) {
      console.error('Blockchain initialization error:', error.message);
      this.enabled = false;
    }
  }

  /**
   * Log order to blockchain
   */
  async logOrder(order) {
    if (!this.enabled) {
      return await this.logToDatabase('ORDER', order);
    }

    try {
      const txHash = this.hashData(order);
      const data = JSON.stringify({
        orderId: order.id,
        customerId: order.customer_id,
        totalAmount: order.total_amount,
        timestamp: order.created_at
      });

      if (this.contract) {
        const tx = await this.contract.logTransaction('ORDER', txHash, data);
        const receipt = await tx.wait();
        
        return {
          success: true,
          blockchainTxHash: receipt.hash,
          blockNumber: receipt.blockNumber,
          dataHash: txHash
        };
      } else {
        // Fallback to database logging
        return await this.logToDatabase('ORDER', order);
      }
    } catch (error) {
      console.error('Blockchain log error:', error.message);
      return await this.logToDatabase('ORDER', order);
    }
  }

  /**
   * Log payment to blockchain
   */
  async logPayment(payment) {
    if (!this.enabled) {
      return await this.logToDatabase('PAYMENT', payment);
    }

    try {
      const txHash = this.hashData(payment);
      const data = JSON.stringify({
        orderId: payment.order_id,
        amount: payment.amount,
        method: payment.payment_method,
        timestamp: payment.created_at
      });

      if (this.contract) {
        const tx = await this.contract.logTransaction('PAYMENT', txHash, data);
        const receipt = await tx.wait();
        
        return {
          success: true,
          blockchainTxHash: receipt.hash,
          blockNumber: receipt.blockNumber,
          dataHash: txHash
        };
      } else {
        return await this.logToDatabase('PAYMENT', payment);
      }
    } catch (error) {
      console.error('Blockchain log error:', error.message);
      return await this.logToDatabase('PAYMENT', payment);
    }
  }

  /**
   * Log critical event to blockchain
   */
  async logEvent(eventType, eventData) {
    if (!this.enabled) {
      return await this.logToDatabase(eventType, eventData);
    }

    try {
      const txHash = this.hashData(eventData);
      const data = JSON.stringify(eventData);

      if (this.contract) {
        const tx = await this.contract.logTransaction(eventType, txHash, data);
        const receipt = await tx.wait();
        
        return {
          success: true,
          blockchainTxHash: receipt.hash,
          blockNumber: receipt.blockNumber,
          dataHash: txHash
        };
      } else {
        return await this.logToDatabase(eventType, eventData);
      }
    } catch (error) {
      console.error('Blockchain log error:', error.message);
      return await this.logToDatabase(eventType, eventData);
    }
  }

  /**
   * Verify data integrity
   */
  async verifyIntegrity(dataHash, blockchainTxHash) {
    if (!this.enabled || !this.contract) {
      return { success: false, message: 'Blockchain not enabled' };
    }

    try {
      // Get transaction from blockchain
      const tx = await this.provider.getTransaction(blockchainTxHash);
      
      if (!tx) {
        return { success: false, message: 'Transaction not found' };
      }

      // Verify transaction is confirmed
      const receipt = await tx.wait();
      
      return {
        success: true,
        verified: true,
        blockNumber: receipt.blockNumber,
        confirmations: await receipt.confirmations(),
        timestamp: (await this.provider.getBlock(receipt.blockNumber)).timestamp
      };
    } catch (error) {
      console.error('Verification error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get audit trail for an order
   */
  async getAuditTrail(orderId) {
    try {
      const logs = await db.all(`
        SELECT * FROM blockchain_audit_log
        WHERE entity_type = 'ORDER' AND entity_id = ?
        ORDER BY created_at ASC
      `, [orderId]);

      return {
        success: true,
        auditTrail: logs,
        isImmutable: this.enabled
      };
    } catch (error) {
      console.error('Audit trail error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Fallback: Log to database when blockchain is unavailable
   */
  async logToDatabase(entityType, entityData) {
    try {
      const dataHash = this.hashData(entityData);
      const entityId = entityData.id || entityData.order_id || null;
      
      await this.ensureAuditTable();
      
      const result = await db.run(`
        INSERT INTO blockchain_audit_log 
        (entity_type, entity_id, data_hash, data_json, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `, [entityType, entityId, dataHash, JSON.stringify(entityData)]);

      return {
        success: true,
        logId: result.lastID,
        dataHash,
        method: 'database'
      };
    } catch (error) {
      console.error('Database audit log error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Ensure audit table exists
   */
  async ensureAuditTable() {
    await db.run(`
      CREATE TABLE IF NOT EXISTS blockchain_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        data_hash TEXT NOT NULL,
        data_json TEXT NOT NULL,
        blockchain_tx_hash TEXT,
        block_number INTEGER,
        created_at TEXT NOT NULL
      )
    `);
  }

  /**
   * Hash data for integrity verification
   */
  hashData(data) {
    const jsonString = JSON.stringify(data);
    return crypto.createHash('sha256').update(jsonString).digest('hex');
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      enabled: this.enabled,
      connected: this.provider !== null,
      wallet: this.wallet ? this.wallet.address : null,
      contract: this.contract ? 'deployed' : 'not_deployed',
      network: this.provider ? 'connected' : 'disconnected'
    };
  }

  /**
   * Generate sample smart contract code (for deployment)
   */
  getContractCode() {
    return `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SalesmateAuditLog {
    struct Transaction {
        string txType;
        string txHash;
        string data;
        uint256 timestamp;
    }
    
    Transaction[] public transactions;
    
    event TransactionLogged(
        uint256 indexed id,
        string txType,
        string txHash,
        uint256 timestamp
    );
    
    function logTransaction(
        string memory txType,
        string memory txHash,
        string memory data
    ) public returns (uint256) {
        transactions.push(Transaction({
            txType: txType,
            txHash: txHash,
            data: data,
            timestamp: block.timestamp
        }));
        
        uint256 id = transactions.length - 1;
        emit TransactionLogged(id, txType, txHash, block.timestamp);
        
        return id;
    }
    
    function getTransaction(uint256 id) public view returns (
        string memory txType,
        string memory txHash,
        string memory data,
        uint256 timestamp
    ) {
        require(id < transactions.length, "Transaction does not exist");
        Transaction memory txn = transactions[id];
        return (txn.txType, txn.txHash, txn.data, txn.timestamp);
    }
    
    function getTransactionCount() public view returns (uint256) {
        return transactions.length;
    }
}
    `.trim();
  }
}

module.exports = new BlockchainService();
