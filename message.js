import {Asset, Operation} from 'stellar-base';
import * as Digest from 'multiformats/hashes/digest';
import {sha256} from 'multiformats/hashes/sha2';
import * as raw from 'multiformats/codecs/raw';
import { CID } from 'multiformats/cid';

import {AccountWatcher, AccountDigger} from './apiReaders.js';
import {SigningAccount} from './signing.js';
import {COL_Node} from './cols.js';
import * as Sodium from './na.js'

const STELLAR_TX_CODEC_CODE = 0xd1;

function MessageFilter(payment){
  if(payment.transaction.hash === this.watcher.stopAtTxHash){
//console.log(`found payment ${payment.id} created at ${payment.created_at} with TxHash ${payment.transaction.id} and previously marked MessagesRead`);
    return true
  }
  for(const messenger of ['MessageMe', 'ShareData']){
    if(payment.asset_code === messenger && payment.asset_issuer === this.account.id){
      const shortenedMemo = `${payment.transaction.memo.slice(0,5)}...${payment.transaction.memo.slice(-5)}`;
      console.log(`found ${payment.asset_code} payment ID ${payment.id} created at ${payment.created_at} with memo ${shortenedMemo}`);
      this.watcher.recordQueue.push(payment);
    }
  }
  if(payment.asset_code === 'MessagesRead' && payment.asset_issuer === this.account.id){
//console.log(`found memo ${Buffer.from(payment.transaction.memo, 'base64').toString('hex')} with MessagesRead created at ${payment.created_at}: `);
    console.log(`found memo ${Buffer.from(payment.transaction.memo, 'base64').toString('hex')} with MessagesRead created at ${payment.created_at}: `);
    this.watcher.stopAtTxHash = Buffer.from(payment.transaction.memo, 'base64').toString('hex');
  }
  return false
}

async function DrainMessageQueue(readerResult){
  //  A readerResult contains a recordQueue, recursionDepth of the read, and the reader's current cursor.
  //  The recordQueue is filled by the watcher with filterMyMessages above.
  if(readerResult.recordQueue.length){
    readerResult.recordQueue.sort((a, b) => Date.parse(a.created_at) > Date.parse(b.created_at) ? 1 : -1);
    const txHashStr = readerResult.recordQueue.slice(-1).pop().transaction_hash;
    const txHash = Buffer.from(txHashStr, 'hex');
    console.log(`marking MessagesRead with memo hash ${txHashStr.slice(0,5)}...${txHashStr.slice(-5)}`);
    await this.tx([
      Operation.payment({
        destination: this.account.id, 
        asset: new Asset('MessagesRead', this.account.id), 
        amount: '0.0000001'})
      ], CID.create(1, STELLAR_TX_CODEC_CODE, Digest.create(sha256.code, txHash)));
    this.watcher.callback(readerResult.recordQueue); // gets decoded messages to app in real time
  }
  return readerResult.recordQueue  // identifies waiting messages to app
}

export class MessageWatcher extends AccountWatcher {
  #account; // where to dig and watch
  #callback;// to call application
  constructor(address, parent){
    super(address, 'payments', MessageFilter.bind(parent), true);
    this.#account = address;
  }
  async start(parent, callback){
    this.#callback = callback.bind(parent);
    const digger = new MessageDigger(this.#account);
    const oldMsgs = await digger.dig(DrainMessageQueue.bind(parent));
    this.byBlock(DrainMessageQueue.bind(parent));
    return oldMsgs
  }

  get callback(){
    return this.#callback
  }
}

class MessageDigger extends AccountDigger {
  constructor(address){
    const context = {account: {id: address}};
    super(address, 'payments', MessageFilter.bind(context), true);
    context.watcher = this;
  }
}