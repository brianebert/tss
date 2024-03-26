//import {default as wallet} from "@stellar/freighter-api";
import freighterApi from "@stellar/freighter-api";
import {Keypair, StrKey} from "stellar-base";
import {AccountWatcher, AccountDigger} from './apiReaders.js';
import {COL_Node, request} from './cols.js';
import {StellarAccount} from './stellar.js';
//import {request} from './http.js';
import * as Sodium from './na.js';

// Stellar api server
const HORIZON = 'https://horizon.stellar.org';
const wallet = freighterApi;

// repository for keys derived to automate encryption, decryption and block chain use
export class SigningAccount extends StellarAccount {
  #canSign; // true when have presented secret key associated with account.id or have signed with wallet
  #ec25519; // hex string for asymetric encryption
  #ed25519; // a Stellar Keypair for automated signing
  #shareKX; // hex string key pair for key shared key exchange
  #ready;   // resolves after setting #canSign appropriately
  constructor(address, secret=null, constants={asymetric: 'Asymetric', signing: 'Signing', shareKX: 'ShareKX'}){
    if(!StrKey.isValidEd25519PublicKey(address))
      throw new Error(`SigningAccount requires valid Ed25519 Public Key as arguement.`)
    super(address);
    this.#canSign = false;
    this.#ec25519 = this.#ed25519 = this.#shareKX = null;
    this.#ready = new Promise(resolve => {
      return this.deriveKeys(secret, constants)
         .then(() => {
           this.#canSign = true;
           resolve(true)
         })
         .catch(err => {
           this.#canSign = false;
           resolve(true)
         })
    })
  }

  // access the keys
  get canSign(){
    return this.#canSign;
  }

  get ec25519(){
    return this.#ec25519
  }

  get ed25519(){
    return this.#ed25519
  }

  get shareKX(){
    return this.#shareKX
  }

  get ready(){
    return this.#ready
  }

  get keys(){
    return {
      readFrom: async (writer, pubLickeyLabel) => {
        if(!this.#ec25519)
          return Promise.resolve(null)
        if(writer === 'self')
          return Promise.resolve({
            reader: this.#ec25519.sk,
            writer: this.#ec25519.pk
          })
        if(StrKey.isValidEd25519PublicKey(writer))
          return SigningAccount.load(writer).then(account => 
            Object.create({
              writer: Buffer.from(account.data[pubLickeyLabel], 'base64'),
              reader: this.#ec25519.sk
            })
          )
      },
      writeTo: async (reader, pubLickeyLabel) => {
        if(!this.#ec25519)
          return Promise.resolve(null)
        if(reader === 'self')
          return Promise.resolve({
            reader: this.#ec25519.pk,
            writer: this.#ec25519.sk
          })
        if(StrKey.isValidEd25519PublicKey(reader))
          return SigningAccount.load(reader).then(account => Object.create({
            reader: Buffer.from(account.data[pubLickeyLabel], 'base64'),
            writer: this.#ec25519.sk
          }))
      },
      // returns {rx: libsodium.crypto_kx_server_session_keys(keys.pk, keys.sk, pk).sharedRx,
      //          tx: libsodium.crypto_kx_client_session_keys(keys.pk, keys.sk, pk).sharedTx}
      // select rx or tx appropriately whether writing to or reading from someone else
      sharedWith: (accountId, pubLickeyLabel) => {
        if(!this.#shareKX)
          return Promise.resolve(null)
        if(StrKey.isValidEd25519PublicKey(accountId))
          return SigningAccount.load(accountId)
            .then(account => Buffer.from(account.data[pubLickeyLabel], 'base64'))
            .then(pk => Sodium.sharedKeys(this.#shareKX, pk))
        return Promise.resolve(null)
      }
    }
  }

  // creates SigningAccount from wallet imported
  static async checkForWallet(accountId=null, secret=null){
    if(accountId)
      return Promise.resolve(new this(accountId, secret))
    if(wallet.isBrowser && await wallet.isConnected())
      return wallet.getPublicKey().then(address => new this(address))
    const kp = Keypair.random();
    return Promise.resolve(new this(kp.publicKey()))
  }

  // uses a signature as randomness input.
  async deriveKeys(secret=null, constants){
    if(secret){
      var kp = Keypair.fromSecret(secret);
      if(kp.publicKey() !== this.account.id)
        throw new Error(`if deriveKeys is passed secret, it must match account.id`);
    }

    // this gets called at the end. it calls libsodium
    function theThen(signedXdr){
      const sig = SigningAccount.sigFromXDR(signedXdr);
      return Sodium.keysFromSig(sig, constants)
        .then(keys => {
          //console.log(`derived keys: `, keys);
          this.#ec25519 = keys.ec25519;
          this.#shareKX = keys.shareKX;
          // ed25519 seed needs to be extracted for Stellar Keypair
          this.#ed25519 = {sk: keys.ed25519.sk.slice(0, 32),
                           pk: keys.ed25519.pk};
          return this
        })
        .catch(err => {
          console.error(`Error deriving app's encryption keys: `, err);
          throw new Error(`Threw error deriving app's encryption keys`)
        })
    }

    // StellarAccount.signingPhrase returns a Stellar transaction, once necessary for Freighter
    // to sign, with the SigningAccount's id embedded in the transaction's memo. The latter should
    // be looked at for security problems. Freighter has since started signing blobs and thus this
    // key derivation can become more flexible
    const myPhrase = StellarAccount.signingPhrase(this.account.id);

    if(secret){
      myPhrase.sign(kp);
      return Promise.resolve(myPhrase.toXDR())
        .then(theThen.bind(this)).then(() => {
          // secret is known, overwrite derived signing pair
          this.#ed25519 = {
            sk: kp.rawSecretKey(),
            pk: kp.rawPublicKey()
          };
          return this
        })
    }

    // if secret is falsy, use signature from wallet to derive keys
    if(await wallet.isConnected() && await wallet.getPublicKey() === this.account.id)
      return wallet.signTransaction(myPhrase.toXDR()).then(theThen.bind(this))
    else
      throw new Error(`Freighter account does not match Signing Account`)
  }
}