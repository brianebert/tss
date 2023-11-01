import {Asset, Operation} from 'stellar-base';
import * as Digest from 'multiformats/hashes/digest';
import {sha256} from 'multiformats/hashes/sha2';
import * as raw from 'multiformats/codecs/raw';
import { CID } from 'multiformats/cid';

import {AccountWatcher, AccountDigger} from './apiReaders.js';
import {SigningAccount} from './signing.js';
import {COL_Node} from './cols.js';

const MESSAGE_TOKENS = ['MessageMe', 'ShareData'];
const STELLAR_TX_CODEC_CODE = 0xd1;

// queues messages identified in account's payment stream ontil finding one marked by a MessagesRead token
function untilMarkedRead(payment){
  // found a message marked read. returning true stops reader
  if(payment.transaction.hash === this.watcher.stopAtTxHash)
    return true

  // queue a matching token payment for message processing
  for(const messenger of MESSAGE_TOKENS)
    if(payment.asset_code === messenger && payment.asset_issuer === this.account.id)
      this.watcher.recordQueue.push(payment);

  // application has marked new messages read cursor
  if(payment.asset_code === 'MessagesRead' && payment.asset_issuer === this.account.id)
    this.watcher.stopAtTxHash = Buffer.from(payment.transaction.memo, 'base64').toString('hex');
  
  // continue reading api
  return false
}

// called when an api reader finishes reading
async function readerDone(readerResult){
  //  A readerResult contains a recordQueue, recursionDepth of the read, and the reader's current cursor.
  //  The recordQueue is filled by the watcher with filterMyMessages above.
  if(readerResult.recordQueue.length){
    readerResult.recordQueue.sort((a, b) => Date.parse(a.created_at) > Date.parse(b.created_at) ? 1 : -1);
    const txHashStr = readerResult.recordQueue.slice(-1).pop().transaction_hash;
    const txHash = Buffer.from(txHashStr, 'hex');
    console.log(`marking messages read up to Tx hash ${txHashStr.slice(0,5)}...${txHashStr.slice(-5)}`);
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

// collects waiting, unread messages 
class MessageDigger extends AccountDigger {
  constructor(address){
    const context = {account: {id: address}};
    super(address, 'payments', untilMarkedRead.bind(context), true);
    context.watcher = this;
  }
}

// collects waiting, unread messages on start() and then periodically checks for new messages
export class MessageWatcher extends AccountWatcher {
  #account; // where to dig and watch
  #callback;// to call application
  constructor(address, parent){
    super(address, 'payments', untilMarkedRead.bind(parent), true);
    this.#account = address;
  }
  async start(parent, callback){
    this.#callback = callback.bind(parent);
    const digger = new MessageDigger(this.#account);
    const oldMsgs = await digger.dig(readerDone.bind(parent));
    this.byBlock(readerDone.bind(parent));
    return oldMsgs
  }

  // so readerDone() can call .callback()
  get callback(){
    return this.#callback
  }
}