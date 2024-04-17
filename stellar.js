import {Account, Asset, Keypair, Memo, MemoHash,
        MemoText, MemoID, Networks, Operation, 
        StrKey, TimeoutInfinite, Transaction, 
        TransactionBuilder} from "stellar-base";
import * as wallet from "@stellar/freighter-api";
import * as Digest from 'multiformats/hashes/digest';
import {sha256} from 'multiformats/hashes/sha2';
import * as raw from 'multiformats/codecs/raw';
import * as cbor from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';

import {AccountDigger} from './apiReaders.js';
import {MessageWatcher} from './message.js';
import {request} from './cols.js';

const HORIZON = 'https://horizon.stellar.org';
const MESSAGE_PRICE = '0.1000000';
const TXTIMEOUT = 60;

// a Stellar block chain account is used
// - to name and store ipfs addresses (in account data entries)
// - to share ipfs addresses between accounts (in transaction memos)
// - to sign a phrase used to derive encryption and automated signing keys
// - to send and receive payments
export class StellarAccount {
  #account; // Signing is done with a Stellar account
  #watcher; // Interface to Stellar API endpoints
  constructor(address){
    if(!StrKey.isValidEd25519PublicKey(address))
      throw new Error(`StellarAccount requires valid Ed25519 Public Key as arguement.`)
    this.#account = {id: address};
    this.#watcher = new MessageWatcher(address, this);
  }

  // access those private properties

  get account(){
    return this.#account
  }

  get watcher(){
    return this.#watcher
  }

  get id(){
    return this.#account.id
  }
  
  // returns Buffer containing account.data[label]
  static async dataEntry(account, label){
    if(account instanceof StellarAccount)
      account = account.account.id;
    return request(`${HORIZON}/accounts/${account}`) 
      .then(response => {
        const dataEntries = JSON.parse(response).data;
        return Object.hasOwn(dataEntries, label) ? Buffer.from(dataEntries[label], 'base64') : Buffer.alloc(0)
      })  
  }

  static load(accountId){
    return request(`${HORIZON}/accounts/${accountId}`).then(result => JSON.parse(result))
  }

  // returns cid from 32 byte memoHash
  static memoToCID(memo){
    // Assumes memo contains a raw sha256 hash pointing to encrypted data
    const bytes = new Uint8Array(Buffer.from(memo, 'base64'));
    if(bytes.length !== 32)
      return null

    return CID.create(1, raw.code, Digest.create(sha256.code, bytes))
  }

  // matches assetCodes of interest against current offers by account
  static offers(stellarAccount, assetCodes){
    const digger = new AccountDigger(stellarAccount.account.id, 'offers', offer => {
      if(offer.selling.asset_code in assetCodes && offer.selling.asset_issuer === stellarAccount.account.id){
        digger.recordQueue.push(offer);
      }
      return false
    });
    return digger.dig(readerResponse => readerResponse.recordQueue)
  }

  // creates or updates Stellar market offers for stellarAccount
  static sellOffer(stellarAccount, opts){
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

  // extracts single signature from Stellar transaction XDR
  static sigFromXDR(signedXDR){
    return new Transaction(signedXDR, Networks.PUBLIC).signatures[0].signature()
  }

  // creates phrase which Stellar Freighter wallet will sign
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


  // escapes urlencoded text and submits to stellar, after which
  // updateFn is called every two seconds and upon end or request
  static submitTx(xdr, updateFn=()=>{}){
    let phrase = `waiting for Stellar consensus`;
    const interval = setInterval(() => {
                        console.log(phrase += '.');
                        if(updateFn)
                          updateFn(phrase);
                      }, 2000);
    return request(`${HORIZON}/transactions?tx=${xdr.replace(/\+/g, '%2B')}`, 
                     {method: 'POST',
                      headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                      }})
    .then(response => {
      updateFn(response);
      clearInterval(interval);
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

  // pk or this.ed25519.pk are added as this.account's signer if not already present
  // returns account state
  async addSigner(pk=null){
    if(!pk && this?.ed25519)
      pk = this.ed25519.pk;
    const account = await this.reload();
    const pkStr = StrKey.encodeEd25519PublicKey(pk);
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
  // selection of messenger token signals meaning of memo between message sender and receiver and which keys to decrypt with.
  messengerTx(cid, to, code, issuer=null){
    // get state of recipient account and its offers
    return Promise.all([request(`${HORIZON}/accounts/${to}`),
                        request(`${HORIZON}/accounts/${to}/offers`)])
      // then choose offer to attach message to, create and send path payment with message attached
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
        const abrevIt = (str) => `${str.slice(0, 5)}...${str.slice(-5)}`;
        console.log(`sending addresss ${abrevIt(cid.toString())} with ${code},${abrevIt(issuer)} from ${abrevIt(this.account.id)} to ${abrevIt(to)}`)
        return this.tx([Operation.pathPaymentStrictReceive(
          {'sendAsset': myAsset, 'sendMax': messenger.price, 'destination': to,
           'destAsset': new Asset(code, issuer), 'destAmount': '1', 'path': []})], cid)
      })
  }

  // get current on chain account state.
  reload(){
    return StellarAccount.load(this.account.id).then(account => this.#account = account)
  }

  // returns Buffer of value for account.data[label]
  setDataEntry(label, value){
    return StellarAccount.dataEntry(this, label).then(oldValue => {
      // if no change to value, return it
      let isEqual = value.length === oldValue.length;
      for(let i = 0; i < value.length && isEqual; i++)
        isEqual = value[i] === oldValue[i];
      if(isEqual)
        return oldValue
      else {
        // otherwise set value of account.data[label] first, then return it
        return this.tx([Operation.manageData({name: label, value: value})])
                   .then(txResult => this.reload())
                   .then(account => Buffer.from(account.data[label], 'base64'))
      }
    })
    
  }

  // construct, sign and send transactions on Stellar with cid digest in memo
  tx(operations, cid=null, keypairs=[]){
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
        if(!!cid)
          bldr.addMemo(new Memo(MemoHash, Buffer.from(cid.multihash.digest)));
        for(const op of operations){
          bldr.addOperation(op);  
        }
        let tx = bldr.build();
        if(0 === this.#account.signers.filter(signer => signer.key === StrKey.encodeEd25519PublicKey(this.ed25519.pk)).length ||
           this.ed25519 === null) {
          console.log(`didn't find ed25519 signer`);
          var signedXDR = await wallet.signTransaction(tx.toXDR())
        } else {
          // sign with instance's ed25519 key
          const signedTx = tx.sign(Keypair.fromRawEd25519Seed(this.ed25519.sk));
          var signedXDR = tx.toXDR();
        }
        // add signatures from any key pairs submitted with the transaction
        if(keypairs.length > 0){
          const tx = TransactionBuilder.fromXDR(signedXDR, Networks.PUBLIC);
          tx.sign(...keypairs);
          signedXDR = tx.toXDR();
        }
        console.log(`submitting XDR: ${signedXDR}`);
        return StellarAccount.submitTx(signedXDR)
      })    
  }
}