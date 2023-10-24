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

function abrevId(id){
  return `${id.slice(0, 5)}...${id.slice(-5)}`
}

function MessageFilter(payment){
  if(payment.transaction.hash === this.watcher.stopAtTxHash){
    console.log(`found payment ${payment.id} created at ${payment.created_at} with TxHash ${payment.transaction.id} and previously marked MessagesRead`);
    return true
  }
  for(const messenger of ['MessageMe', 'ShareData']){
    if(payment.asset_code === messenger && payment.asset_issuer === this.account.id){
      console.log(`found messenger payment ${payment.id} created at ${payment.created_at} and carrying memo ${payment.transaction.memo}`);
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
  //console.log(`readerResult is: `, readerResult);
  //  A readerResult contains a recordQueue, recursionDepth of the read, and the reader's current cursor.
  //  The recordQueue is filled by the watcher with filterMyMessages above.
  //console.log(`draining message queue with context: `, this);
  let traversed;
  const decodedTraversed = [];
  for(const message of readerResult.recordQueue){
console.log(`draining message queue of ${message.asset_code}, created at ${message.created_at}, with memo ${message.transaction.memo}->${SigningAccount.memoToCID(message.transaction.memo)}`);
    switch(message.asset_code){
    case 'MessageMe':{
      const pk = await(SigningAccount.dataEntry(message.from, 'libsodium_box_pk'));
      const node = await COL_Node.fromCID(SigningAccount.memoToCID(message.transaction.memo), {reader: this.ec25519.sk, writer: pk});
//console.log(`created node from MessageMe memo: `, node.value);
      traversed = await COL_Node.traverse(node.cid, ()=>{}/*(instance)=>{
        console.log(`${abrevId(message.from)} sent message to ${abrevId(message.to)}: `, instance.value.message);
      }*/, {reader: this.ec25519.sk, writer: pk});
    }
      break;
    case 'ShareData':{
      const pk = await SigningAccount.dataEntry(message.from, 'libsodium_kx_pk');
//console.log(`retrieved ${message.from} libsodium_kx_pk: `, pk);
      const rxKey = await Sodium.sharedKeyRx(this.shareKX, pk);
//console.log(`computed shared receive key: `, rxKey);
      const node = await COL_Node.fromCID(SigningAccount.memoToCID(message.transaction.memo), {shared: rxKey});
//console.log(`Decoded : `, node);
      traversed = await COL_Node.traverse(node.cid, ()=>{}, {shared: rxKey});
    }
      break;
    default:
      throw new Error(`wasn't expecting to get here`)
    }
    //traversed.message = message;
    //console.log(`traversed from root ${traversed.cid.toString()}: `, traversed.value);
    traversed.value.transaction_hash = message.transaction_hash;
    traversed.value.operation_number = message.id;
    decodedTraversed.push(traversed.value);
  }
  if(decodedTraversed.length){
    //console.log(`marking ${decodedTraversed.length} messages read`);
    // sort received oldest to newest (diggers collect them in reverse)
    decodedTraversed.sort((a, b) => Date.parse(a) > Date.parse(b) ? 1 : -1);
/*console.log(`decodedTraversed, length ${decodedTraversed.length} is `, decodedTraversed);
console.log(`array with last element has length ${decodedTraversed.slice(-1).length}`);
console.log(`last element is `, decodedTraversed.slice(-1).pop());
console.log(`while decodedTraversed length is ${decodedTraversed.length}`);
console.log(`will make Buffer from: ${decodedTraversed.slice(-1).pop().transaction_hash}`);*/
    const txHash = Buffer.from(decodedTraversed.slice(-1).pop().transaction_hash, 'hex');
 /*   if(Buffer.isBuffer(txHash))
      console.log(`made Buffer of ${txHash.length} bytes for transaction_hash ${txHash.toString('hex')}`);
    const digest = Digest.create(sha256.code, txHash);
//console.log(`created hash digest `, digest);
    let cid = CID.create(1, STELLAR_TX_CODEC_CODE, Digest.create(sha256.code, txHash));
    console.log(`last transaction_hash ${cid.toString()} has cid: `, cid);
    //cid = new CID(1, STELLAR_TX_CODEC_CODE, Digest.create(sha256.code, txHash));
    console.log(`and calling CID's constructor I get ${cid.toString()} : `, cid); */
    await this.tx([
      Operation.payment({
        destination: this.account.id, 
        asset: new Asset('MessagesRead', this.account.id), 
        amount: '0.0000001'})
      ], CID.create(1, STELLAR_TX_CODEC_CODE, Digest.create(sha256.code, txHash)));
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