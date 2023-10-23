import {request} from './http.js';
import {COL_Node} from './cols.js';
import {AccountDigger} from './apiReaders.js';
import {MessageWatcher} from './message.js';
import {Account, Asset, Keypair, Memo, MemoHash,
        MemoText, MemoID, Networks, Operation, 
        StrKey, TimeoutInfinite, Transaction, 
        TransactionBuilder} from "stellar-base";
import { CID } from 'multiformats/cid';
import {sha256} from 'multiformats/hashes/sha2';
import * as raw from 'multiformats/codecs/raw';
import * as cbor from '@ipld/dag-cbor';
import * as Digest from 'multiformats/hashes/digest';
import * as Sodium from './na.js'
import * as wallet from "@stellar/freighter-api";

const HORIZON = 'https://horizon.stellar.org';
const MESSAGE_PRICE = '0.1000000';
const TXTIMEOUT = 60;

export class StellarAccount {
  #account; // Signing is done with a Stellar account
  #watcher; // Interface to Stellar API endpoints
  constructor(address){
    if(!StrKey.isValidEd25519PublicKey(address))
      throw new Error(`StellarAccount requires valid Ed25519 Public Key as arguement.`)
    this.#account = {id: address};
    this.#watcher = new MessageWatcher(address, this);
  }

  get account(){
    return this.#account
  }

  get watcher(){
    return this.#watcher
  }

  static async dataEntry(account, label){
    if(account instanceof StellarAccount)
      account = account.account.id;
//console.log(`retrieving data entry for label ${label} on account ${account}`);
    return request(`${HORIZON}/accounts/${account}`) 
      .then(response => {
        const dataEntries = JSON.parse(response).data;
        return Object.hasOwn(dataEntries, label) ? Buffer.from(dataEntries[label], 'base64') : Buffer.alloc(0)
      })  
  }

  static memoToCID(memo){
    // Assumes memo contains a raw sha256 hash pointing to encrypted data
    const bytes = new Uint8Array(Buffer.from(memo, 'base64'));
    if(bytes.length !== 32)
      return null

    return CID.create(1, raw.code, Digest.create(sha256.code, bytes))
  }

  static offers(stellarAccount, assetCodes){
    const digger = new AccountDigger(stellarAccount.account.id, 'offers', offer => {
      if(offer.selling.asset_code in assetCodes && offer.selling.asset_issuer === stellarAccount.account.id){
        //console.log(`found offer: `, offer);
        digger.recordQueue.push(offer);
      }
      return false
    });
    return digger.dig(readerResponse => {
      //console.log(`dug ${readerResponse.recordQueue.length} offers: `, readerResponse.recordQueue)
      return readerResponse.recordQueue
    })
  }

  static sellOffer(stellarAccount, opts){
    //console.log(`${stellarAccount.account.id} is making a sell offer with opts: `, opts);
    const buy = Asset.native();
    const sell = new Asset(opts.selling, stellarAccount.account.id);
    return this.offers(stellarAccount, Object.fromEntries(new Map([[opts.selling, true]])))
      .then(offers => offers.length ? offers.pop() : {})
      .then(offer => offer.price === MESSAGE_PRICE ? Promise.resolve(offer) : stellarAccount.tx([
          Operation.manageSellOffer({
            offerId: offer?.id ? offer.id : '0',
            price: MESSAGE_PRICE,
            selling: sell,
            buying: buy,
            amount: '100'
          })
        ])
      )
  }

  static sigFromXDR(signedXDR){
    return new Transaction(signedXDR, Networks.PUBLIC).signatures[0].signature()
  }

  static signingPhrase(accountId){
    // ANY CHANGE TO TRANSACTION INPUTS WILL INVALIDATE USER'S EC25529 KEYS
    // DO NOT CHANGE ANYTHING BETWEEN THIS LINE vvvvvvvvvvvvvvvvvvvvvvvvv
    let bldr =  new TransactionBuilder(new Account(accountId, '0'),{"fee": 10000, 'networkPassphrase': Networks.PUBLIC});
    bldr.setTimeout(TimeoutInfinite);
    bldr.addOperation(Operation.manageData({name: 'Notifier ec25519 public key', value: ''}));
    bldr.addMemo(new Memo(MemoHash, StrKey.decodeEd25519PublicKey(accountId)));
    // AND THIS LINE ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    // OK to change code now 
    return bldr.build();
  }

  static submitTx(xdr, updateFn=null){
    let phrase = `waiting for Stellar consensus`;
    const interval = setInterval(() => {
                        console.log(phrase += '.');
                        if(updateFn)
                          updateFn();
                      }, 2000);
    return request(`${HORIZON}/transactions?tx=${xdr.replace(/\+/g, '%2B')}`, 
                     {method: 'POST',
                      headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                      }})
    .then(response => {
      clearInterval(interval);
      //console.log(`transaction ${JSON.parse(response).id} successful.`);
      return JSON.parse(response)
    })
    .catch(err => {
      clearInterval(interval);
      console.error(`SigningAccount.submitTx caused error: `, err);
      console.error(`${err.status} error caught`);
      updateFn(`${err.status} error caught`);
      if(err.status === 504)
        console.log(`YOUR 504 HANDLER HERE`);
    })
  }

  async addSigner(pk=null){
    console.log(`Object.hasOwn(this, 'ed25519'): `, Object.hasOwn(this, 'ed25519'));
    if(!pk && this?.ed25519)
      pk = this.ed25519.pk;
    const account = await this.reload();
    console.log(`encoding pk: `, pk);
    const pkStr = StrKey.encodeEd25519PublicKey(pk);
    //console.log(`signers are: `, this.account.signers);
    for(let signer of this.account.signers)
      if(signer.key === pkStr)
        return account

    return this.tx([Operation.setOptions(
      {signer: {
        ed25519PublicKey: pkStr,
        weight: 1
       },
       masterWeight: 255,
       highThreshold:254,
       medThreshold: 1,
       lowThreshold: 0
      })])
      .then(txResult => this.reload())
  }  

  // discuss in document why not regular payments; give recipient some control && Stellar concensus around memos
  // --mention anti-spam under user control
  // Use of messenger token signals meaning of memo between message sender and receiver
  // and different coins convey information, such as which keys to decrypt with
  messengerTx(cid, to, code, issuer=null){
    return Promise.all([request(`${HORIZON}/accounts/${to}`),
                        request(`${HORIZON}/accounts/${to}/offers`)])
      .then(([r1, r2]) => {
        if (!issuer) issuer = to;
        const recipient = JSON.parse(r1);
        const [messenger] = JSON.parse(r2)._embedded.records.filter(offer => 
            offer.selling.asset_code === code && offer.selling.asset_issuer === issuer
          );
        if(!messenger)
          throw new Error(`cannot make messengerTx without recipient token offer`)
        const myAsset = messenger.buying.asset_type !== 'native' ? 
                        new Asset(nessenger.asset_code, messenger.asset_issuer) :
                        Asset.native();
        return this.tx([Operation.pathPaymentStrictReceive(
          {'sendAsset': myAsset, 'sendMax': messenger.price, 'destination': to,
           'destAsset': new Asset(code, issuer), 'destAmount': '1', 'path': []})], cid)
      })
  }

  reload(){
    return request(`${HORIZON}/accounts/${this.account.id}`)
      .then(response => this.#account = JSON.parse(response))
  }


  setDataEntry(label, value){
    return StellarAccount.dataEntry(this, label).then(oldValue => {
      //console.log(`${label} value is ${value} and oldValue is: `, oldValue);
      let isEqual = value.length === oldValue.length;
      for(let i = 0; i < value.length && isEqual; i++)
        isEqual = value[i] === oldValue[i];
      if(isEqual)
        return oldValue
      else {
        //console.log(`setting ${label} to: `, value)
        return this.tx([Operation.manageData({name: label, value: value})])
                   .then(txResult => this.reload())
                   .then(account => Buffer.from(account.data[label], 'base64'))
      }
    })
    
  }

  tx(operations, cid=null){
    console.log(`building Stellar transaction for operations: `, operations);
    return Promise.all([this.reload(), request(`${HORIZON}/fee_stats`)])
      .then(([account, stats]) => new TransactionBuilder(
         new Account(account.id, account.sequence),
         {"fee": JSON.parse(stats).max_fee.p80,
          'networkPassphrase': Networks.PUBLIC,
          'timebounds': {'minTime': 0,
                         'maxTime': Math.round(Date.now()/1000+TXTIMEOUT)
                        }
          }
      ))
      .then(async bldr => {
        if(cid)
          bldr.addMemo(new Memo(MemoHash, Buffer.from(cid.multihash.digest)));
        for(const op of operations)
          bldr.addOperation(op);  
        let tx = bldr.build();
        if(this.ed25519 === null ||  
           0 === this.#account.signers.filter(signer => signer.key === StrKey.encodeEd25519PublicKey(this.ed25519.pk)).length) {
          console.log(`didn't find ed25519 signer`);
          var signedXDR = await wallet.signTransaction(tx.toXDR())
        } else {
          // if there are signing keys, sign and submit the transaction
          const signedTx = tx.sign(Keypair.fromRawEd25519Seed(this.ed25519.sk));
          var signedXDR = tx.toXDR();
        }
        //console.log(`submitting XDR: ${signedXDR}`);
        return StellarAccount.submitTx(signedXDR)
      })    
  }
}