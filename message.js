import {AccountWatcher, AccountDigger} from './apiReaders.js';
import {SigningAccount} from './signing.js';
import {COL_Node} from './cols.js';
import * as Sodium from './na.js'

import * as Digest from 'multiformats/hashes/digest';
import {sha256} from 'multiformats/hashes/sha2';
import * as raw from 'multiformats/codecs/raw';
import { CID } from 'multiformats/cid';

import {Asset, Operation} from 'stellar-base';

function MessageFilter(payment){
  if(payment.transaction.hash === this.watcher.stopAtTxHash){
    console.log(`found payment previously marked by MessagesRead token: `, payment);
    return true
  }
  for(const messenger of ['MessageMe', 'ShareData']){
    if(payment.asset_code === messenger && payment.asset_issuer === this.account.id){
      //console.log(`found messenger payment: `, payment);
      this.watcher.recordQueue.push(payment);
    }
  }
  if(payment.asset_code === 'MessagesRead' && payment.asset_issuer === this.account.id){
    console.log(`found memo ${Buffer.from(payment.transaction.memo, 'base64').toString('hex')} with MessagesRead token: `, payment);
    this.watcher.stopAtTxHash = Buffer.from(payment.transaction.memo, 'base64').toString('hex');
  }
  return false
}

async function DrainMessageQueue(readerResult){
  //console.log(`readerResult is: `, readerResult);
  //  A readerResult contains a recordQueue, recursionDepth of the read, and the reader's current cursor.
  //  The recordQueue is filled by the watcher with filterMyMessages above.
  //console.log(`draining message queue with context: `, this);
  const decodedTraversed = [];
  for(const message of readerResult.recordQueue){
    switch(message.asset_code){
    case 'MessageMe':{
      console.log(`draining message queue of MessageMe: `, message);
      const pk = await(SigningAccount.dataEntry(message.from, 'libsodium_box_pk'));
      const node = await COL_Node.fromCID(SigningAccount.memoToCID(message.transaction.memo), {reader: this.ec25519.sk, writer: pk});
      const traversed = await COL_Node.traverse(node.cid, {reader: this.ec25519.sk, writer: pk});
      traversed.message = message;
      console.log(`traversed message: `, traversed);
      decodedTraversed.push(traversed);
    }
      break;
    case 'ShareData':{
      console.log(`draining message queue of ShareData: `, message);
      const pk = await SigningAccount.dataEntry(message.from, 'libsodium_kx_pk');
      console.log(`retrieved ${message.from} libsodium_kx_pk: `, pk);
      const rxKey = await Sodium.sharedKeyRx(this.shareKX, pk);
      console.log(`computed shared receive key: `, rxKey);
      const node = await COL_Node.fromCID(SigningAccount.memoToCID(message.transaction.memo), {shared: rxKey});
      console.log(`Decoded : `, node);
      const traversed = await COL_Node.traverse(node.cid, {shared: rxKey});
      console.log(`traversed : `, traversed);
      traversed.message = message;
      console.log(`traversed message: `, traversed);
      decodedTraversed.push(traversed);
    }
      break;
    default:
      throw new Error(`wasn't expecting to get here`)
    }
  }
  if(decodedTraversed.length){
    //console.log(`marking ${decodedTraversed.length} messages read`);
    // sort received oldest to newest (diggers collect them in reverse)
    decodedTraversed.sort((a, b) => Date.parse(a) > Date.parse(b) ? 1 : -1);
    const bytes = Buffer.from(decodedTraversed[decodedTraversed.length -1].message.transaction.hash, 'hex');
    console.log(`created msgTxId buffer: `, bytes)
    this.tx([
      Operation.payment({
        destination: this.account.id, 
        asset: new Asset('MessagesRead', this.account.id), 
        amount: '0.0000001'})
      ], new CID(1, raw, Digest.create(sha256.code, bytes)));
    this.watcher.callback(decodedTraversed);    
  }
  return decodedTraversed
}

export class MessageWatcher extends AccountWatcher {
  #account; // so we know where to dig before watching
  #callback;// to reach calling application
  constructor(address, parent){
    super(address, 'payments', MessageFilter.bind(parent), true);
    this.#account = address;
  }
  async start(parent, callback){
    this.#callback = callback;
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